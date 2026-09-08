import type {
  OrchestrationWorkerReadResult,
  OrchestrationWorkerReadSource
} from '../../../../shared/orchestration-worker-output'
import type { PtyLivenessVerdict } from '../../../../shared/pty-liveness-verdict'
import type { OrchestrationDb } from '../../orchestration/db'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type {
  WorkerTerminalArchiveRow,
  WorkerTerminalResourceRow
} from '../../orchestration/worker-terminal-ownership'
import type {
  WorkerTerminalTailArchive,
  WorkerTranscriptPinArchive,
  WorkerTranscriptSnapshotArchive
} from '../../orchestration/worker-output-archive'
import { clampWorkerTranscriptLimit } from '../../orchestration/worker-transcript-payload'
import {
  createWorkerOutputSourceIdentity,
  decodeWorkerOutputCursor,
  encodeWorkerOutputCursor
} from '../../orchestration/worker-output-cursor'
import { readWorkerTranscript } from '../../orchestration/worker-transcript-read'

const ARCHIVED_TERMINAL_PAGE_LINES = 2_000

// Frozen output does not prove process exit; cursors remain Dispatch-scoped and source-pinned.
export async function readArchivedWorkerOutput(args: {
  db: OrchestrationDb
  dispatchId: string
  workerState: string
  resource: WorkerTerminalResourceRow
  source?: OrchestrationWorkerReadSource
  cursor?: string | number
  limit?: number
  // Owning-host process evidence, independent of the archived bytes.
  liveness?: PtyLivenessVerdict['status']
}): Promise<OrchestrationWorkerReadResult> {
  const archive = args.db.getWorkerTerminalArchive(args.dispatchId)
  if (!archive) {
    throw new OrchestrationError(
      'archive_unavailable',
      `Dispatch ${args.dispatchId} was released without a preserved output archive.`
    )
  }
  if (archive.kind === 'structured_journal') {
    if (args.source === 'terminal') {
      throw new OrchestrationError(
        'archive_unavailable',
        'The persisted worker journal has no PTY output.'
      )
    }
    return readFrozenTranscript(args, archive, parsePersistedStructuredJournal(archive.content))
  }
  if (archive.kind === 'transcript_pin') {
    if (args.source === 'terminal') {
      throw new OrchestrationError(
        'archive_unavailable',
        `Dispatch ${args.dispatchId} preserved structured transcript output only; terminal output was released.`
      )
    }
    const content = JSON.parse(archive.content) as
      | WorkerTranscriptPinArchive
      | WorkerTranscriptSnapshotArchive
    return isTranscriptSnapshot(content)
      ? readFrozenTranscript(args, archive, content)
      : readLegacyPinnedTranscript(args, content)
  }
  if (archive.kind !== 'terminal_tail') {
    throw new OrchestrationError(
      'archive_unavailable',
      'The persisted worker archive kind is unsupported.'
    )
  }
  if (args.source === 'transcript') {
    throw new OrchestrationError(
      'transcript_required',
      `Structured output is unavailable for released Dispatch ${args.dispatchId}: the archive holds terminal output only.`
    )
  }
  return readArchivedTerminalTail(args, archive)
}

type PersistedStructuredJournal = Omit<WorkerTranscriptSnapshotArchive, 'version'> & { version: 1 }

function parsePersistedStructuredJournal(content: string): PersistedStructuredJournal {
  let value: Partial<PersistedStructuredJournal> | null
  try {
    value = JSON.parse(content)
  } catch {
    value = null
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.agent !== 'string' ||
    !value.agent.trim() ||
    typeof value.processIncarnation !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.every(
      (message) => message && typeof message === 'object' && Array.isArray(message.blocks)
    ) ||
    typeof value.limited !== 'boolean' ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new OrchestrationError(
      'archive_unavailable',
      'The persisted structured journal is not a valid version 1 archive.'
    )
  }
  return value as PersistedStructuredJournal
}

function readFrozenTranscript(
  args: Parameters<typeof readArchivedWorkerOutput>[0],
  archive: WorkerTerminalArchiveRow,
  snapshot: WorkerTranscriptSnapshotArchive | PersistedStructuredJournal
): OrchestrationWorkerReadResult {
  const cursor = decodeWorkerOutputCursor(args.cursor, args.dispatchId)
  const sourceIdentity = createWorkerOutputSourceIdentity([
    archive.kind === 'structured_journal'
      ? 'persisted-structured-journal'
      : 'released-transcript-snapshot',
    args.resource.id,
    snapshot.processIncarnation,
    archive.created_at
  ])
  if (cursor && (cursor.source !== 'transcript' || cursor.sourceIdentity !== sourceIdentity)) {
    throw sourceChanged()
  }
  const start = Math.min(cursor?.position ?? 0, snapshot.messages.length)
  const end = Math.min(start + clampWorkerTranscriptLimit(args.limit), snapshot.messages.length)
  const nextCursor = encodeWorkerOutputCursor(args.dispatchId, 'transcript', sourceIdentity, end)
  return {
    dispatchId: args.dispatchId,
    source: 'transcript',
    sourceIdentity,
    provider: snapshot.agent,
    transcript: {
      messages: snapshot.messages.slice(start, end),
      nextCursor,
      limited: snapshot.limited || end < snapshot.messages.length,
      returnedMessageCount: end - start
    },
    cursor: nextCursor,
    status: archivedStatus(args),
    fallbackReason: null,
    warnings: [
      ...snapshot.warnings,
      ...(snapshot.limited
        ? ['Older transcript messages were omitted from the bounded archive.']
        : [])
    ],
    archived: true
  }
}

