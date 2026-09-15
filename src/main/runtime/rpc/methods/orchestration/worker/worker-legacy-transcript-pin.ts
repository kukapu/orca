import { z } from 'zod'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { readWorkerTranscript } from '../../../../orchestration/worker-transcript-read'
import { parseWorkerTerminalHostScope } from '../../../../orchestration/worker-terminal-process-liveness'
import {
  createWorkerOutputSourceIdentity,
  decodeWorkerOutputCursor,
  encodeWorkerOutputCursor
} from '../../../../orchestration/worker-output-cursor'
import type { OrchestrationWorkerReadResult } from '../../../../../../shared/orchestration-worker-output'
import type { readArchivedWorkerOutput } from './worker-archive-read'

const LegacyPin = z.object({
  agent: z.string().min(1),
  providerSessionKey: z.string(),
  providerSessionId: z.string().min(1),
  transcriptPath: z.string().nullable(),
  processIncarnation: z.string().min(1),
  endOffset: z.number().int().nonnegative()
})

// Compatibility for the pointer archives shipped before frozen transcript snapshots.
export async function readLegacyPinnedTranscript(
  args: Parameters<typeof readArchivedWorkerOutput>[0],
  content: unknown,
  status: OrchestrationWorkerReadResult['status']
): Promise<OrchestrationWorkerReadResult> {
  const parsed = LegacyPin.safeParse(content)
  if (!parsed.success) {
    throw new OrchestrationError('archive_unavailable', 'Malformed legacy transcript pin.')
  }
  const host = parseWorkerTerminalHostScope(args.resource.host_scope ?? null)
  if (host?.kind !== 'local') {
    throw new OrchestrationError(
      'archive_unavailable',
      'Legacy transcript pin has no verified local execution host.'
    )
  }
  const pin = parsed.data
  const sourceIdentity = createWorkerOutputSourceIdentity([
    'released-transcript',
    pin.processIncarnation,
    pin.agent,
    pin.providerSessionKey,
    pin.providerSessionId,
    pin.transcriptPath ?? '',
    String(pin.endOffset)
  ])
  const cursor = decodeWorkerOutputCursor(args.cursor, args.dispatchId)
  if (cursor && (cursor.source !== 'transcript' || cursor.sourceIdentity !== sourceIdentity)) {
    throw new OrchestrationError('source_changed', 'The pinned transcript source changed.')
  }
  const transcript = await readWorkerTranscript({
    agent: pin.agent,
    sessionId: pin.providerSessionId,
    transcriptPath: pin.transcriptPath ?? undefined,
    offset: cursor?.position ?? 0,
    endOffset: pin.endOffset,
    limit: args.limit
  })
  if (!transcript.ok) {
    throw new OrchestrationError(
      'transcript_required',
      `The pinned transcript is unavailable: ${transcript.reason}.`
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
    status,
    fallbackReason: null,
    warnings: transcript.warnings,
    archived: true
  }
}
