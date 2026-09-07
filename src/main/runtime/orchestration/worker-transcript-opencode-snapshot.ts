import { createHash } from 'node:crypto'
import { MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES } from '../../native-chat/transcript-tail-reader'
import { columnExists, tableExists } from '../../opencode-usage/schema-helpers'
import type SyncDatabase from '../../sqlite/sync-database'
import { MAX_WORKER_TRANSCRIPT_MESSAGE_LIMIT } from './worker-transcript-payload'

const MAX_SNAPSHOT_PARTS_PER_MESSAGE = 64
const MAX_SNAPSHOT_CONTENT_BYTES = 2 * 1024 * 1024

export type SqliteMessageRow = {
  id: string
  time_created: number
  time_updated: number
  data: string
}

type SqlitePartRow = {
  id: string
  message_id: string
  time_created: number
  time_updated: number
  data: string
}

export type OpenCodeSnapshot = {
  rows: SqliteMessageRow[]
  partsByMessage: Map<string, SqlitePartRow[]>
  digest: string
  olderOmitted: boolean
  oversizedMessageCount: number
  oversizedPartCount: number
  partsOmittedCount: number
  partsBudgetExhausted: boolean
}

export function roleMessageFilter(): string {
  return `session_id = ? AND json_extract(data, '$.role') IN ('user','assistant')`
}

export function byteLengthExpr(): string {
  return 'length(CAST(data AS BLOB))'
}

// One sentinel row over the caps proves more rows exist without fetching payloads; every window
// query projects metadata plus the SQL byte length, never the data column itself.
export function snapshotMessageWindowSql(): string {
  return `SELECT id, time_created, time_updated, ${byteLengthExpr()} AS bytes
     FROM message
     WHERE ${roleMessageFilter()} AND ${byteLengthExpr()} <= ?
     ORDER BY time_created DESC, id DESC
     LIMIT ${MAX_WORKER_TRANSCRIPT_MESSAGE_LIMIT + 1}`
}

export function snapshotMessageDataSql(idCount: number): string {
  const placeholders = Array.from({ length: idCount }, () => '?').join(',')
  return `SELECT id, data FROM message
     WHERE id IN (${placeholders}) AND ${byteLengthExpr()} <= ?`
}

export type SnapshotPartWindowSqlOptions = {
  sessionFilter: string
  timeOrder: boolean
}

export function snapshotPartWindowSql(options: SnapshotPartWindowSqlOptions): string {
  const partOrder = options.timeOrder ? 'time_created ASC, id ASC' : 'id ASC'
  return `SELECT id, time_created, time_updated, ${byteLengthExpr()} AS bytes
     FROM part
     WHERE ${options.sessionFilter}message_id = ? AND ${byteLengthExpr()} <= ?
     ORDER BY ${partOrder}
     LIMIT ${MAX_SNAPSHOT_PARTS_PER_MESSAGE + 1}`
}

export function snapshotPartDataSql(idCount: number): string {
  const placeholders = Array.from({ length: idCount }, () => '?').join(',')
  return `SELECT id, data FROM part
     WHERE message_id = ? AND id IN (${placeholders}) AND ${byteLengthExpr()} <= ?`
}

export function buildOpenCodeSnapshot(
  db: SyncDatabase.Database,
  sessionId: string
): OpenCodeSnapshot {
  const window = selectSnapshotRows(db, sessionId)
  const messageBytes = window.rows.reduce(
    (total, row) => total + Buffer.byteLength(row.data, 'utf8'),
    0
  )
  const parts = loadSnapshotParts(
    db,
    sessionId,
    window.rows,
    Math.max(0, MAX_SNAPSHOT_CONTENT_BYTES - messageBytes)
  )
  return {
    rows: window.rows,
    partsByMessage: parts.byMessage,
    digest: hashOpenCodeSnapshot(sessionId, window.rows, parts.byMessage),
    olderOmitted: window.olderOmitted,
    oversizedMessageCount: countOversizedMessages(db, sessionId),
    oversizedPartCount: parts.oversizedCount,
    partsOmittedCount: parts.omittedCount,
    partsBudgetExhausted: parts.budgetExhausted
  }
}

type SnapshotMessageMetaRow = {
  id: string
  time_created: number
  time_updated: number
  bytes: number
}

type SnapshotPartMetaRow = {
  id: string
  time_created: number
  time_updated: number
  bytes: number
}

// SQL LIMIT keeps the sort over narrow metadata rows (the ORDER BY + LIMIT top-N plan never
// retains more than the cap), and payloads are fetched by primary key only after the byte
// budget has been decided from the SQL-reported lengths.
function selectSnapshotRows(
  db: SyncDatabase.Database,
  sessionId: string
): { rows: SqliteMessageRow[]; olderOmitted: boolean } {
  const metaRows = db
    .prepare(snapshotMessageWindowSql())
    .all(sessionId, MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) as SnapshotMessageMetaRow[]
  const window: SnapshotMessageMetaRow[] = []
  let usedBytes = 0
  let olderOmitted = false
  for (const row of metaRows) {
    if (window.length >= MAX_WORKER_TRANSCRIPT_MESSAGE_LIMIT) {
      olderOmitted = true
      break
    }
    if (window.length > 0 && usedBytes + row.bytes > MAX_SNAPSHOT_CONTENT_BYTES) {
      olderOmitted = true
      break
    }
    window.push(row)
    usedBytes += row.bytes
  }
  const dataById = new Map<string, string>()
  if (window.length > 0) {
    const dataRows = db
      .prepare(snapshotMessageDataSql(window.length))
      .all(...window.map((row) => row.id), MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) as {
      id: string
      data: string
    }[]
    for (const row of dataRows) {
      dataById.set(row.id, row.data)
    }
  }
  const rows: SqliteMessageRow[] = []
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const meta = window[index]
    const data = dataById.get(meta.id)
    if (data !== undefined) {
      rows.push({
        id: meta.id,
        time_created: meta.time_created,
        time_updated: meta.time_updated,
        data
      })
    }
  }
  return { rows, olderOmitted }
}

