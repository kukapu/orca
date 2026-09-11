import type { NativeChatMessage } from '../../../shared/native-chat-types'
import { asRecord, extractString } from '../../ai-vault/session-scanner-values'
import { splitOpenCodeSqliteCandidate } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import { readOpenCodeDatabase } from '../../ai-vault/session-scanner-opencode-sqlite-open'
import { columnExists, tableExists } from '../../opencode-usage/schema-helpers'
import type SyncDatabase from '../../sqlite/sync-database'
import { decodeOpenCodeWorkerMessage } from './worker-transcript-opencode-decode'
import { workerTranscriptRecordWarnings } from './worker-transcript-page'
import { buildOpenCodeSnapshot, type SqliteMessageRow } from './worker-transcript-opencode-snapshot'
import type { WorkerTranscriptReadResult } from './worker-transcript-read'

const LEGACY_WATERMARK_WARNING =
  'Legacy pinned OpenCode sessions are not re-read by archive watermark; start a fresh worker-read without the archive cursor.'
const OLDER_OMITTED_WARNING = 'Older transcript messages were omitted from the bounded snapshot.'
const PARTS_BYTE_BUDGET_WARNING =
  'Some transcript parts were omitted to keep the snapshot byte budget.'

// SQLite has no monotonic sequence, so pages come from a bounded tail snapshot read in one
// coherent readonly transaction; the snapshot digest folds into the RPC sourceIdentity and any
// mutation (append/update/delete/reorder) invalidates the cursor as source_changed instead of
// faking a changefeed. The cursor position is a stable index into that snapshot ordering.
export function readOpenCodeSqlitePage(
  filePath: string,
  sessionId: string,
  offset: number | undefined,
  endOffset: number | undefined,
  limit: number
): WorkerTranscriptReadResult {
  const sqlite = splitOpenCodeSqliteCandidate(filePath)
  if (!sqlite) {
    return { ok: false, reason: 'transcript_parse_failed', warnings: [] }
  }
  if (endOffset !== undefined) {
    return { ok: false, reason: 'transcript_unreadable', warnings: [LEGACY_WATERMARK_WARNING] }
  }
  return readOpenCodeDatabase({
    dbPath: sqlite.dbPath,
    read: (db) => {
      db.exec('BEGIN')
      return pageOpenCodeSqlite(db, filePath, sessionId, offset, limit)
    }
  })
}

function pageOpenCodeSqlite(
  db: SyncDatabase.Database,
  filePath: string,
  sessionId: string,
  offset: number | undefined,
  limit: number
): WorkerTranscriptReadResult {
  if (!canPageOpenCodeSqlite(db)) {
    return { ok: false, reason: 'transcript_parse_failed', warnings: [] }
  }
  const snapshot = buildOpenCodeSnapshot(db, sessionId)
  if (offset !== undefined && offset > snapshot.rows.length) {
    return { ok: false, reason: 'source_changed', warnings: [] }
  }
  const start = offset ?? 0
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
    messages: decoded.messages,
    nextOffset: end,
    sourceDigest: snapshot.digest,
    boundaryCheckpoint: snapshot.digest,
    limited: end < snapshot.rows.length,
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
