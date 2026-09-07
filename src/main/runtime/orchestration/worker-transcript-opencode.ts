import { extname, join } from 'node:path'
import { findOpenCodeStorageRoot } from '../../ai-vault/session-scanner-values'
import { splitOpenCodeSqliteCandidate } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import { readOpenCodeDatabase } from '../../ai-vault/session-scanner-opencode-sqlite-open'
import { wslGatedStat } from '../../native-chat/wsl-transcript-fs-access'
import { WslTranscriptFsError } from '../../native-chat/wsl-transcript-fs-gate'
import { resolveOpenCodeStorageDirectory } from '../../opencode/opencode-data-directory'
import {
  compareOpenCodeClaimPriority,
  listOpenCodeDatabases
} from '../../opencode-usage/opencode-database-discovery'
import { tableExists } from '../../opencode-usage/schema-helpers'
import {
  boundWorkerTranscriptMessages,
  clampWorkerTranscriptLimit
} from './worker-transcript-payload'
import { readOpenCodeSqlitePage } from './worker-transcript-opencode-sqlite'
import type { WorkerTranscriptReadResult } from './worker-transcript-read'

export async function readOpenCodeWorkerTranscript(args: {
  sessionId: string
  transcriptPath?: string
  offset?: number
  limit?: number
  /** Prior boundary evidence from the cursor owner; mismatch degrades to source_changed. */
  expectedBoundaryCheckpoint?: string
}): Promise<WorkerTranscriptReadResult> {
  const sessionId = args.sessionId.trim()
  if (!sessionId) {
    return { ok: false, reason: 'transcript_missing', warnings: [] }
  }
  let source: { filePath: string; kind: 'sqlite' | 'legacy' } | null
  try {
    source = await resolveOpenCodeWorkerSource(sessionId, args.transcriptPath)
  } catch (error) {
    return classifyOpenCodeError(error)
  }
  if (!source) {
    return { ok: false, reason: 'transcript_missing', warnings: [] }
  }
  const limit = clampWorkerTranscriptLimit(args.limit)
  try {
    if (source.kind === 'legacy') {
      return {
        ok: false,
        reason: 'transcript_unreadable',
        warnings: [
          'Legacy OpenCode JSON sessions are not read unbounded; structured output requires SQLite storage.'
        ]
      }
    }
    const page = readOpenCodeSqlitePage(
      source.filePath,
      sessionId,
      args.offset,
      limit,
      args.expectedBoundaryCheckpoint
    )
    if (!page.ok) {
      return page
    }
    const bounded = boundWorkerTranscriptMessages(page.messages, source.filePath)
    return {
      ok: true,
      filePath: source.filePath,
      sourceFingerprint: page.sourceFingerprint,
      boundaryCheckpoint: page.boundaryCheckpoint,
      messages: bounded.messages,
      nextOffset: page.nextOffset,
      ...(page.sourceDigest ? { sourceDigest: page.sourceDigest } : {}),
      limited: page.limited || bounded.limited,
      clipping: [...page.clipping, ...(bounded.limited ? ['transcript_payload'] : [])],
      warnings: [...page.warnings, ...bounded.warnings]
    }
  } catch (error) {
    return classifyOpenCodeError(error)
  }
}

async function resolveOpenCodeWorkerSource(
  sessionId: string,
  transcriptPath?: string
): Promise<{ filePath: string; kind: 'sqlite' | 'legacy' } | null> {
  const explicit = transcriptPath?.trim()
  if (explicit) {
    const sqlite = splitOpenCodeSqliteCandidate(explicit)
    if (sqlite) {
      return sqlite.sessionId === sessionId && openCodeSqliteHasSession(sqlite.dbPath, sessionId)
        ? { filePath: explicit, kind: 'sqlite' }
        : null
    }
    if (extname(explicit) === '.json') {
      const storageRoot = findOpenCodeStorageRoot(explicit)
      return storageRoot
        ? { filePath: join(storageRoot, 'message', sessionId), kind: 'legacy' }
        : null
    }
    return null
  }
  const dbPaths = (await listOpenCodeDatabases()).sort(compareOpenCodeClaimPriority)
  for (const dbPath of dbPaths) {
    if (openCodeSqliteHasSession(dbPath, sessionId)) {
      return { filePath: `${dbPath}#${sessionId}`, kind: 'sqlite' }
    }
  }
  const legacyDir = join(resolveOpenCodeStorageDirectory(), 'message', sessionId)
  try {
    return (await wslGatedStat(legacyDir, 'exact')).isDirectory()
      ? { filePath: legacyDir, kind: 'legacy' }
      : null
  } catch {
    return null
  }
}

function openCodeSqliteHasSession(dbPath: string, sessionId: string): boolean {
  try {
    return readOpenCodeDatabase({
      dbPath,
      read: (db) =>
        tableExists(db, 'session') &&
        Boolean(
          db.prepare('SELECT id FROM session WHERE id = ? LIMIT 1').get(sessionId) as
            | { id?: string }
            | undefined
        )
    })
  } catch {
    return false
  }
}

function classifyOpenCodeError(error: unknown): WorkerTranscriptReadResult {
  if (error instanceof WslTranscriptFsError) {
    return { ok: false, reason: 'transcript_unreadable', warnings: [] }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  return {
    ok: false,
    reason:
      code === 'ENOENT'
        ? 'transcript_missing'
        : code === 'EACCES' || code === 'EPERM'
          ? 'transcript_unreadable'
          : 'transcript_parse_failed',
    warnings: []
  }
}
