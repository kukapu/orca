import type { CommandHandler } from '../../dispatch'
import { printResult } from '../../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../../flags'
import { RuntimeClientError } from '../../runtime-client'
import type {
  OrchestrationWorkerReadResult,
  OrchestrationWorkerReadSource
} from '../../../shared/orchestration-worker-output'
import { formatWorkerRead, type LegacyWorkerReadResult } from './worker-output'

type ObservedOptionsLine = {
  origin: string
  status: 'observed' | 'unavailable'
  reason?: string
  agent?: string
  model?: string
  thinkingLevel?: string
  variant?: string
  observedAt?: number
  lastReceivedAt?: number
}

function formatObservedOptions(options: ObservedOptionsLine | undefined): string {
  // Why: absence is a version statement (old runtime or old federated server), never "no evidence".
  if (options === undefined) {
    return 'unknown (not evaluated)'
  }
  if (options.status === 'unavailable') {
    const clock = options.lastReceivedAt
      ? `; last hook event ${new Date(options.lastReceivedAt).toISOString()}`
      : ''
    return `unavailable (${options.reason ?? 'no evidence'}${clock})`
  }
  const fields = [
    options.model ? `model=${options.model}` : null,
    options.thinkingLevel ? `thinking=${options.thinkingLevel}` : null,
    options.variant ? `variant=${options.variant}` : null
  ].filter((entry): entry is string => entry !== null)
  const detail = fields.length > 0 ? fields.join(' ') : 'no fields observed'
  const agent = options.agent ? ` agent=${options.agent}` : ''
  const clock = options.observedAt ? ` at ${new Date(options.observedAt).toISOString()}` : ''
  return `${detail}${agent} (via ${options.origin}${clock})`
}

export const ORCHESTRATION_WORKER_OBSERVATION_HANDLERS: Record<string, CommandHandler> = {
  'orchestration worker-show': async ({ flags, client, json }) => {
    const result = await client.call<{
      dispatch: { id: string; task_id: string; status: string }
      worker: { state: string; stage: string; agent_terminal_handle: string | null }
      observation?: {
        agentWait?: { source: string; reason?: string } | null
        observedOptions?: {
          origin: string
          status: 'observed' | 'unavailable'
          reason?: string
          agent?: string
          model?: string
          thinkingLevel?: string
          variant?: string
          observedAt?: number
          lastReceivedAt?: number
        }
      }
    }>('orchestration.workerShow', {
      dispatch: getRequiredStringFlag(flags, 'dispatch')
    })
    printResult(result, json, (value) => {
      const base = `${value.dispatch.id} task=${value.dispatch.task_id} [${value.worker.state}] stage=${value.worker.stage}`
      // Why: absent means unknown on older runtimes, distinct from an evaluated null wait.
      if (value.observation === undefined || !('agentWait' in value.observation)) {
        return `${base}\nInteractive wait: unknown (not evaluated)`
      }
      const wait = value.observation.agentWait
      const waitLine = wait
        ? `Waiting on a human: ${wait.reason ?? 'interactive prompt'} (via ${wait.source})`
        : 'Interactive wait: none'
      return `${base}\n${waitLine}\nObserved options: ${formatObservedOptions(value.observation.observedOptions)}`
    })
  },

  'orchestration worker-read': async ({ flags, client, json }) => {
    const cursorFlag = getOptionalStringFlag(flags, 'cursor')
    const cursor =
      cursorFlag !== undefined && /^\d+$/.test(cursorFlag)
        ? Number.parseInt(cursorFlag, 10)
        : cursorFlag
    const source = getOptionalStringFlag(flags, 'source')
    if (source && !['auto', 'transcript', 'terminal'].includes(source)) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--source must be auto, transcript, or terminal'
      )
    }
    const result = await client.call<OrchestrationWorkerReadResult | LegacyWorkerReadResult>(
      'orchestration.workerRead',
      {
        dispatch: getRequiredStringFlag(flags, 'dispatch'),
        cursor,
        limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
        source: source as OrchestrationWorkerReadSource | undefined
      }
    )
    printResult(result, json, formatWorkerRead)
  }
}
