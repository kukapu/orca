import type { OrchestrationDb } from '../../../../orchestration/db'
import { isFederationEffectUnknown } from './federation-effects'
import type { WorkerSetupReceipt } from '../worker/worker-topology'
import type { OrchestrationWorkerLaunchReceipt } from '../worker/worker-launch-preferences'
import {
  AGENT_PROMPT_STALLED_ERROR,
  isAgentPromptStalledError
} from '../../../../agent-prompt-submission-verification'

export function failFederatedAttachmentWithReceipt(args: {
  db: OrchestrationDb
  dispatchId: string
  runtimeEpoch: string
  failedStage: string
  error: unknown
  setup: WorkerSetupReceipt
  launch: OrchestrationWorkerLaunchReceipt
}): unknown {
  const reason = isAgentPromptStalledError(args.error)
    ? AGENT_PROMPT_STALLED_ERROR
    : args.error instanceof Error
      ? args.error.message
      : String(args.error)
  const unknown = isFederationEffectUnknown(args.error, args.failedStage)
  const attachment = args.db.failRemoteAttachment(
    args.dispatchId,
    args.failedStage,
    reason,
    unknown,
    // Why: the prompt bytes were written before verification, so the worker keeps the
    // authority its own late report needs to correct this record (#16095).
    { retainCapability: isAgentPromptStalledError(args.error) }
  )
  return {
    dispatchId: args.dispatchId,
    state: attachment.state === 'start_unknown' ? 'outcome_unknown' : attachment.state,
    stage: attachment.stage,
    runtimeEpoch: args.runtimeEpoch,
    failedStage: args.failedStage,
    lastError: reason,
    setup: args.setup,
    launch: args.launch,
    effects: JSON.parse(attachment.effects) as unknown[],
    residualResources: JSON.parse(attachment.residual_resources) as unknown[]
  }
}
