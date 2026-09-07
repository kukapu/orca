import type { AgentStatusObservationOrigin } from '../../../shared/agent-status-observation'
import { selectExactWorkerStatusRows } from './worker-provider-session'

/** Row shapes the selector accepts: live status rows and the hook server's
 *  observed-options side rows share the exactness fields. */
export type WorkerObservedOptionsCandidateRow = {
  paneKey: string
  connectionId: string | null
  launchToken?: string
  agentType?: string
  model?: string
  thinkingLevel?: string
  variant?: string
  evidenceObservedAt?: number
  receivedAt: number
  observation?: { origin: AgentStatusObservationOrigin }
}

/** Observed launch-option evidence for one exact worker process.
 *  Fields are what the provider hook actually reported — never a launch
 *  selection echo — and each carries its observation clock. */
export type WorkerObservedOptionsEvidence = {
  origin: AgentStatusObservationOrigin
  agent: string
  model?: string
  thinkingLevel?: string
  variant?: string
  /** Host clock when this evidence was observed (delivery clock when the host
   *  stamps no separate evidence clock). */
  observedAt: number
}

export type WorkerObservedOptionsSelection =
  | { kind: 'observed'; evidence: WorkerObservedOptionsEvidence }
  /** The pane reported status rows in the exact window, but none carried
   *  observed options (older hook/plugin, or the runtime exposes none). */
  | { kind: 'rows_without_options'; lastReceivedAt: number }
  /** No exact-window status row at all: the hook is missing or the new
   *  session/process has not reported yet. */
  | null

export function selectExactWorkerObservedOptions(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly WorkerObservedOptionsCandidateRow[]
}): WorkerObservedOptionsSelection {
  const rows = selectExactWorkerStatusRows(args)
  if (rows.length === 0) {
    return null
  }
  // Why newest-with-options, not newest: lifecycle rows (Busy/Idle, tool posts)
  // legitimately carry no options; evidence must survive them and model changes
  // must resolve to the latest observation.
  // Why the evidence-clock gate: a relay replay restamps `receivedAt` to clear the
  // connection watermark, so only `evidenceObservedAt ?? receivedAt` can tell whether
  // the options were observed inside this Dispatch's window — older evidence belongs
  // to a prior Dispatch and must not present as current.
  const evidenceRow = rows.find(
    (row) =>
      (row.model !== undefined || row.thinkingLevel !== undefined || row.variant !== undefined) &&
      (row.evidenceObservedAt ?? row.receivedAt) >= args.observedAfter
  )
  if (!evidenceRow || evidenceRow.agentType === undefined) {
    return { kind: 'rows_without_options', lastReceivedAt: rows[0].receivedAt }
  }
  return {
    kind: 'observed',
    evidence: {
      origin: evidenceRow.observation?.origin ?? 'hook',
      agent: evidenceRow.agentType,
      ...(evidenceRow.model !== undefined ? { model: evidenceRow.model } : {}),
      ...(evidenceRow.thinkingLevel !== undefined
        ? { thinkingLevel: evidenceRow.thinkingLevel }
        : {}),
      ...(evidenceRow.variant !== undefined ? { variant: evidenceRow.variant } : {}),
      observedAt: evidenceRow.evidenceObservedAt ?? evidenceRow.receivedAt
    }
  }
}

/** Wire shape published on `workerShow.observation`. Always explicit about
 *  absence; the whole field is omitted only by runtimes that predate it. */
export type WorkerObservedOptionsObservation = {
  origin: AgentStatusObservationOrigin
  status: 'observed' | 'unavailable'
  reason?:
    | 'no_status_row'
    | 'status_without_options'
    | 'worker_identity_not_exact'
    | 'no_supervised_worker'
  agent?: string
  model?: string
  thinkingLevel?: string
  variant?: string
  observedAt?: number
  lastReceivedAt?: number
}

export function buildWorkerObservedOptionsObservation(args: {
  selection: WorkerObservedOptionsSelection
}): WorkerObservedOptionsObservation {
  if (args.selection === null) {
    return { origin: 'hook', status: 'unavailable', reason: 'no_status_row' }
  }
  if (args.selection.kind === 'rows_without_options') {
    return {
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: args.selection.lastReceivedAt
    }
  }
  return { ...args.selection.evidence, status: 'observed' }
}

export function workerIdentityNotExactObservedOptions(): WorkerObservedOptionsObservation {
  return { origin: 'hook', status: 'unavailable', reason: 'worker_identity_not_exact' }
}
