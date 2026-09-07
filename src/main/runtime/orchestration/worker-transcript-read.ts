import type { AgentType, NativeChatMessage } from '../../../shared/native-chat-types'
import type { OrchestrationWorkerReadFallbackReason } from '../../../shared/orchestration-worker-output'
import { resolveSessionFilePath } from '../../native-chat/session-file-resolver'
import { nativeChatLineDecoderForAgent } from '../../native-chat/transcript-tail-reader'
import { decodeOmpTranscriptLine } from '../../native-chat/transcript-line-decoders'
import type { IFilesystemProvider } from '../../providers/types'
import {
  boundWorkerTranscriptMessages,
  clampWorkerTranscriptLimit
} from './worker-transcript-payload'
import { readOpenCodeWorkerTranscript } from './worker-transcript-opencode'
import {
  piWorkerTranscriptMatchesSession,
  resolvePiWorkerTranscriptPath
} from './worker-transcript-pi'
import {
  readForwardLocalWorkerTranscriptPage,
  readInitialLocalWorkerTranscriptPage
} from './worker-transcript-local-read'
import { readRemoteWorkerTranscript } from './worker-transcript-remote-read'

type WorkerTranscriptReadFailure = {
  ok: false
  reason: OrchestrationWorkerReadFallbackReason | 'source_changed'
  warnings: string[]
}

type WorkerTranscriptReadSuccess = {
  ok: true
  filePath: string
  sourceFingerprint: string
  boundaryCheckpoint: string
  messages: NativeChatMessage[]
  nextOffset: number
  limited: boolean
  clipping: string[]
  warnings: string[]
  // Content digest of the bounded source snapshot; folds into the RPC sourceIdentity so any
  // mutation between cursor reads surfaces as source_changed. Only snapshot-backed readers set it.
  sourceDigest?: string
}

export type WorkerTranscriptReadResult = WorkerTranscriptReadFailure | WorkerTranscriptReadSuccess

export async function readWorkerTranscript(args: {
  agent: AgentType
  sessionId: string
  transcriptPath?: string
  /** Attested local WSL distro. Keeps host path translation on the selected guest. */
  wslDistro?: string
  offset?: number
  limit?: number
  /** SSH/relay connection of the session owner; without a provider the local
   *  runtime must not guess at a foreign filesystem. */
  connectionId?: string | null
  /** Prior file identity from the cursor owner, when it retains that evidence. */
  expectedSourceFingerprint?: string
  /** Hash of the bounded content immediately before a cursor offset. */
  expectedBoundaryCheckpoint?: string
  /** Remote execution-host provider. When present no local filesystem lookup occurs. */
  filesystemProvider?: IFilesystemProvider
}): Promise<WorkerTranscriptReadResult> {
  if (args.agent === 'opencode') {
    // OpenCode transcripts are only read from local host storage via SQLite discovery; a
    // remote provider or an attested WSL distro points at foreign storage the desktop must
    // not guess at, so the read degrades through the existing vocabulary instead.
    if (args.filesystemProvider) {
      return { ok: false, reason: 'provider_unsupported', warnings: [] }
    }
    if (args.wslDistro || args.connectionId) {
      return { ok: false, reason: 'remote_capability_unavailable', warnings: [] }
    }
    const opencode = await readOpenCodeWorkerTranscript(args)
    if (
      opencode.ok &&
      args.expectedSourceFingerprint &&
      opencode.sourceFingerprint !== args.expectedSourceFingerprint
    ) {
      return { ok: false, reason: 'source_changed', warnings: [] }
    }
    return opencode
  }
  const decode =
    args.agent === 'pi' ? decodeOmpTranscriptLine : nativeChatLineDecoderForAgent(args.agent)
  if (!decode) {
    return { ok: false, reason: 'provider_unsupported', warnings: [] }
  }
  let filePath: string | null
  if (args.filesystemProvider) {
    // A remote provider can only read the hook-attested path. Never search the
    // desktop's provider roots for a remote session (same-path sentinels are a
    // real authority boundary, not merely a portability concern).
    filePath = args.transcriptPath?.trim() || null
    if (!filePath) {
      return { ok: false, reason: 'transcript_missing', warnings: [] }
    }
    const page = await readRemoteWorkerTranscript(args, filePath, decode)
    if (
      page.ok &&
      args.expectedSourceFingerprint &&
      page.sourceFingerprint !== args.expectedSourceFingerprint
    ) {
      return { ok: false, reason: 'source_changed', warnings: [] }
    }
    return page
  }
  // Why after the provider branch: a remote session with its provider reads remotely;
  // a connectionId whose provider never attached must fence the local guess instead.
  if (args.connectionId) {
    return { ok: false, reason: 'remote_capability_unavailable', warnings: [] }
  }
  try {
    filePath =
      args.agent === 'pi'
        ? await resolvePiWorkerTranscriptPath(args.transcriptPath)
        : await resolveSessionFilePath(args.agent, args.sessionId, {
            transcriptPath: args.transcriptPath,
            wslDistro: args.wslDistro
          })
  } catch {
    return { ok: false, reason: 'transcript_unreadable', warnings: [] }
  }
  if (!filePath) {
    return { ok: false, reason: 'transcript_missing', warnings: [] }
  }
  if (args.agent === 'pi' && !(await piWorkerTranscriptMatchesSession(filePath, args.sessionId))) {
    return { ok: false, reason: 'transcript_missing', warnings: [] }
  }
  const limit = clampWorkerTranscriptLimit(args.limit)
  try {
    const page =
      args.offset === undefined
        ? await readInitialLocalWorkerTranscriptPage(filePath, limit, decode)
        : await readForwardLocalWorkerTranscriptPage(
            filePath,
            args.offset,
            limit,
            decode,
            args.expectedBoundaryCheckpoint
          )
    if (!page.ok) {
      return page
    }
    if (
      args.expectedSourceFingerprint &&
      page.sourceFingerprint !== args.expectedSourceFingerprint
    ) {
      return { ok: false, reason: 'source_changed', warnings: [] }
    }
    const bounded = boundWorkerTranscriptMessages(page.messages, filePath)
    return {
      ok: true,
      filePath,
      sourceFingerprint: page.sourceFingerprint,
      boundaryCheckpoint: page.boundaryCheckpoint,
      messages: bounded.messages,
      nextOffset: page.nextOffset,
      limited: page.limited || bounded.limited,
      clipping: [
        ...(page.limited ? ['message_limit_or_scan_window'] : []),
        ...(bounded.limited ? ['transcript_payload'] : [])
      ],
      warnings: [...page.warnings, ...bounded.warnings]
    }
  } catch (error) {
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
}
