import { existsSync } from 'node:fs'
import Database from '../../../../sqlite/sync-database'
import { assertPersistedSchema39Shape } from './persisted-schema39-shape'
import { assertNoActiveStructuredWorkers } from './persisted-schema39-active-structured'

export type PersistedSchemaProfile = 'stable30' | 'fork39' | 'stable40'

const FORK_COLUMNS = [
  ['messages', ['pointer_enter_pending', 'pointer_pty_id', 'pointer_process_incarnation']],
  ['deliveries', ['mailbox_handle']],
  [
    'dispatch_contexts',
    [
      'retry_of_dispatch_id',
      'creator_dispatch_id',
      'host_scope',
      'consumer_generation',
      'creator_handle',
      'creator_pane_key'
    ]
  ],
  ['remote_dispatch_attachments', ['consumer_generation']],
  [
    'worker_terminal_resources',
    ['endpoint_id', 'endpoint_incarnation', 'recovery_attempt_count', 'last_recovery_at']
  ]
] as const

export class UnsupportedPersistedSchemaError extends Error {
  readonly code = 'unsupported_persisted_schema'

  constructor(
    readonly storedVersion: number,
    reason: string
  ) {
    super(
      `Orchestration database schema ${storedVersion} is not supported by this build: ${reason}. ` +
        'Opening was refused before schema initialization; use a compatible build. ' +
        'Do not lower user_version or recreate tables.'
    )
    this.name = 'UnsupportedPersistedSchemaError'
  }
}

export function assertPersistedSchemaFileCompatibility(dbPath: string): void {
  if (dbPath === ':memory:' || !existsSync(dbPath)) {
    return
  }
  // A writable probe can checkpoint a rejected WAL database on close, without executing any DDL.
  const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    assertPersistedSchemaCompatibility(probe)
  } finally {
    probe.close()
  }
}

// Inspect this connection before WAL, DDL, migrations, routing backfills, or file hardening.
export function assertPersistedSchemaCompatibility(db: Database.Database): PersistedSchemaProfile {
  const version = db.pragma('user_version', { simple: true }) as number
  if (!Number.isInteger(version) || version < 0 || version > 40) {
    throw new UnsupportedPersistedSchemaError(version, 'unknown schema version')
  }
  if (version === 39) {
    assertPersistedSchema39Shape(db)
    assertNoActiveStructuredWorkers(db)
    return 'fork39'
  }
  // Official schema-skew recovery can repair older stamps; fork39 never had this column.
  const hasOfficialHomeRun = db
    .prepare(
      "SELECT 1 FROM pragma_table_info('remote_dispatch_attachments') WHERE name = 'home_run_id'"
    )
    .get()
  if (hasOfficialHomeRun) {
    return 'stable40'
  }
  if (version > 30) {
    throw new UnsupportedPersistedSchemaError(
      version,
      'only legacy/stable30, validated fork39, and official schema40 profiles are admitted'
    )
  }

  // A lowered/incomplete stamp must not send fork facts through the legacy repair migrations.
  for (const [table, columns] of FORK_COLUMNS) {
    const persisted = db.pragma(`table_info(${table})`) as { name: string }[]
    const forwardColumn = persisted.find((row) => columns.some((column) => column === row.name))
    if (forwardColumn) {
      throw new UnsupportedPersistedSchemaError(
        version,
        `newer persisted field ${table}.${forwardColumn.name}`
      )
    }
  }
  const forwardTable = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name IN ('attempt_observation_facts', 'structured_pointer_operations',
                    'lifecycle_transition_receipts')`
    )
    .get() as { name: string } | undefined
  if (forwardTable) {
    throw new UnsupportedPersistedSchemaError(version, `newer persisted table ${forwardTable.name}`)
  }
  const archive = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'worker_terminal_archives'"
    )
    .get() as { sql: string } | undefined
  if (archive?.sql.includes('structured_journal')) {
    throw new UnsupportedPersistedSchemaError(version, 'newer structured journal archive contract')
  }
  return 'stable30'
}
