import type { WorkerDispatchState } from '../../types'

export const POTENTIALLY_LIVE_REMOTE_ATTACHMENT_STATES = [
  'starting',
  'ready',
  'start_unknown',
  'stopping',
  'stop_unknown'
] as const satisfies readonly WorkerDispatchState[]

export function potentiallyLiveRemoteAttachmentSql(column = 'state'): string {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(column)) {
    throw new Error(`Invalid remote attachment state column: ${column}`)
  }
  return `${column} IN (${POTENTIALLY_LIVE_REMOTE_ATTACHMENT_STATES.map((state) => `'${state}'`).join(', ')})`
}

// Hash is irrelevant to process liveness; legacy hosts cleared it on stalled prompts.
export function unobservedPromptAttachmentSql(): string {
  return `state = 'failed' AND last_error = ? AND stage NOT IN ('worker_report_queued', 'worker_report_settled')`
}

// Binds AGENT_PROMPT_STALLED_ERROR; neither a stall nor a stop request proves exited.
export function occupyingRemoteAttachmentSql(): string {
  return `(${potentiallyLiveRemoteAttachmentSql()} OR ${unobservedPromptAttachmentSql()})`
}

export function retainedStalledPromptRouteSql(): string {
  return `${unobservedPromptAttachmentSql()} AND capability_hash IS NOT NULL`
}
