import Database from '../../../../sqlite/sync-database'
import { createSchema30TablesSql } from './schema30-reference-tables'
import {
  SCHEMA39_REFERENCE_ADDITIONS,
  SCHEMA39_ROUTING_TRIGGER
} from './schema39-reference-additions'
import { SCHEMA39_REFERENCE_LEGACY } from './schema39-reference-legacy'
import { UnsupportedPersistedSchemaError } from './persisted-schema-compatibility'

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null }
type Column = {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}
type TableShape = { columns: string; uniqueKeys: string; checks: string; autoincrement: boolean }
type ReferenceShape = { objects: SchemaObject[]; tables: Map<string, TableShape> }
let referenceShape: ReferenceShape | undefined

function quoted(name: string): string {
  return `'${name.replaceAll("'", "''")}'`
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/('(?:''|[^'])*')|--[^\n]*/g, (_match, literal: string | undefined) => literal ?? '')
    .split(/('(?:''|[^'])*')/)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\bIF NOT EXISTS\b/gi, '')
            .replace(/[\s"`;]/g, '')
            .toLowerCase()
    )
    .join('')
}

function checkConstraints(sql: string): string[] {
  const checks: string[] = []
  const start = /\bCHECK\s*\(/gi
  for (let match = start.exec(sql); match; match = start.exec(sql)) {
    let depth = 1
    let quoted = false
    let end = start.lastIndex
    for (; end < sql.length && depth > 0; end++) {
      const character = sql[end]
      if (character === "'") {
        if (quoted && sql[end + 1] === "'") {
          end++
        } else {
          quoted = !quoted
        }
      } else if (!quoted) {
        if (character === '(') {
          depth++
        }
        if (character === ')') {
          depth--
        }
      }
    }
    checks.push(normalizeSql(sql.slice(match.index, end)))
    start.lastIndex = end
  }
  return checks.sort()
}

function tableShape(db: Database.Database, name: string, sql: string): TableShape {
  const columns = (db.pragma(`table_xinfo(${quoted(name)})`) as (Column & { hidden: number })[])
    .map(({ name, type, notnull, dflt_value, pk, hidden }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
      hidden
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const indexes = db.pragma(`index_list(${quoted(name)})`) as {
    name: string
    unique: number
    partial: number
  }[]
  const uniqueKeys = indexes
    .filter((index) => index.unique)
    .map((index) => {
      const keys = db.pragma(`index_xinfo(${quoted(index.name)})`) as {
        name: string
        desc: number
        coll: string
        key: number
      }[]
      return JSON.stringify({
        partial: index.partial,
        keys: keys.filter((key) => key.key).map(({ name, desc, coll }) => ({ name, desc, coll }))
      })
    })
    .sort()
  const checks = checkConstraints(sql)
  const grammar = sql.replace(/'(?:''|[^'])*'/g, "''")
  if (/\bCOLLATE\b|\bON\s+CONFLICT\b|\bWITHOUT\s+ROWID\b|\bSTRICT\b/i.test(grammar)) {
    throw new UnsupportedPersistedSchemaError(39, `unexpected table semantics on ${name}`)
  }
  // Unexpected foreign keys and generated columns are not an additive schema39 contract.
  if ((db.pragma(`foreign_key_list(${quoted(name)})`) as unknown[]).length) {
    throw new UnsupportedPersistedSchemaError(39, `unexpected foreign keys on ${name}`)
  }
  return {
    columns: JSON.stringify(columns),
    uniqueKeys: JSON.stringify(uniqueKeys),
    checks: JSON.stringify(checks),
    autoincrement: /\bAUTOINCREMENT\b/i.test(grammar)
  }
}

// SQLite derives the reference from known DDL in an isolated memory DB, never the user's file.
export function getSchema39ReferenceShape(): ReferenceShape {
  if (referenceShape) {
    return referenceShape
  }
  const reference = new Database(':memory:')
  try {
    reference.exec(
      createSchema30TablesSql() +
        SCHEMA39_REFERENCE_LEGACY +
        SCHEMA39_REFERENCE_ADDITIONS +
        SCHEMA39_ROUTING_TRIGGER
    )
    const objects = reference
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as SchemaObject[]
    const tables = new Map(
      objects
        .filter((row) => row.type === 'table')
        .map((row) => [row.name, tableShape(reference, row.name, row.sql!)])
    )
    referenceShape = { objects, tables }
    return referenceShape
  } finally {
    reference.close()
  }
}

export function assertPersistedSchema39Shape(db: Database.Database): void {
  const reference = getSchema39ReferenceShape()
  const actual = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all() as SchemaObject[]
  const byName = new Map(actual.map((row) => [row.name, row]))
  for (const expected of reference.objects) {
    const persisted = byName.get(expected.name)
    if (
      !persisted ||
      persisted.type !== expected.type ||
      persisted.tbl_name !== expected.tbl_name
    ) {
      throw new UnsupportedPersistedSchemaError(
        39,
        `missing or incompatible ${expected.type} ${expected.name}`
      )
    }
    const matches =
      expected.type === 'table'
        ? JSON.stringify(tableShape(db, persisted.name, persisted.sql!)) ===
          JSON.stringify(reference.tables.get(expected.name))
        : normalizeSql(persisted.sql!) === normalizeSql(expected.sql!)
    if (!matches) {
      throw new UnsupportedPersistedSchemaError(
        39,
        `incompatible ${expected.type} ${expected.name}`
      )
    }
  }
  const known = new Set(reference.objects.map((row) => row.name))
  for (const row of actual) {
    if (row.type === 'trigger' && reference.tables.has(row.tbl_name) && !known.has(row.name)) {
      throw new UnsupportedPersistedSchemaError(39, `unknown writer trigger ${row.name}`)
    }
  }
  const ledger = db
    .prepare('SELECT receipt_count FROM mutation_receipt_ledger WHERE singleton = 1')
    .get() as { receipt_count: number } | undefined
  const count = db.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as {
    count: number
  }
  if (ledger?.receipt_count !== count.count) {
    throw new UnsupportedPersistedSchemaError(39, 'incomplete mutation receipt ledger')
  }
}
