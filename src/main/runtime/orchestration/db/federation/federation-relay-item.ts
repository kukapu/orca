import type {
  WorkerReportOutcome,
  FederationRelayDirection,
  FederationRelayItemRow
} from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { REPORT_SETTLED_ATTACHMENT_STAGES } from './remote-dispatch-attachment-authority'
import type { OrchestrationDb } from '../orchestration-db'

export function getFederationRelayItem(
  this: OrchestrationDb,
  dispatchId: string,
  direction: FederationRelayDirection,
  sequence: number
): FederationRelayItemRow | undefined {
  return this.db
    .prepare(
      `SELECT * FROM federation_relay_items
       WHERE dispatch_id = ? AND direction = ? AND sequence = ?`
    )
    .get(dispatchId, direction, sequence) as FederationRelayItemRow | undefined
}

export function settleRemoteAttachmentInRelayTransaction(
  this: OrchestrationDb,
  dispatchId: string,
  outcome: WorkerReportOutcome | undefined,
  stage = 'worker_report_queued'
): void {
  if (!outcome) {
    return
  }
  const attachment = this.getRemoteDispatchAttachment(dispatchId)
  const state = outcome === 'succeeded' ? 'succeeded' : 'failed'
  if (!attachment) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Remote Dispatch ${dispatchId} was not found.`
    )
  }
  // Why `state === state` is not enough: a late `failed` report lands on a row already
  // `failed` for the unobserved prompt — the stage flip is what marks it report-settled,
  // so that record can never be mistaken for a stoppable stalled one again.
  if (attachment.state === state && REPORT_SETTLED_ATTACHMENT_STAGES.includes(attachment.stage)) {
    return
  }
  // Why the retained-capability origin: a failure recorded for an unobserved prompt kept
  // the worker's authority precisely so its own report could correct the record (#16095).
  // A legacy row that lost its hash stays fenced out of report settlement.
  if (
    attachment.state !== 'ready' &&
    !this.isUnobservedPromptAttachment(attachment, { requireRetainedCapability: true })
  ) {
    throw new OrchestrationError(
      'request_mismatch',
      `Remote Dispatch ${dispatchId} cannot settle as ${state} from ${attachment.state}.`
    )
  }
  this.db
    .prepare(
      `UPDATE remote_dispatch_attachments
       SET state = ?, stage = ?, capability_hash = NULL,
           updated_at = datetime('now')
       WHERE dispatch_id = ?
         AND (state = 'ready'
              OR (state = 'failed' AND last_error = ? AND capability_hash IS NOT NULL))`
    )
    .run(state, stage, dispatchId, AGENT_PROMPT_STALLED_ERROR)
}

export type FederationRelayItemMethods = {
  getFederationRelayItem: typeof getFederationRelayItem
  settleRemoteAttachmentInRelayTransaction: typeof settleRemoteAttachmentInRelayTransaction
}

export function attachFederationRelayItem(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getFederationRelayItem,
    settleRemoteAttachmentInRelayTransaction
  })
}
