import type { WorkerTerminalResourceRow } from '../../worker-terminal-ownership'
import { OrchestrationError } from '../../orchestration-error'
import { isEquivalentPaneKey } from '../pane-key-match'
import type { OrchestrationDb } from '../orchestration-db'
import {
  isPersistedStructuredWorkerResource,
  WORKER_SETTLED_STATES
} from '../../worker-terminal-ownership'

// Finds an owned, settled, exact-match resource for an explicitly reused terminal.
export function findTransferableWorkerTerminalResource(
  this: OrchestrationDb,
  params: {
    terminalHandle: string
    paneKey: string | null
    processIncarnation: string | null
    hostScope: string | null
  }
): WorkerTerminalResourceRow | undefined {
  if (!params.paneKey || !params.processIncarnation) {
    return undefined
  }
  const candidates = this.db
    .prepare(
      `SELECT r.* FROM worker_terminal_resources r
         LEFT JOIN worker_dispatches w ON w.dispatch_id = r.owner_dispatch_id
         LEFT JOIN remote_dispatch_attachments a ON a.dispatch_id = r.owner_dispatch_id
         WHERE r.process_incarnation = ? AND r.host_scope IS ?
           AND (w.dispatch_id IS NOT NULL OR a.dispatch_id IS NOT NULL)
          AND r.ownership_state != 'released'`
    )
    .all(params.processIncarnation, params.hostScope) as WorkerTerminalResourceRow[]
  const exact = candidates.filter(
    (candidate) =>
      candidate.pane_key &&
      params.paneKey &&
      isEquivalentPaneKey(candidate.pane_key, params.paneKey) &&
      candidate.process_incarnation === params.processIncarnation &&
      candidate.host_scope === params.hostScope
  )
  if (
    exact.some((candidate) =>
      ['requested', 'releasing', 'unknown'].includes(candidate.release_state)
    )
  ) {
    throw new OrchestrationError(
      'terminal_release_in_progress',
      `Terminal ${params.terminalHandle} has a release in progress; wait for cleanup or use another terminal.`
    )
  }
  return exact.find((candidate) => {
    if (
      candidate.ownership_state !== 'owned' ||
      !['not_requested', 'retained'].includes(candidate.release_state) ||
      isPersistedStructuredWorkerResource(
        candidate,
        this.getWorkerTerminalArchive(candidate.owner_dispatch_id)
      )
    ) {
      return false
    }
    const local = this.getWorkerDispatch(candidate.owner_dispatch_id)
    const remote = this.getRemoteDispatchAttachment(candidate.owner_dispatch_id)
    // This transfers an ownership lock, never a verdict that the process exited.
    return Boolean(
      (local || remote) &&
      (!local || WORKER_SETTLED_STATES.includes(local.state)) &&
      (!remote ||
        (WORKER_SETTLED_STATES.includes(remote.state) &&
          !this.isUnobservedPromptAttachment(remote, { requireRetainedCapability: false })))
    )
  })
}

export function workerTerminalResourceHasIdentityConflict(
  this: OrchestrationDb,
  resourceId: string
): boolean {
  const resource = this.getWorkerTerminalResource(resourceId)
  if (!resource?.pane_key || !resource.process_incarnation) {
    return true
  }
  const candidates = this.db
    .prepare(
      `SELECT * FROM worker_terminal_resources
        WHERE process_incarnation = ? AND host_scope IS ?
          AND id != ? AND ownership_state != 'released'`
    )
    .all(
      resource.process_incarnation,
      resource.host_scope,
      resource.id
    ) as WorkerTerminalResourceRow[]
  return candidates.some(
    (candidate) =>
      candidate.pane_key &&
      isEquivalentPaneKey(candidate.pane_key, resource.pane_key as string) &&
      candidate.process_incarnation === resource.process_incarnation &&
      candidate.host_scope === resource.host_scope
  )
}

export type WorkerTerminalTransferMethods = {
  findTransferableWorkerTerminalResource: typeof findTransferableWorkerTerminalResource
  workerTerminalResourceHasIdentityConflict: typeof workerTerminalResourceHasIdentityConflict
}

export function attachWorkerTerminalTransfer(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    findTransferableWorkerTerminalResource,
    workerTerminalResourceHasIdentityConflict
  })
}
