import type { NativeChatMessage } from '../../../shared/native-chat-types'
import { statSync } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { asRecord, extractString } from '../../ai-vault/session-scanner-values'
import { splitOpenCodeSqliteCandidate } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import { readOpenCodeDatabase } from '../../ai-vault/session-scanner-opencode-sqlite-open'
import { columnExists, tableExists } from '../../opencode-usage/schema-helpers'
import type SyncDatabase from '../../sqlite/sync-database'
import { decodeOpenCodeWorkerMessage } from './worker-transcript-opencode-decode'
import { workerTranscriptRecordWarnings } from './worker-transcript-page'
import { buildOpenCodeSnapshot, type SqliteMessageRow } from './worker-transcript-opencode-snapshot'
import {
  createWorkerTranscriptBoundaryCheckpoint,
  localWorkerTranscriptSourceIdentity
} from './worker-transcript-source-identity'
import type { WorkerTranscriptReadResult } from './worker-transcript-read'

const OLDER_OMITTED_WARNING = 'Older transcript messages were omitted from the bounded snapshot.'
const PARTS_BYTE_BUDGET_WARNING =
  'Some transcript parts were omitted to keep the snapshot byte budget.'
const SOURCE_IDENTITY_WARNING =
  'OpenCode storage did not expose a stable database file identity for cursor evidence.'

// SQLite has no monotonic sequence, so pages come from a bounded tail snapshot read in one
// coherent readonly transaction; the snapshot digest folds into the RPC sourceIdentity and any
// mutation (append/update/delete/reorder) invalidates the cursor as source_changed instead of
// faking a changefeed. The cursor position is a stable index into that snapshot ordering.
export function readOpenCodeSqlitePage(
  filePath: string,
  sessionId: string,
  offset: number | undefined,
  limit: number,
  expectedBoundaryCheckpoint?: string
): WorkerTranscriptReadResult {
  const sqlite = splitOpenCodeSqliteCandidate(filePath)
  if (!sqlite) {
    return { ok: false, reason: 'transcript_parse_failed', warnings: [] }
  }
  // Snapshot cursors need the same stable file identity evidence as line transcripts; without
  // dev/ino there is no honest sourceFingerprint to pin a cursor to.
  const sourceIdentity = localWorkerTranscriptSourceIdentity(statDatabaseFile(sqlite.dbPath))
  if (!sourceIdentity) {
    return { ok: false, reason: 'transcript_unreadable', warnings: [SOURCE_IDENTITY_WARNING] }
  }
  return readOpenCodeDatabase({
    dbPath: sqlite.dbPath,
    read: (db) => {
      db.exec('BEGIN')
      return pageOpenCodeSqlite(
        db,
        filePath,
        sessionId,
        offset,
        limit,
        sourceIdentity.fingerprint,
        expectedBoundaryCheckpoint
      )
    }
  })
}

function pageOpenCodeSqlite(
  db: SyncDatabase.Database,
  filePath: string,
  sessionId: string,
  offset: number | undefined,
  limit: number,
  sourceFingerprint: string,
  expectedBoundaryCheckpoint?: string
): WorkerTranscriptReadResult {
  if (!canPageOpenCodeSqlite(db)) {
    return { ok: false, reason: 'transcript_parse_failed', warnings: [] }
  }
  const snapshot = buildOpenCodeSnapshot(db, sessionId)
  if (offset !== undefined && offset > snapshot.rows.length) {
    return { ok: false, reason: 'source_changed', warnings: [] }
  }
  const start = offset ?? 0
  // Verify the boundary row identity before paging, mirroring the byte checkpoint the
  // line-transcript readers verify before a forward scan.
  const startCheckpoint = openCodeSnapshotBoundaryCheckpoint(snapshot.rows, start)
  if (expectedBoundaryCheckpoint !== undefined && startCheckpoint !== expectedBoundaryCheckpoint) {
    return { ok: false, reason: 'source_changed', warnings: [] }
  }
  const end = Math.min(start + limit, snapshot.rows.length)
  const decoded = decodeSqliteRows(snapshot.rows.slice(start, end), snapshot.partsByMessage)
  const warnings = workerTranscriptRecordWarnings(
    decoded.malformedRecordCount,
    snapshot.oversizedMessageCount + snapshot.oversizedPartCount
  )
  if (snapshot.olderOmitted) {
    warnings.push(OLDER_OMITTED_WARNING)
  }
  if (snapshot.partsOmittedCount > 0) {
    warnings.push(
      `${snapshot.partsOmittedCount} transcript part(s) were omitted from messages with too many parts.`
    )
  }
  if (snapshot.partsBudgetExhausted) {
    warnings.push(PARTS_BYTE_BUDGET_WARNING)
  }
  return {
    ok: true,
    filePath,
    sourceFingerprint,
    boundaryCheckpoint: openCodeSnapshotBoundaryCheckpoint(snapshot.rows, end),
    messages: decoded.messages,
    nextOffset: end,
    sourceDigest: snapshot.digest,
    limited: end < snapshot.rows.length,
    clipping: [
      ...(end < snapshot.rows.length || snapshot.olderOmitted
        ? ['message_limit_or_scan_window']
        : []),
      ...(snapshot.partsOmittedCount > 0 || snapshot.partsBudgetExhausted
        ? ['transcript_payload']
        : [])
    ],
    warnings
  }
}

function canPageOpenCodeSqlite(db: SyncDatabase.Database): boolean {
  return (
    tableExists(db, 'message') &&
    columnExists(db, 'message', 'session_id') &&
    columnExists(db, 'message', 'time_created') &&
    columnExists(db, 'message', 'time_updated') &&
    columnExists(db, 'message', 'data')
  )
}

function statDatabaseFile(dbPath: string): BigIntStats {
  return statSync(dbPath, { bigint: true })
}

// The snapshot analogue of the line readers' 64 bytes before a byte offset: the identity of
// the row immediately before the cursor index, hashed with the shared domain-separated
// primitive. Appends after the boundary leave it stable; edits, reorders, or window eviction
// that moves the boundary row change it and surface as source_changed.
function openCodeSnapshotBoundaryCheckpoint(rows: SqliteMessageRow[], index: number): string {
  const row = index > 0 ? rows[index - 1] : undefined
  if (!row) {
    return createWorkerTranscriptBoundaryCheckpoint(new Uint8Array(0))
  }
  return createWorkerTranscriptBoundaryCheckpoint(
    Buffer.from(`${row.id}\0${row.time_created}\0${row.time_updated}\0${row.data}`, 'utf8')
  )
}

function decodeSqliteRows(
  rows: SqliteMessageRow[],
  partsByMessage: Map<string, { data: string }[]>
): { messages: NativeChatMessage[]; malformedRecordCount: number } {
  const messages: NativeChatMessage[] = []
  let malformedRecordCount = 0
  for (const row of rows) {
    const data = asRecord(parseJsonValue(row.data))
    if (!data) {
      malformedRecordCount++
      continue
    }
    const parts = partsByMessage.get(row.id)
    const message = decodeOpenCodeWorkerMessage({
      id: extractString(data.id) ?? row.id,
      role: data.role,
      timestamp: row.time_created,
      parts: parts ? parts.map((part) => parseJsonValue(part.data)) : (data.content ?? [])
    })
    if (message) {
      messages.push(message)
    }
  }
  return { messages, malformedRecordCount }
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
