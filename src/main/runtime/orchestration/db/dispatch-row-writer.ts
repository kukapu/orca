import type Database from '../../../sqlite/sync-database'
import { DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL } from './pane-key-match'
import { persistedDispatchIdentityFields } from './persisted-dispatch-identity'

/**
 * The only place that inserts rows representing a live supervised worker.
 *
 * Why centralized: nesting depth must be stamped on every such row, and three
 * separate modules used to own their own INSERT. A boundary test forbids these
 * statements anywhere else, so a new spawn path cannot skip the stamp.
 *
 * Transaction-neutral on purpose — each caller keeps its own BEGIN IMMEDIATE or
 * SAVEPOINT, mutation-receipt write, and companion inserts.
 */

function dispatchContextClaimSql(identityColumns: string[] = []): string {
  return `INSERT INTO dispatch_contexts (
  id, run_id, task_id, contract_version, launch_token_hash,
  assignee_handle, assignee_pane_key, process_incarnation,
  ${identityColumns.map((column) => `${column}, `).join('')}status, failure_count, depth, dispatched_at
)
SELECT ?, run_id, id, ?, ?, ?, ?, ?, ${'?, '.repeat(identityColumns.length)}'dispatched', ?, ?, datetime('now')
FROM tasks
WHERE id = ? AND status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_contexts active
    WHERE active.assignee_handle = ?
      AND active.status IN ('pending', 'dispatched')
  )
  AND (
    ? IS NULL OR NOT EXISTS (
      SELECT 1 FROM dispatch_contexts active
      WHERE active.assignee_pane_key = ?
        AND active.status IN ('pending', 'dispatched')
    )
  )
  AND (
    ? IS NULL OR NOT EXISTS (
      SELECT 1 FROM dispatch_contexts active
      WHERE active.assignee_pane_key IS NOT NULL
        AND active.status IN ('pending', 'dispatched')
        AND instr(active.assignee_pane_key, ':') > 1
        AND ${DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL} = ?
    )
  )`
}

export const DISPATCH_CONTEXT_CLAIM_SQL = dispatchContextClaimSql()

function startingDispatchContextSql(identityColumns: string[]): string {
  return `INSERT INTO dispatch_contexts (
   id, run_id, task_id, contract_version, launch_token_hash, depth, status, dispatched_at
   ${identityColumns.map((column) => `, ${column}`).join('')}
 ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now')${', ?'.repeat(identityColumns.length)})`
}

const REMOTE_DISPATCH_ATTACHMENT_SQL = `INSERT INTO remote_dispatch_attachments (
   dispatch_id, task_id, home_peer_fingerprint, protocol_version, runtime_epoch, depth
 ) VALUES (?, ?, ?, ?, ?, ?)`

/** Last line of defence: a row that reached here unstamped would read as a root. */
function assertStampedDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(
      `Refusing to write a live-worker row with depth ${depth}; expected an integer >= 1.`
    )
  }
}

/** Prepare before the claim savepoint: schema reads must not pin its read snapshot. */
export function prepareDispatchContextClaim(
  db: Database.Database,
  params: {
    id: string
    contractVersion: number
    launchTokenHash: string | null
    assigneeHandle: string
    assigneePaneKey: string | null
    processIncarnation: string | null
    creatorDispatchId?: string | null
    creatorHandle?: string | null
    creatorPaneKey?: string | null
    priorFailures: number
    depth: number
    taskId: string
    paneSuffix: string | null
  }
): () => { changes: number | bigint } {
  assertStampedDepth(params.depth)
  const identity = persistedDispatchIdentityFields(db, 'dispatch_contexts', {
    creator_dispatch_id: params.creatorDispatchId ?? null,
    creator_handle: params.creatorHandle ?? null,
    creator_pane_key: params.creatorPaneKey ?? null
  })
  const statement = db.prepare(dispatchContextClaimSql(identity.map(([column]) => column)))
  const bindings = [
    params.id,
    params.contractVersion,
    params.launchTokenHash,
    params.assigneeHandle,
    params.assigneePaneKey,
    params.processIncarnation,
    ...identity.map(([, value]) => value),
    params.priorFailures,
    params.depth,
    params.taskId,
    params.assigneeHandle,
    params.assigneePaneKey,
    params.assigneePaneKey,
    params.paneSuffix,
    params.paneSuffix
  ]
  return () => statement.run(...bindings)
}

/** Supervised `worker-start`, including every retry and the federated home side. */
export function insertStartingDispatchContextRow(
  db: Database.Database,
  params: {
    id: string
    runId: string
    taskId: string
    contractVersion: number
    launchTokenHash: string | null
    depth: number
    retryOfDispatchId?: string | null
    creatorDispatchId?: string | null
    creatorHandle?: string | null
    creatorPaneKey?: string | null
  }
): void {
  assertStampedDepth(params.depth)
  const identity = persistedDispatchIdentityFields(db, 'dispatch_contexts', {
    retry_of_dispatch_id: params.retryOfDispatchId ?? null,
    creator_dispatch_id: params.creatorDispatchId ?? null,
    creator_handle: params.creatorHandle ?? null,
    creator_pane_key: params.creatorPaneKey ?? null
  })
  db.prepare(startingDispatchContextSql(identity.map(([column]) => column))).run(
    params.id,
    params.runId,
    params.taskId,
    params.contractVersion,
    params.launchTokenHash,
    params.depth,
    ...identity.map(([, value]) => value)
  )
}

/** The worker host's record of a live worker driven by a remote Run home. */
export function insertRemoteDispatchAttachmentRow(
  db: Database.Database,
  params: {
    dispatchId: string
    taskId: string
    homePeerFingerprint: string
    protocolVersion: number
    runtimeEpoch: string
    /** Propagated from the Run home, not computed here; absent (old client) = 1. */
    depth: number
  }
): void {
  assertStampedDepth(params.depth)
  db.prepare(REMOTE_DISPATCH_ATTACHMENT_SQL).run(
    params.dispatchId,
    params.taskId,
    params.homePeerFingerprint,
    params.protocolVersion,
    params.runtimeEpoch,
    params.depth
  )
}
