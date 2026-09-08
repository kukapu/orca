import { OrchestrationError } from '../orchestration-error'
import type { WorkerReportOutcome } from '../types'
import type { WorkerReportObservation } from '../worker-report-observation'
import type { OrchestrationDb } from './orchestration-db'

// Caller owns the lifecycle transaction, including sequence allocation and replay validation.
export function recordAcceptedWorkerReportFact(
  db: OrchestrationDb,
  params: {
    taskId: string
    dispatchId: string
    outcome: WorkerReportOutcome
    observation?: WorkerReportObservation
  }
): void {
  const observation = params.observation
  if (
    !observation ||
    !db.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attempt_observation_facts'"
      )
      .get()
  ) {
    return
  }
  if (
    !observation.id ||
    !observation.authorityId ||
    !Number.isFinite(observation.homeReceivedAt) ||
    observation.homeReceivedAt < 0
  ) {
    throw new OrchestrationError('invalid_observation', 'Invalid worker report observation.')
  }
  // Match F's canonical payload and clock fields, without importing its attempt framework.
  const fact = {
    dispatch_id: params.dispatchId,
    task_id: params.taskId,
    authority_id: observation.authorityId,
    authority_clock: 'home',
    facet: 'worker_report',
    payload: JSON.stringify({
      outcome: params.outcome,
      reportId: observation.id,
      status: 'accepted'
    }),
    source_observed_at: null,
    execution_received_at: null,
    home_received_at: observation.homeReceivedAt
  }
  const existing = db.db
    .prepare('SELECT * FROM attempt_observation_facts WHERE id = ?')
    .get(observation.id) as Record<string, unknown> | undefined
  if (existing) {
    if (Object.entries(fact).some(([key, value]) => existing[key] !== value)) {
      throw new OrchestrationError(
        'observation_replay_conflict',
        `Observation ${observation.id} was replayed with different content.`
      )
    }
    return
  }
  db.db
    .prepare(
      `INSERT INTO attempt_observation_facts (
        id, dispatch_id, task_id, sequence, authority_id, authority_clock, facet, payload,
        source_observed_at, execution_received_at, home_received_at
      ) VALUES (?, ?, ?, (
        SELECT COALESCE(MAX(sequence), -1) + 1 FROM attempt_observation_facts WHERE dispatch_id = ?
      ), ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      observation.id,
      params.dispatchId,
      params.taskId,
      params.dispatchId,
      fact.authority_id,
      fact.authority_clock,
      fact.facet,
      fact.payload,
      fact.source_observed_at,
      fact.execution_received_at,
      fact.home_received_at
    )
}
