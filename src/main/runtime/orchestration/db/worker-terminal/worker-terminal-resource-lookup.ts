import type { WorkerTerminalResourceRow } from '../../worker-terminal-ownership'
import type { OrchestrationDb } from '../orchestration-db'

export function getWorkerTerminalResource(
  this: OrchestrationDb,
  id: string
): WorkerTerminalResourceRow | undefined {
  return this.db.prepare('SELECT * FROM worker_terminal_resources WHERE id = ?').get(id) as
    | WorkerTerminalResourceRow
    | undefined
}

export function getWorkerTerminalResourceByOwner(
  this: OrchestrationDb,
  dispatchId: string
): WorkerTerminalResourceRow | undefined {
  return this.db
    .prepare('SELECT * FROM worker_terminal_resources WHERE owner_dispatch_id = ?')
    .get(dispatchId) as WorkerTerminalResourceRow | undefined
}

export function getWorkerTerminalResourceByHandle(
  this: OrchestrationDb,
  terminalHandle: string
): WorkerTerminalResourceRow | undefined {
  return this.db
    .prepare(
      `SELECT * FROM worker_terminal_resources
        WHERE terminal_handle = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(terminalHandle) as WorkerTerminalResourceRow | undefined
}

export function getWorkerTerminalResourceFormerlyOwnedBy(
  this: OrchestrationDb,
  dispatchId: string
): WorkerTerminalResourceRow | undefined {
  return this.db
    .prepare(
      `SELECT * FROM worker_terminal_resources
        WHERE prior_owner_dispatch_ids LIKE ?
        ORDER BY updated_at DESC LIMIT 1`
    )
    .get(`%"${dispatchId}"%`) as WorkerTerminalResourceRow | undefined
}

export function recordWorkerTerminalRecoveryAttempt(
  this: OrchestrationDb,
  resourceId: string
): WorkerTerminalResourceRow | undefined {
  this.db
    .prepare(
      `UPDATE worker_terminal_resources
          SET recovery_attempt_count = MIN(recovery_attempt_count + 1, 32),
              last_recovery_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`
    )
    .run(resourceId)
  return this.getWorkerTerminalResource(resourceId)
}
