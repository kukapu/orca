import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import type { RemoteDispatchAttachmentRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { paneKeyMatchSuffix, REMOTE_ATTACHMENT_PANE_KEY_MATCH_SUFFIX_SQL } from '../pane-key-match'
import type { OrchestrationDb } from '../orchestration-db'
import {
  occupyingRemoteAttachmentSql,
  retainedStalledPromptRouteSql,
  unobservedPromptAttachmentSql
} from './remote-attachment-liveness'

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
          AND (state IN ('ready', 'start_unknown') OR ${unobservedPromptAttachmentSql()})`
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

// Routing feeds ask delivery: starting/ready or a retained stall. Stopping never routes.
export function findActiveRemoteAttachmentForPane(
  this: OrchestrationDb,
  paneKey: string
): RemoteDispatchAttachmentRow | undefined {
  if (!parsePaneKey(paneKey)) {
    return this.db
      .prepare(
        `SELECT * FROM remote_dispatch_attachments
          WHERE (state IN ('starting', 'ready') OR ${retainedStalledPromptRouteSql()})
            AND pane_key = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(AGENT_PROMPT_STALLED_ERROR, paneKey) as RemoteDispatchAttachmentRow | undefined
  }
  return this.db
    .prepare(
      `SELECT * FROM remote_dispatch_attachments
        WHERE (state IN ('starting', 'ready') OR ${retainedStalledPromptRouteSql()})
          AND pane_key IS NOT NULL
         AND instr(pane_key, ':') > 1
         AND ${REMOTE_ATTACHMENT_PANE_KEY_MATCH_SUFFIX_SQL} = ?
      ORDER BY rowid DESC LIMIT 1`
    )
    .get(AGENT_PROMPT_STALLED_ERROR, paneKeyMatchSuffix(paneKey)) as
    | RemoteDispatchAttachmentRow
    | undefined
}

/** Occupancy is a liveness question, unlike ask routing: a stopping/stop_unknown
 *  attachment may still hold the pane, so a contender must be rejected even though
 *  new asks no longer route to it. A stall or stop_requested does not prove exited. */
export function findOccupyingRemoteAttachmentForPane(
  this: OrchestrationDb,
  paneKey: string
): RemoteDispatchAttachmentRow | undefined {
  const occupancySql = occupyingRemoteAttachmentSql()
  if (!parsePaneKey(paneKey)) {
    return this.db
      .prepare(
        `SELECT * FROM remote_dispatch_attachments
         WHERE ${occupancySql} AND pane_key = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(AGENT_PROMPT_STALLED_ERROR, paneKey) as RemoteDispatchAttachmentRow | undefined
  }
  return this.db
    .prepare(
      `SELECT * FROM remote_dispatch_attachments
       WHERE ${occupancySql}
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
  findOccupyingRemoteAttachmentForPane: typeof findOccupyingRemoteAttachmentForPane
}

export function attachRemoteDispatchAttachmentStop(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    beginRemoteAttachmentStop,
    settleRemoteAttachmentStop,
    markRemoteAttachmentStopUnknown,
    findActiveRemoteAttachmentForPane,
    findOccupyingRemoteAttachmentForPane
  })
}
