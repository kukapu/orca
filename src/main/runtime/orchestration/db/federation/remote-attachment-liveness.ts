import type { WorkerDispatchState } from '../../types'

export const POTENTIALLY_LIVE_REMOTE_ATTACHMENT_STATES = [
  'starting',
  'ready',
  'start_unknown',
  'stopping',
  'stop_unknown'
] as const satisfies readonly WorkerDispatchState[]

const REPORT_SETTLED_ATTACHMENT_STAGES_SQL = `'worker_report_queued', 'worker_report_settled'`

function assertStateColumn(column: string): string {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(column)) {
    throw new Error(`Invalid remote attachment state column: ${column}`)
  }
  return column
}

export function potentiallyLiveRemoteAttachmentSql(column = 'state'): string {
  const states = POTENTIALLY_LIVE_REMOTE_ATTACHMENT_STATES.map((state) => `'${state}'`).join(', ')
  return `${assertStateColumn(column)} IN (${states})`
}

// Process verdict only: the prompt may still be executing. Hash is irrelevant
// (legacy hosts cleared it). Report-settled stages are excluded so a settled
// record never occupies or reopens. Binds last_error = AGENT_PROMPT_STALLED_ERROR.
export function unobservedPromptAttachmentSql(column = 'state'): string {
  return (
    `${assertStateColumn(column)} = 'failed' AND last_error = ?` +
    ` AND stage NOT IN (${REPORT_SETTLED_ATTACHMENT_STAGES_SQL})`
  )
}

// Occupancy is a liveness question: stall and stop_requested do not prove exited.
// Released only after stop settled, a worker report, or a positive exit.
// Failures before launch without a PTY have no pane_key and never match.
// Binds last_error = AGENT_PROMPT_STALLED_ERROR.
export function occupyingRemoteAttachmentSql(column = 'state'): string {
  return (
    `(${potentiallyLiveRemoteAttachmentSql(column)}` +
    ` OR ${unobservedPromptAttachmentSql(column)})`
  )
}

// Ask routing is narrower than occupancy: only a retained capability can prove
// the sender is the worker that received the prompt. Stopping never routes.
// Binds last_error = AGENT_PROMPT_STALLED_ERROR.
export function retainedStalledPromptRouteSql(): string {
  return `state = 'failed' AND last_error = ? AND capability_hash IS NOT NULL`
}