async function readLegacyPinnedTranscript(
  args: Parameters<typeof readArchivedWorkerOutput>[0],
  pin: WorkerTranscriptPinArchive
): Promise<OrchestrationWorkerReadResult> {
  const cursor = decodeWorkerOutputCursor(args.cursor, args.dispatchId)
  const sourceIdentity = createWorkerOutputSourceIdentity([
    'released-transcript',
    pin.processIncarnation,
    pin.agent,
    pin.providerSessionKey,
    pin.providerSessionId,
    pin.transcriptPath ?? '',
    String(pin.endOffset)
  ])
  if (cursor && cursor.source !== 'transcript') {
    throw sourceChanged()
  }
  if (cursor && cursor.sourceIdentity !== sourceIdentity) {
    throw sourceChanged()
  }
  const transcript = await readWorkerTranscript({
    agent: pin.agent,
    sessionId: pin.providerSessionId,
    transcriptPath: pin.transcriptPath ?? undefined,
    offset: cursor?.position,
    endOffset: pin.endOffset,
    limit: args.limit
  })
  if (!transcript.ok) {
    throw new OrchestrationError(
      'transcript_required',
      `The pinned transcript for released Dispatch ${args.dispatchId} is unavailable: ${transcript.reason}.`,
      { reason: transcript.reason }
    )
  }
  const nextCursor = encodeWorkerOutputCursor(
    args.dispatchId,
    'transcript',
    sourceIdentity,
    transcript.nextOffset
  )
  return {
    dispatchId: args.dispatchId,
    source: 'transcript',
    sourceIdentity,
    provider: pin.agent,
    transcript: {
      messages: transcript.messages,
      nextCursor,
      limited: transcript.limited,
      returnedMessageCount: transcript.messages.length
    },
    cursor: nextCursor,
    status: archivedStatus(args),
    fallbackReason: null,
    warnings: transcript.warnings,
    archived: true
  }
}

function isTranscriptSnapshot(
  content: WorkerTranscriptPinArchive | WorkerTranscriptSnapshotArchive
): content is WorkerTranscriptSnapshotArchive {
  return 'version' in content && content.version === 2
}

function readArchivedTerminalTail(
  args: Parameters<typeof readArchivedWorkerOutput>[0],
  archive: WorkerTerminalArchiveRow
): OrchestrationWorkerReadResult {
  const content = JSON.parse(archive.content) as WorkerTerminalTailArchive
  const cursor = decodeWorkerOutputCursor(args.cursor, args.dispatchId)
  const sourceIdentity = createWorkerOutputSourceIdentity([
    'released-terminal',
    args.resource.id,
    archive.created_at
  ])
  if (cursor && cursor.source !== 'terminal') {
    throw sourceChanged()
  }
  if (cursor && (cursor.legacy || cursor.sourceIdentity !== sourceIdentity)) {
    throw sourceChanged()
  }
  const start = Math.min(cursor?.position ?? 0, content.lines.length)
  const pageSize = Math.max(1, Math.min(args.limit ?? ARCHIVED_TERMINAL_PAGE_LINES, 10_000))
  const end = Math.min(start + pageSize, content.lines.length)
  const tail = content.lines.slice(start, end)
  const nextCursor =
    end < content.lines.length
      ? encodeWorkerOutputCursor(args.dispatchId, 'terminal', sourceIdentity, end)
      : null
  const status = archivedStatus(args)
  return {
    dispatchId: args.dispatchId,
    source: 'terminal',
    sourceIdentity,
    terminal: {
      handle: args.resource.terminal_handle,
      status: status.terminal,
      tail,
      ...(!cursor && content.draft ? { draft: content.draft } : {}),
      truncated: content.truncated,
      nextCursor,
      returnedLineCount: tail.length
    },
    cursor: nextCursor,
    status,
    fallbackReason: null,
    warnings: content.warnings,
    archived: true
  }
}

function archivedStatus(args: Parameters<typeof readArchivedWorkerOutput>[0]): {
  worker: string
  terminal: 'running' | 'exited' | 'unknown'
  liveness: PtyLivenessVerdict['status']
} {
  // Only a settled close proves exit; an in-flight or unknown release merely preserves bytes.
  const liveness =
    args.liveness ?? (args.resource.release_state === 'released' ? 'exited' : 'unverifiable')
  return {
    worker: args.workerState,
    terminal: liveness === 'live' ? 'running' : liveness === 'exited' ? 'exited' : 'unknown',
    liveness
  }
}

function sourceChanged(): OrchestrationError {
  return new OrchestrationError(
    'source_changed',
    'The worker output source changed. Start a fresh worker-read without the old cursor.'
  )
}
