import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkerTranscript } from './worker-transcript-read'

function codexMessage(id: string, text: string): string {
  return JSON.stringify({
    timestamp: '2026-07-24T12:00:00.000Z',
    type: 'event_msg',
    payload: { id, type: 'agent_message', message: text }
  })
}

function grokMessage(id: string, text: string): string {
  return JSON.stringify({
    id,
    timestamp: '2026-07-24T12:00:00.000Z',
    type: 'assistant',
    content: text
  })
}

describe('worker transcript reads', () => {
  let directory: string
  let transcriptPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-worker-transcript-'))
    transcriptPath = join(directory, 'rollout-session.jsonl')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('returns a bounded tail followed by new messages from the exact file', async () => {
    await writeFile(
      transcriptPath,
      [codexMessage('one', 'first'), codexMessage('two', 'second'), codexMessage('three', 'third')]
        .join('\n')
        .concat('\n')
    )

    const initial = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      limit: 2
    })
    expect(initial).toMatchObject({
      ok: true,
      messages: [
        { id: 'two', blocks: [{ type: 'text', text: 'second' }] },
        { id: 'three', blocks: [{ type: 'text', text: 'third' }] }
      ],
      limited: true
    })
    if (!initial.ok) {
      throw new Error('Expected the initial transcript page')
    }

    await appendFile(transcriptPath, `{malformed}\n${codexMessage('four', 'fourth')}\n`)
    const appended = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      offset: initial.nextOffset,
      expectedSourceFingerprint: initial.sourceFingerprint,
      expectedBoundaryCheckpoint: initial.boundaryCheckpoint,
      limit: 2
    })

    expect(appended).toMatchObject({
      ok: true,
      messages: [{ id: 'four', blocks: [{ type: 'text', text: 'fourth' }] }],
      limited: false,
      warnings: ['1 malformed transcript record(s) were skipped.']
    })
  })

  it('keeps legacy pinned reads inside the archived byte boundary after the file grows', async () => {
    const original = `${codexMessage('one', 'archived')}\n`
    await writeFile(transcriptPath, original)
    const endOffset = Buffer.byteLength(original)
    await appendFile(transcriptPath, `${codexMessage('two', 'new turn outside the archive')}\n`)
    const page = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      endOffset
    })
    expect(page).toMatchObject({ ok: true, nextOffset: endOffset, messages: [{ id: 'one' }] })
    const next = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      endOffset,
      offset: endOffset
    })
    expect(next).toMatchObject({ ok: true, nextOffset: endOffset, messages: [] })
  })

  it.each([
    ['equal-size', 0],
    ['larger', 64]
  ])('rejects a same-inode truncate/regrow at %s', async (_label, extraBytes) => {
    await writeFile(
      transcriptPath,
      `${codexMessage('one', 'original transcript with enough padding for equal-size rewrite')}\n`
    )
    const initial = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      limit: 10
    })
    if (!initial.ok) {
      throw new Error('Expected the original transcript page')
    }
    const before = await stat(transcriptPath, { bigint: true })
    const replacementLine = `${codexMessage('other', 'unrelated rewrite')}\n`
    const replacement = replacementLine.padEnd(initial.nextOffset + extraBytes, ' ')

    await writeFile(transcriptPath, replacement)

    const after = await stat(transcriptPath, { bigint: true })
    expect(after.ino).toBe(before.ino)
    expect(after.dev).toBe(before.dev)
    expect(Number(after.size)).toBeGreaterThanOrEqual(initial.nextOffset)
    await expect(
      readWorkerTranscript({
        agent: 'codex',
        sessionId: 'session-exact',
        transcriptPath,
        offset: initial.nextOffset,
        expectedSourceFingerprint: initial.sourceFingerprint,
        expectedBoundaryCheckpoint: initial.boundaryCheckpoint,
        limit: 10
      })
    ).resolves.toEqual({ ok: false, reason: 'source_changed', warnings: [] })
  })

  it('reports source changes and unsupported providers without guessing', async () => {
    await writeFile(transcriptPath, `${codexMessage('one', 'first')}\n`)

    await expect(
      readWorkerTranscript({
        agent: 'codex',
        sessionId: 'session-exact',
        transcriptPath,
        offset: 10_000,
        limit: 2
      })
    ).resolves.toMatchObject({ ok: false, reason: 'source_changed' })

    await expect(
      readWorkerTranscript({
        agent: 'gemini',
        sessionId: 'session-other',
        transcriptPath,
        limit: 2
      })
    ).resolves.toEqual({ ok: false, reason: 'provider_unsupported', warnings: [] })
  })

  it('reads the exact Pi JSONL session from the hook path without scanning others', async () => {
    const otherPath = join(directory, 'other-pi.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session',
          id: 'pi-exact',
          timestamp: '2026-05-01T10:08:00.000Z',
          cwd: '/tmp/pi'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-user',
          timestamp: '2026-05-01T10:08:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Pi worker prompt' }] }
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-assistant',
          timestamp: '2026-05-01T10:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Pi structured output' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )
    await writeFile(
      otherPath,
      `${JSON.stringify({
        type: 'message',
        id: 'pi-other',
        timestamp: '2026-05-01T10:09:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'other session only' }] }
      })}\n`
    )

    const initial = await readWorkerTranscript({
      agent: 'pi',
      sessionId: 'pi-exact',
      transcriptPath,
      limit: 1
    })
    expect(initial).toMatchObject({
      ok: true,
      messages: [{ id: 'pi-assistant', blocks: [{ type: 'text', text: 'Pi structured output' }] }],
      limited: true
    })
    if (!initial.ok) {
      throw new Error('Expected the Pi transcript page')
    }
    expect(JSON.stringify(initial.messages)).not.toContain('other session only')

    await appendFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'message',
        id: 'pi-follow',
        timestamp: '2026-05-01T10:08:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Pi follow-up' }] }
      })}\n`
    )
    await expect(
      readWorkerTranscript({
        agent: 'pi',
        sessionId: 'pi-exact',
        transcriptPath,
        offset: initial.nextOffset,
        limit: 2
      })
    ).resolves.toMatchObject({
      ok: true,
      messages: [{ id: 'pi-follow', blocks: [{ type: 'text', text: 'Pi follow-up' }] }],
      limited: false
    })
  })

  it('does not return another Pi session when the header id disagrees', async () => {
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session',
          id: 'pi-other',
          timestamp: '2026-05-01T10:08:00.000Z'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-wrong',
          timestamp: '2026-05-01T10:08:01.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'wrong session body' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )

    await expect(
      readWorkerTranscript({
        agent: 'pi',
        sessionId: 'pi-exact',
        transcriptPath,
        limit: 2
      })
    ).resolves.toMatchObject({ ok: false, reason: 'transcript_missing' })
  })

  it('does not invent a Pi transcript without the hook session file', async () => {
    await expect(
      readWorkerTranscript({
        agent: 'pi',
        sessionId: 'pi-exact',
        limit: 2
      })
    ).resolves.toEqual({ ok: false, reason: 'transcript_missing', warnings: [] })
  })

  it('does not treat a JSONL path as Pi identity without a session header', async () => {
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: 'message',
        id: 'pi-orphan',
        timestamp: '2026-05-01T10:08:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'no session header' }] }
      })}\n`
    )

    await expect(
      readWorkerTranscript({
        agent: 'pi',
        sessionId: 'pi-exact',
        transcriptPath,
        limit: 2
      })
    ).resolves.toMatchObject({ ok: false, reason: 'transcript_missing' })
  })

  it('reuses the Native Chat Grok decoder', async () => {
    await writeFile(transcriptPath, `${grokMessage('grok-one', 'Grok structured output')}\n`)

    await expect(
      readWorkerTranscript({
        agent: 'grok',
        sessionId: 'session-grok',
        transcriptPath,
        limit: 2
      })
    ).resolves.toMatchObject({
      ok: true,
      messages: [
        {
          role: 'assistant',
          blocks: [{ type: 'text', text: 'Grok structured output' }]
        }
      ]
    })
  })

  it('makes file-position fallback IDs opaque', async () => {
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        timestamp: '2026-07-24T12:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'no provider id' }
      })}\n`
    )

    const result = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      limit: 2
    })

    expect(result).toMatchObject({
      ok: true,
      messages: [{ id: expect.stringMatching(/^worker-message-/) }],
      warnings: ['Transcript-backed message identifiers were made opaque.']
    })
    expect(result.ok && JSON.stringify(result.messages)).not.toContain(transcriptPath)
  })

  it('advances past a record larger than the forward scan window', async () => {
    await writeFile(transcriptPath, 'x'.repeat(8 * 1024 * 1024 + 10))

    const oversized = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      offset: 0,
      limit: 2
    })
    expect(oversized).toMatchObject({
      ok: true,
      messages: [],
      limited: true,
      warnings: expect.arrayContaining([
        '1 oversized transcript record(s) were skipped.',
        'Transcript scanning stopped at the bounded byte limit; continue with the cursor.'
      ])
    })
    if (!oversized.ok) {
      throw new Error('Expected the oversized transcript page')
    }
    expect(oversized.nextOffset).toBe(8 * 1024 * 1024)

    await appendFile(transcriptPath, `\n${codexMessage('after', 'after oversized')}\n`)
    const continued = await readWorkerTranscript({
      agent: 'codex',
      sessionId: 'session-exact',
      transcriptPath,
      offset: oversized.nextOffset,
      expectedSourceFingerprint: oversized.sourceFingerprint,
      expectedBoundaryCheckpoint: oversized.boundaryCheckpoint,
      limit: 2
    })

    expect(continued).toMatchObject({
      ok: true,
      messages: [{ id: 'after', blocks: [{ type: 'text', text: 'after oversized' }] }],
      limited: false
    })
  })
})