function loadSnapshotParts(
  db: SyncDatabase.Database,
  sessionId: string,
  messageRows: SqliteMessageRow[],
  byteBudget: number
): {
  byMessage: Map<string, SqlitePartRow[]>
  oversizedCount: number
  omittedCount: number
  budgetExhausted: boolean
} {
  const byMessage = new Map<string, SqlitePartRow[]>()
  if (
    messageRows.length === 0 ||
    !tableExists(db, 'part') ||
    !columnExists(db, 'part', 'message_id') ||
    !columnExists(db, 'part', 'data')
  ) {
    return { byMessage, oversizedCount: 0, omittedCount: 0, budgetExhausted: false }
  }
  const messageIds = messageRows.map((row) => row.id)
  const placeholders = messageIds.map(() => '?').join(',')
  const sessionFilter = columnExists(db, 'part', 'session_id') ? 'session_id = ? AND ' : ''
  const bind = sessionFilter ? [sessionId, ...messageIds] : messageIds
  const oversizedCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM part
         WHERE ${sessionFilter}message_id IN (${placeholders}) AND ${byteLengthExpr()} > ?`
      )
      .get(...bind, MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) as { n: number }
  ).n
  let omittedCount = 0
  for (const row of db
    .prepare(
      `SELECT message_id, COUNT(*) AS loadable FROM part
       WHERE ${sessionFilter}message_id IN (${placeholders}) AND ${byteLengthExpr()} <= ?
       GROUP BY message_id`
    )
    .iterate(...bind, MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) as Iterable<{
    message_id: string
    loadable: number
  }>) {
    omittedCount += Math.max(0, row.loadable - MAX_SNAPSHOT_PARTS_PER_MESSAGE)
  }
  const windowStatement = db.prepare(
    snapshotPartWindowSql({
      sessionFilter,
      timeOrder: columnExists(db, 'part', 'time_created')
    })
  )
  const windowBind = (messageId: string) => (sessionFilter ? [sessionId, messageId] : [messageId])
  const selected = new Map<string, SnapshotPartMetaRow[]>()
  let usedBytes = 0
  let budgetExhausted = false
  // Newest messages claim the byte budget first, so exhaustion drops the oldest tail content.
  for (let index = messageRows.length - 1; index >= 0 && !budgetExhausted; index -= 1) {
    const metaRows = windowStatement.all(
      ...windowBind(messageRows[index].id),
      MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES
    ) as SnapshotPartMetaRow[]
    const capped = metaRows.slice(0, MAX_SNAPSHOT_PARTS_PER_MESSAGE)
    const chosen: SnapshotPartMetaRow[] = []
    for (const part of capped) {
      if (usedBytes + part.bytes > byteBudget) {
        budgetExhausted = true
        break
      }
      usedBytes += part.bytes
      chosen.push(part)
    }
    if (chosen.length > 0) {
      selected.set(messageRows[index].id, chosen)
    }
  }
  for (const [messageId, chosen] of selected) {
    const dataById = new Map<string, string>()
    const dataRows = db
      .prepare(snapshotPartDataSql(chosen.length))
      .all(
        messageId,
        ...chosen.map((part) => part.id),
        MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES
      ) as { id: string; data: string }[]
    for (const row of dataRows) {
      dataById.set(row.id, row.data)
    }
    const parts: SqlitePartRow[] = []
    for (const part of chosen) {
      const data = dataById.get(part.id)
      if (data !== undefined) {
        parts.push({
          id: part.id,
          message_id: messageId,
          time_created: part.time_created,
          time_updated: part.time_updated,
          data
        })
      }
    }
    byMessage.set(messageId, parts)
  }
  return { byMessage, oversizedCount, omittedCount, budgetExhausted }
}

// Digests the materialized snapshot content itself, so equal-length rewrites in the same
// millisecond still change the identity. Omitted older messages and omitted parts are declared
// outside the snapshot via warnings and are deliberately not compared.
function hashOpenCodeSnapshot(
  sessionId: string,
  rows: SqliteMessageRow[],
  partsByMessage: Map<string, SqlitePartRow[]>
): string {
  const hash = createHash('sha256')
  hash.update(`opencode-worker-snapshot-v1\u0000${sessionId}\u0000${rows.length}\u0000`)
  for (const row of rows) {
    hash.update(
      `m\u0000${row.id}\u0000${row.time_created}\u0000${row.time_updated}\u0000${Buffer.byteLength(row.data, 'utf8')}\u0000${row.data}\u0000`
    )
  }
  for (const row of rows) {
    for (const part of partsByMessage.get(row.id) ?? []) {
      hash.update(
        `p\u0000${part.id}\u0000${part.time_created}\u0000${part.time_updated}\u0000${Buffer.byteLength(part.data, 'utf8')}\u0000${part.data}\u0000`
      )
    }
  }
  return hash.digest('base64url').slice(0, 32)
}

function countOversizedMessages(db: SyncDatabase.Database, sessionId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM message
         WHERE ${roleMessageFilter()} AND ${byteLengthExpr()} > ?`
      )
      .get(sessionId, MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) as { n: number }
  ).n
}
