import type Database from '../../../sqlite/sync-database'

type IdentityTable = 'dispatch_contexts' | 'worker_terminal_resources'
type IdentityColumn =
  | 'retry_of_dispatch_id'
  | 'creator_dispatch_id'
  | 'creator_handle'
  | 'creator_pane_key'
  | 'host_scope'
  | 'endpoint_id'
  | 'endpoint_incarnation'

// Optional identity fields are not a schema-admission decision or a historical backfill.
export function persistedDispatchIdentityFields(
  db: Database.Database,
  table: IdentityTable,
  fields: Partial<Record<IdentityColumn, string | null>>
): [string, string | null][] {
  const columns = new Set(
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name)
  )
  return Object.entries(fields).filter(([column]) => columns.has(column))
}

// Preserve standalone writer locking without committing an enclosing caller's transaction.
export function beginDispatchAuthorityTransaction(db: Database.Database): {
  commit: () => void
  rollback: () => void
} {
  let nested = false
  try {
    db.exec('BEGIN IMMEDIATE')
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'cannot start a transaction within a transaction'
    ) {
      throw error
    }
    db.exec('SAVEPOINT dispatch_authority_identity')
    nested = true
  }
  return {
    commit: () => db.exec(nested ? 'RELEASE dispatch_authority_identity' : 'COMMIT'),
    rollback: () => {
      if (nested) {
        db.exec('ROLLBACK TO dispatch_authority_identity')
        db.exec('RELEASE dispatch_authority_identity')
      } else {
        db.exec('ROLLBACK')
      }
    }
  }
}
