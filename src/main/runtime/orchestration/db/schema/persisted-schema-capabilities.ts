import type Database from '../../../../sqlite/sync-database'
import {
  assertPersistedSchemaCompatibility,
  UnsupportedPersistedSchemaError
} from './persisted-schema-compatibility'

export type PersistedSchemaCapabilities = Readonly<{
  profile: 'stable30' | 'fork39'
  mailboxScopedDeliveries: boolean
  pointerReservations: boolean
  dispatchConsumerGeneration: boolean
  remoteConsumerGeneration: boolean
}>

type Column = { name: string; type: string; notnull: number; dflt_value: string | null }
const connectionCapabilities = new WeakMap<
  Database.Database,
  { version: number; schemaCookie: number; capabilities: PersistedSchemaCapabilities }
>()

// Capabilities describe this connection's mailbox schema, NOT whole-application admission.
export function getPersistedSchemaCapabilities(db: Database.Database): PersistedSchemaCapabilities {
  const version = db.pragma('user_version', { simple: true }) as number
  const schemaCookie = db.pragma('schema_version', { simple: true }) as number
  const cached = connectionCapabilities.get(db)
  if (cached?.version === version && cached.schemaCookie === schemaCookie) {
    return cached.capabilities
  }
  if (version !== 39) {
    assertPersistedSchemaCompatibility(db)
  } else {
    assertForkMailboxShape(db)
  }
  const fork = version === 39
  const capabilities: PersistedSchemaCapabilities = Object.freeze({
    profile: fork ? 'fork39' : 'stable30',
    mailboxScopedDeliveries: fork,
    pointerReservations: fork,
    dispatchConsumerGeneration: fork,
    remoteConsumerGeneration: fork
  })
  connectionCapabilities.set(db, { version, schemaCookie, capabilities })
  return capabilities
}

function assertForkMailboxShape(db: Database.Database): void {
  const required = [
    ['deliveries', 'mailbox_handle', 'TEXT', 1, "''"],
    ['messages', 'pointer_enter_pending', 'INTEGER', 1, '0'],
    ['messages', 'pointer_pty_id', 'TEXT', 0, null],
    ['messages', 'pointer_process_incarnation', 'TEXT', 0, null],
    ['dispatch_contexts', 'consumer_generation', 'INTEGER', 1, '0'],
    ['remote_dispatch_attachments', 'consumer_generation', 'INTEGER', 1, '0']
  ] as const
  for (const [table, name, type, notnull, defaultValue] of required) {
    const columns = db.pragma(`table_info(${table})`) as Column[]
    if (
      !columns.some(
        (column) =>
          column.name === name &&
          column.type === type &&
          column.notnull === notnull &&
          column.dflt_value === defaultValue
      )
    ) {
      throw new UnsupportedPersistedSchemaError(39, `incomplete mailbox field ${table}.${name}`)
    }
  }
  const index = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_deliveries_one_outstanding'"
    )
    .get() as { sql: string } | undefined
  const sql = index?.sql.replace(/\s+/g, ' ').trim().replace(/;$/, '')
  if (
    !sql ||
    !/^CREATE UNIQUE INDEX (?:IF NOT EXISTS )?idx_deliveries_one_outstanding ON deliveries\(mailbox_handle\) WHERE status = 'outstanding' AND mailbox_handle != ''$/i.test(
      sql
    )
  ) {
    throw new UnsupportedPersistedSchemaError(39, 'incomplete mailbox uniqueness contract')
  }
}
