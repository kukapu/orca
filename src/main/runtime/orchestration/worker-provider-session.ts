import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'

/** Minimal row shape the exact-window filter needs; live status rows and the
 *  hook server's observed-options side rows both satisfy it structurally. */
export type ExactWorkerStatusRow = {
  paneKey: string
  connectionId: string | null
  launchToken?: string
  providerSessionOnly?: boolean
  receivedAt: number
}

/** Exact-window status rows for one worker process, newest first. Shared by
 *  every exact-worker status read (provider session, observed options) so the
 *  identity fencing cannot diverge between consumers. */
export function selectExactWorkerStatusRows<R extends ExactWorkerStatusRow>(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly R[]
}): R[] {
  return args.statuses
    .filter(
      (entry) =>
        entry.paneKey === args.paneKey &&
        (args.connectionId === undefined || entry.connectionId === args.connectionId) &&
        (!args.launchToken || entry.launchToken === args.launchToken) &&
        entry.providerSessionOnly !== true &&
        entry.receivedAt >= args.observedAfter
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)
}

export function selectExactWorkerProviderSession(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly AgentStatusIpcPayload[]
}): ExactWorkerProviderSession | null {
  const status = selectExactWorkerStatusRows(args).find(
    (entry) => entry.providerSession !== undefined && entry.agentType !== undefined
  )
  if (!status?.providerSession || !status.agentType) {
    return null
  }
  return {
    paneKey: args.paneKey,
    processIncarnation: args.processIncarnation,
    agent: status.agentType,
    providerSession: { ...status.providerSession },
    observedAt: status.receivedAt,
    connectionId: args.connectionId ?? null
  }
}
