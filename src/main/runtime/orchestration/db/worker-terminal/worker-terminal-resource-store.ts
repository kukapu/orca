import type {
  WorkerTerminalResourceRow,
  WorkerTerminalOwnershipState
} from '../../worker-terminal-ownership'
import { WORKER_SETTLED_STATES } from '../../worker-terminal-ownership'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import { persistedDispatchIdentityFields } from '../persisted-dispatch-identity'
import { isEquivalentPaneKey } from '../pane-key-match'
import { isPersistedStructuredWorkerResource } from '../../worker-terminal-ownership'
import { isPersistedStructuredWorkerIdentity } from '../../persisted-structured-worker-identity'
import {
  getWorkerTerminalResource,
  getWorkerTerminalResourceByHandle,
  getWorkerTerminalResourceByOwner,
  getWorkerTerminalResourceFormerlyOwnedBy,
  recordWorkerTerminalRecoveryAttempt
} from './worker-terminal-resource-lookup'

// --- Worker terminal resources (schema v23) ---------------------------------------------------

// Historical renderer input and reuse cannot be proven, so pre-v23 terminals stay external.
export function backfillWorkerTerminalResources(this: OrchestrationDb): void {
  const rows = this.db
    .prepare(
      `SELECT w.dispatch_id, w.worktree_id, w.agent_terminal_handle,
              d.assignee_pane_key, d.process_incarnation
         FROM worker_dispatches w
         JOIN dispatch_contexts d ON d.id = w.dispatch_id
        WHERE w.agent_terminal_handle IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM federated_dispatches f WHERE f.dispatch_id = w.dispatch_id)
          AND NOT EXISTS (
            SELECT 1 FROM worker_terminal_resources r WHERE r.owner_dispatch_id = w.dispatch_id
          )`
    )
    .all() as {
    dispatch_id: string
    worktree_id: string | null
    agent_terminal_handle: string
    assignee_pane_key: string | null
    process_incarnation: string | null
  }[]
  const insert = this.db.prepare(
    `INSERT INTO worker_terminal_resources (
       id, origin_dispatch_id, owner_dispatch_id, worktree_id, terminal_handle,
       pane_key, process_incarnation, ownership_state, release_state, retained_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    insert.run(
      generateId('wtr'),
      row.dispatch_id,
      row.dispatch_id,
      row.worktree_id,
      row.agent_terminal_handle,
      row.assignee_pane_key,
      row.process_incarnation,
      'external',
      'retained',
      'legacy_ambiguous'
    )
  }
}

// No transaction: composes inside worker-start's authority transaction.
export function createWorkerTerminalResourceStatement(
  this: OrchestrationDb,
  params: {
    dispatchId: string
    worktreeId: string | null
    terminalHandle: string
    paneKey: string | null
    processIncarnation: string | null
    endpointId?: string | null
    endpointIncarnation?: string | null
    hostScope?: string | null
    ownership: Extract<WorkerTerminalOwnershipState, 'owned' | 'external'>
  }
): WorkerTerminalResourceRow {
  const id = generateId('wtr')
  const identity = persistedDispatchIdentityFields(this.db, 'worker_terminal_resources', {
    endpoint_id: params.endpointId ?? null,
    endpoint_incarnation: params.endpointIncarnation ?? params.processIncarnation
  })
  this.db
    .prepare(
      `INSERT INTO worker_terminal_resources (
         id, origin_dispatch_id, owner_dispatch_id, worktree_id, terminal_handle,
         pane_key, process_incarnation, host_scope, ownership_state, release_state,
         retained_reason ${identity.map(([column]) => `, ${column}`).join('')}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_requested', ?${', ?'.repeat(identity.length)})`
    )
    .run(
      id,
      params.dispatchId,
      params.dispatchId,
      params.worktreeId,
      params.terminalHandle,
      params.paneKey,
      params.processIncarnation,
      params.hostScope ?? null,
      params.ownership,
      params.ownership === 'external' ? 'external_terminal' : null,
      ...identity.map(([, value]) => value)
    )
  return this.getWorkerTerminalResource(id) as WorkerTerminalResourceRow
}

// Reusable exact settled terminal: transfers cleanup ownership to the new Dispatch and fences
// release through the old owner. No transaction: composes inside the authority transaction.
export function transferWorkerTerminalResourceStatement(
  this: OrchestrationDb,
  params: {
    resourceId: string
    toDispatchId: string
    terminalHandle: string
    paneKey: string
    processIncarnation: string
    endpointId?: string | null
    endpointIncarnation?: string | null
    hostScope: string | null
  }
): WorkerTerminalResourceRow {
  const resource = this.getWorkerTerminalResource(params.resourceId)
  if (!resource) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Worker terminal resource ${params.resourceId} was not found.`
    )
  }
  if (
    isPersistedStructuredWorkerResource(
      resource,
      this.getWorkerTerminalArchive(resource.owner_dispatch_id)
    ) ||
    isPersistedStructuredWorkerIdentity(
      params.paneKey,
      params.processIncarnation,
      params.terminalHandle
    )
  ) {
    throw new OrchestrationError(
      'request_mismatch',
      'A structured resource cannot transfer native terminal ownership.'
    )
  }
  const priorOwners = JSON.parse(resource.prior_owner_dispatch_ids) as string[]
  priorOwners.push(resource.owner_dispatch_id)
  const identity = persistedDispatchIdentityFields(this.db, 'worker_terminal_resources', {
    endpoint_id: params.endpointId ?? null,
    endpoint_incarnation: params.endpointIncarnation ?? params.processIncarnation
  })
  this.db
    .prepare(
      `UPDATE worker_terminal_resources
       SET owner_dispatch_id = ?, prior_owner_dispatch_ids = ?, release_state = 'not_requested',
           retained_reason = NULL, release_requested_at = NULL, release_completed_at = NULL,
           release_error = NULL, terminal_handle = ?, pane_key = ?, process_incarnation = ?,
           host_scope = ?, updated_at = datetime('now')
           ${identity.map(([column]) => `, ${column} = ${column === 'endpoint_id' ? 'COALESCE(?, endpoint_id)' : '?'}`).join('')}
       WHERE id = ? AND ownership_state = 'owned'`
    )
    .run(
      params.toDispatchId,
      JSON.stringify(priorOwners),
      params.terminalHandle,
      params.paneKey,
      params.processIncarnation,
      params.hostScope,
      ...identity.map(([, value]) => value),
      params.resourceId
    )
  return this.getWorkerTerminalResource(params.resourceId) as WorkerTerminalResourceRow
}

// Transaction-neutral: authority/fence and this resource must commit or roll back together.
export function rebindWorkerTerminalResourceStatement(
  this: OrchestrationDb,
  params: {
    dispatchId: string
    paneKey: string
    processIncarnation: string
    terminalHandle?: string
    endpointId?: string | null
    hostScope?: string | null
  }
): void {
  const resource = this.getWorkerTerminalResourceByOwner(params.dispatchId)
  if (!resource) {
    return
  }
  if (
    isPersistedStructuredWorkerResource(
      resource,
      this.getWorkerTerminalArchive(params.dispatchId)
    ) ||
    isPersistedStructuredWorkerIdentity(
      params.paneKey,
      params.processIncarnation,
      params.terminalHandle
    ) ||
    !['owned', 'external', 'user_owned'].includes(resource.ownership_state) ||
    !resource.pane_key ||
    !isEquivalentPaneKey(resource.pane_key, params.paneKey) ||
    resource.process_incarnation !== params.processIncarnation ||
    (params.hostScope !== undefined && resource.host_scope !== params.hostScope)
  ) {
    throw new OrchestrationError(
      'request_mismatch',
      `Dispatch ${params.dispatchId} cannot rebind its historical terminal resource to an unproven identity.`
    )
  }
  if (!['not_requested', 'retained'].includes(resource.release_state)) {
    throw new OrchestrationError(
      'terminal_release_in_progress',
      `Dispatch ${params.dispatchId} has a terminal release in progress.`
    )
  }
  const identity = persistedDispatchIdentityFields(this.db, 'worker_terminal_resources', {
    endpoint_id: params.endpointId ?? null,
    endpoint_incarnation: params.processIncarnation
  })
  this.db
    .prepare(
      `UPDATE worker_terminal_resources SET terminal_handle = COALESCE(?, terminal_handle),
       pane_key = ?, updated_at = datetime('now')
       ${identity.map(([column]) => `, ${column} = ${column === 'endpoint_id' ? 'COALESCE(?, endpoint_id)' : '?'}`).join('')}
     WHERE id = ? AND owner_dispatch_id = ?`
    )
    .run(
      params.terminalHandle ?? null,
      params.paneKey,
      ...identity.map(([, value]) => value),
      resource.id,
      params.dispatchId
    )
}

// A new process in the same pane is ordinary user work, not the settled Dispatch's resource.
export function retainReplacedWorkerTerminalResources(
  this: OrchestrationDb,
  params: { paneKey: string; worktreeId: string; hostScope: string; processIncarnation: string }
): number {
  return Number(
    this.db
      .prepare(
        `UPDATE worker_terminal_resources
          SET release_state = 'retained', retained_reason = 'identity_unproven',
              updated_at = datetime('now')
        WHERE pane_key = ? AND worktree_id = ? AND host_scope = ?
          AND process_incarnation IS NOT NULL AND process_incarnation != ?
          AND ownership_state = 'owned' AND release_state = 'not_requested'
          AND EXISTS (
            SELECT 1 FROM worker_dispatches w
             WHERE w.dispatch_id = worker_terminal_resources.owner_dispatch_id
               AND w.state IN (${WORKER_SETTLED_STATES.map(() => '?').join(', ')})
          )`
      )
      .run(
        params.paneKey,
        params.worktreeId,
        params.hostScope,
        params.processIncarnation,
        ...WORKER_SETTLED_STATES
      ).changes
  )
}

export type WorkerTerminalResourceStoreMethods = {
  retainReplacedWorkerTerminalResources: typeof retainReplacedWorkerTerminalResources
  backfillWorkerTerminalResources: typeof backfillWorkerTerminalResources
  createWorkerTerminalResourceStatement: typeof createWorkerTerminalResourceStatement
  getWorkerTerminalResource: typeof getWorkerTerminalResource
  getWorkerTerminalResourceByHandle: typeof getWorkerTerminalResourceByHandle
  getWorkerTerminalResourceByOwner: typeof getWorkerTerminalResourceByOwner
  getWorkerTerminalResourceFormerlyOwnedBy: typeof getWorkerTerminalResourceFormerlyOwnedBy
  recordWorkerTerminalRecoveryAttempt: typeof recordWorkerTerminalRecoveryAttempt
  transferWorkerTerminalResourceStatement: typeof transferWorkerTerminalResourceStatement
  rebindWorkerTerminalResourceStatement: typeof rebindWorkerTerminalResourceStatement
}

export function attachWorkerTerminalResourceStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    retainReplacedWorkerTerminalResources,
    backfillWorkerTerminalResources,
    createWorkerTerminalResourceStatement,
    getWorkerTerminalResource,
    getWorkerTerminalResourceByHandle,
    getWorkerTerminalResourceByOwner,
    getWorkerTerminalResourceFormerlyOwnedBy,
    recordWorkerTerminalRecoveryAttempt,
    transferWorkerTerminalResourceStatement,
    rebindWorkerTerminalResourceStatement
  })
}
