import { describe, expect, it } from 'vitest'
import {
  PASTED_CHIP_PATTERN,
  classifySubmitScreen,
  extractProcessInspectionEvidence,
  extractTerminalSendReceipt,
  findPastedChipLineIndex,
  isTurnWorkingScreen,
  readTailLinesFromTerminalRead,
  redactTerminalEvidenceLines,
  redactTerminalEvidenceText
} from './real-agent-screen-evidence'

describe('paste chip oracle (real opencode label)', () => {
  it('matches the real [Pasted ~N lines] chip label', () => {
    expect(PASTED_CHIP_PATTERN.test('[Pasted ~12 lines] ')).toBe(true)
    expect(PASTED_CHIP_PATTERN.test('[Pasted ~3 lines]')).toBe(true)
    expect(findPastedChipLineIndex(['banner', ' [Pasted ~12 lines] Ask'])).toBe(1)
  })

  it('does NOT match the old wrong label or plain text (regression guard)', () => {
    expect(PASTED_CHIP_PATTERN.test('pasted text')).toBe(false)
    expect(PASTED_CHIP_PATTERN.test('[Pasted 12 lines]')).toBe(false)
    expect(findPastedChipLineIndex(['Ask anything… "Fix broken tests"'])).toBe(-1)
  })
})

describe('classifySubmitScreen', () => {
  it('prefers explicit submit errors over generic cues', () => {
    expect(classifySubmitScreen(['  Failed to send prompt', 'esc to interrupt'])).toEqual({
      state: 'error-toast',
      detail: 'Failed to send prompt'
    })
    expect(classifySubmitScreen(['Creating a session failed. Open console'])).toMatchObject({
      state: 'error-toast'
    })
  })

  it('detects dialog cues conservatively and working indicators', () => {
    expect(classifySubmitScreen(['Trust this directory?'])).toMatchObject({
      state: 'possible-dialog'
    })
    expect(classifySubmitScreen(['  ESC to interrupt'])).toMatchObject({ state: 'working' })
    expect(classifySubmitScreen(['plain screen'])).toEqual({ state: 'unknown', detail: null })
  })

  it('turn-start oracle: echoed READY is NEVER a working screen (regression guard)', () => {
    const echoedUserMessage = [
      'Task: reply with exactly READY and nothing else.',
      '- expected reply: READY'
    ]
    expect(isTurnWorkingScreen(echoedUserMessage)).toBe(false)
    const workingScreen = [
      'XPROBE8R diagnostic draft (e2e probe).',
      '\u25a3  Build · GLM-5.3',
      'esc interrupt'
    ]
    expect(isTurnWorkingScreen(workingScreen)).toBe(true)
  })
})

describe('readTailLinesFromTerminalRead', () => {
  it('returns tail lines from the real contract shape', () => {
    expect(readTailLinesFromTerminalRead({ terminal: { tail: ['line 1', 'line 2'] } })).toEqual([
      'line 1',
      'line 2'
    ])
  })

  it('fails on unexpected shapes instead of fabricating empty output', () => {
    expect(() => readTailLinesFromTerminalRead({ terminal: { screen: '', text: '' } })).toThrow(
      'unexpected shape'
    )
    expect(() => readTailLinesFromTerminalRead({ terminal: { tail: 'not-an-array' } })).toThrow(
      'unexpected shape'
    )
    expect(() => readTailLinesFromTerminalRead({ terminal: { tail: [1, 2] } })).toThrow(
      'non-string line'
    )
    expect(() => readTailLinesFromTerminalRead(null)).toThrow('unexpected shape')
  })
})

describe('redactTerminalEvidenceText', () => {
  it('redacts exact credential values in memory before other filters', () => {
    const out = redactTerminalEvidenceText('token sk-live-abc123 appears twice sk-live-abc123!', [
      'sk-live-abc123'
    ])
    expect(out).toBe('token [redacted-credential] appears twice [redacted-credential]!')
    expect(out).not.toContain('sk-live-abc123')
  })

  it('redacts urls and long tokens generically', () => {
    const out = redactTerminalEvidenceText(
      'see https://zai.example/v1/chat and abcdef0123456789abcdef0123456789',
      []
    )
    expect(out).toBe('see [redacted-url] and [redacted-token]')
  })

  it('keeps short ordinary TUI text intact', () => {
    expect(redactTerminalEvidenceText('  > Ask anything', [])).toBe('  > Ask anything')
  })
})

describe('redactTerminalEvidenceLines / extractProcessInspectionEvidence', () => {
  it('redacts line by line', () => {
    expect(redactTerminalEvidenceLines(['k-1', 'plain'], ['k-1'])).toEqual([
      '[redacted-credential]',
      'plain'
    ])
  })

  it('whitelists process inspection fields', () => {
    const evidence = extractProcessInspectionEvidence({
      process: {
        foregroundProcess: 'opencode',
        hasChildProcesses: true,
        verdict: 'live',
        foregroundProcessEvidence: { pid: 123 },
        ptyIncarnationId: 'inc-1'
      }
    })
    expect(evidence).toEqual({
      foregroundProcessPresent: true,
      foregroundProcessName: 'opencode',
      hasChildProcesses: true,
      verdict: 'live',
      foregroundProcessEvidencePresent: true,
      ptyIncarnationIdPresent: true
    })
    expect(extractProcessInspectionEvidence({ process: {} }).foregroundProcessPresent).toBe(false)
    expect(extractProcessInspectionEvidence(null).verdict).toBeNull()
  })

  it('maps typed terminal.send receipts including silent refusals', () => {
    expect(
      extractTerminalSendReceipt(
        { send: { handle: 't-1', accepted: true, bytesWritten: 642 } },
        't-1'
      )
    ).toEqual({
      handleMatch: true,
      accepted: true,
      bytesWritten: 642,
      refusedReason: null
    })
    expect(
      extractTerminalSendReceipt(
        { send: { handle: 't-1', accepted: false, bytesWritten: 0, refusedReason: 'permission' } },
        't-1'
      ).refusedReason
    ).toBe('permission')
    const unknown = extractTerminalSendReceipt(
      { send: { handle: 'other', accepted: false, bytesWritten: 0, refusedReason: 'weird' } },
      't-1'
    )
    expect(unknown.refusedReason).toBe('unrecognized')
    expect(unknown.handleMatch).toBe(false)
    expect(extractTerminalSendReceipt({}, 't-1').accepted).toBeNull()
  })
})
