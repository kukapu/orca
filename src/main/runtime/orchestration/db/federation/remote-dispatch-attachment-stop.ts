import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import type { RemoteDispatchAttachmentRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { paneKeyMatchSuffix, REMOTE_ATTACHMENT_PANE_KEY_MATCH_SUFFIX_SQL } from '../pane-key-match'
import type { OrchestrationDb } from '../orchestration-db'

// Stop eligibility is a process verdict only: hosts predating capability retention
// persisted stalled failures with the hash already cleared, and the worker may still
// be executing the prompt. Report-settled stages are excluded so a settled record
// never reopens.
const STALLED_PROMPT_STOP_ATTACHMENT_SQL = `state = 'failed' AND last_error = ? AND stage NOT IN ('worker_report_queued', 'worker_report_settled')`

// Pane routing is an authority question: only a retained capability can prove the
// sender is the worker that received the prompt.
const RETAINED_STALLED_PROMPT_ROUTE_SQL = `state = 'failed' AND last_error = ? AND capability_hash IS NOT NULL`

export function beginRemoteAttachmentStop(
  this: OrchestrationDb,
  dispatchId: string
): RemoteDispatchAttachmentRow {
  const attachment = this.getRemoteDispatchAttachment(dispatchId)
  if (!attachment) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Remote Dispatch ${dispatchId} was not found.`
    )
  }
  if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(attachment.state)) {
    // Why the exception: an unobserved-prompt failure says nothing about the process,
    // so stop must still reach the terminal rather than answer already-settled —
    // with or without a retained capability.
    if (!this.isUnobservedPromptAttachment(attachment, { requireRetainedCapability: false })) {
      return attachment
    }
  } else if (!['ready', 'start_unknown'].includes(attachment.state)) {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Remote Dispatch ${dispatchId} cannot stop from ${attachment.state}.`
    )
  }
  this.db
    .prepare(
      `UPDATE remote_dispatch_attachments
       SET state = 'stopping', stage = 'stop_requested', capability_hash = NULL,
           updated_at = datetime('now')
       WHERE dispatch_id = ?
         AND (state IN ('ready', 'start_unknown') OR ${STALLED_PROMPT_STOP_ATTACHMENT_SQL})`
    )
    .run(dispatchId, AGENT_PROMPT_STALLED_ERROR)
  return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
}

export function settleRemoteAttachmentStop(
  this: OrchestrationDb,
  dispatchId: string
): RemoteDispatchAttachmentRow {
  this.db
    .prepare(
      `UPDATE remote_dispatch_attachments
       SET state = 'stopped', stage = 'process_stopped', updated_at = datetime('now')
       WHERE dispatch_id = ? AND state = 'stopping'`
    )
    .run(dispatchId)
  return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
}

export function markRemoteAttachmentStopUnknown(
  this: OrchestrationDb,
  dispatchId: string,
  reason: string
): RemoteDispatchAttachmentRow {
  this.db
    .prepare(
      `UPDATE remote_dispatch_attachments
       SET state = 'stop_unknown', stage = 'stop_outcome_unknown', last_error = ?,
           updated_at = datetime('now')
       WHERE dispatch_id = ? AND state = 'stopping'`
    )
    .run(reason, dispatchId)
  return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
}

export function findActiveRemoteAttachmentForPane(
  this: OrchestrationDb,
  paneKey: string
): RemoteDispatchAttachmentRow | undefined {
  if (!parsePaneKey(paneKey)) {
    return this.db
      .prepare(
        `SELECT * FROM remote_dispatch_attachments
         WHERE (state IN ('starting', 'ready') OR ${RETAINED_STALLED_PROMPT_ROUTE_SQL})
           AND pane_key = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(AGENT_PROMPT_STALLED_ERROR, paneKey) as RemoteDispatchAttachmentRow | undefined
  }
  return this.db
    .prepare(
      `SELECT * FROM remote_dispatch_attachments
       WHERE (state IN ('starting', 'ready') OR ${RETAINED_STALLED_PROMPT_ROUTE_SQL})
         AND pane_key IS NOT NULL
         AND instr(pane_key, ':') > 1
         AND ${REMOTE_ATTACHMENT_PANE_KEY_MATCH_SUFFIX_SQL} = ?
      ORDER BY rowid DESC LIMIT 1`
    )
    .get(AGENT_PROMPT_STALLED_ERROR, paneKeyMatchSuffix(paneKey)) as
    | RemoteDispatchAttachmentRow
    | undefined
}

export type RemoteDispatchAttachmentStopMethods = {
  beginRemoteAttachmentStop: typeof beginRemoteAttachmentStop
  settleRemoteAttachmentStop: typeof settleRemoteAttachmentStop
  markRemoteAttachmentStopUnknown: typeof markRemoteAttachmentStopUnknown
  findActiveRemoteAttachmentForPane: typeof findActiveRemoteAttachmentForPane
}

export function attachRemoteDispatchAttachmentStop(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    beginRemoteAttachmentStop,
    settleRemoteAttachmentStop,
    markRemoteAttachmentStopUnknown,
    findActiveRemoteAttachmentForPane
  })
}
