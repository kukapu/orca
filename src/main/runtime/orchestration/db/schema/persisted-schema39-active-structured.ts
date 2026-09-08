import type Database from '../../../../sqlite/sync-database'
import { isPersistedStructuredWorkerIdentity } from '../../persisted-structured-worker-identity'
import { UnsupportedPersistedSchemaError } from './persisted-schema-compatibility'

// This is an execution-capability gate, not a liveness verdict or a cleanup/recovery operation.
export function assertNoActiveStructuredWorkers(db: Database.Database): void {
  const queries = [
    `SELECT id, coordinator_handle, coordinator_pane_key FROM runs WHERE legacy = 0`,
    `SELECT id, terminal_handle, pane_key, process_incarnation, endpoint_id, endpoint_incarnation
     FROM worker_terminal_resources
     WHERE ownership_state != 'released' OR release_state != 'released'`,
    `SELECT id, assignee_handle, assignee_pane_key, process_incarnation FROM dispatch_contexts
     WHERE status IN ('pending', 'dispatched')
       OR (capability_hash IS NOT NULL
           AND (capability_revoked_at IS NULL OR capability_revoked_at = ''))`,
    `SELECT dispatch_id, agent_terminal_handle FROM worker_dispatches
     WHERE state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
       OR (state IN ('succeeded', 'failed') AND NOT EXISTS (
         SELECT 1 FROM worker_terminal_resources AS resource
         WHERE resource.owner_dispatch_id = worker_dispatches.dispatch_id
           AND resource.terminal_handle = worker_dispatches.agent_terminal_handle
           AND resource.ownership_state = 'released' AND resource.release_state = 'released'
           AND NOT EXISTS (
             SELECT 1 FROM dispatch_contexts AS binding
             WHERE binding.id = worker_dispatches.dispatch_id
               AND binding.process_incarnation IS NOT NULL
               AND binding.process_incarnation IS NOT resource.process_incarnation
           )
       ))`,
    `SELECT dispatch_id, terminal_handle, pane_key, process_incarnation FROM remote_dispatch_attachments
     WHERE state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
       OR capability_hash IS NOT NULL`
  ]
  for (const query of queries) {
    for (const row of db.prepare(query).iterate()) {
      const { id, dispatch_id, ...identity } = row
      if (isPersistedStructuredWorkerIdentity(...(Object.values(identity) as (string | null)[]))) {
        throw new UnsupportedPersistedSchemaError(
          39,
          `active or unreleased structured worker ${String(id ?? dispatch_id)} requires a compatible structured runtime`
        )
      }
    }
  }
}
