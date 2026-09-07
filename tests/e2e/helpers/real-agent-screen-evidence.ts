/**
 * Sanitized capture of a real-agent terminal screen for the Gate B startup
 * probe. The terminal.read contract returns `{ terminal: { tail: string[] } }`
 * — an unexpected shape FAILS instead of fabricating empty output. Credential
 * VALUES are redacted in memory before any generic filter, and are never
 * published, logged, or attached.
 */
export function readTailLinesFromTerminalRead(payload: unknown): string[] {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const terminal =
    result.terminal && typeof result.terminal === 'object' && !Array.isArray(result.terminal)
      ? (result.terminal as Record<string, unknown>)
      : null
  if (!terminal || !Array.isArray(terminal.tail)) {
    throw new Error(
      'terminal.read returned an unexpected shape: expected { terminal: { tail: string[] } }'
    )
  }
  return terminal.tail.every((line) => typeof line === 'string')
    ? (terminal.tail as string[])
    : (() => {
        throw new Error('terminal.read tail contained a non-string line')
      })()
}

/** The REAL chip label opencode 1.18 renders for summarized pastes (source:
 *  lf(text, `[Pasted ~${n} lines]`) in the embedded TUI JS). */
export const PASTED_CHIP_PATTERN = /\[Pasted ~\d+ lines\]/

/** Finds the composer row carrying the real paste chip, if any. */
export function findPastedChipLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => PASTED_CHIP_PATTERN.test(line))
}

/** Error-toast labels the opencode submit chain can render (source: kf()
 *  guards — "Failed to send prompt", "Creating a session failed"). */
export const SUBMIT_ERROR_PATTERNS: readonly RegExp[] = [
  /failed to send prompt/i,
  /creating a session failed/i
]

/** Turn-start cues: the composer is cleared and the session view shows the
 *  submitted user message with a model activity indicator. READY-style text
 *  alone is NEVER a reply verdict — the echoed user message contains it. */
export const TURN_WORKING_PATTERNS: readonly RegExp[] = [
  /esc interrupt/i,
  /esc to interrupt/i,
  /\u25a3|\u25cf/
]

export function isTurnWorkingScreen(lines: readonly string[]): boolean {
  const joined = lines.join('\n')
  return TURN_WORKING_PATTERNS.some((pattern) => pattern.test(joined))
}

/** Coarse screen classification for the controlled submit probe. Returns the
 *  FIRST matching state, preferring explicit submit-path errors over generic
 *  working cues; dialog detection is conservative (capture-and-stop). */
export function classifySubmitScreen(lines: readonly string[]): {
  state: 'error-toast' | 'possible-dialog' | 'working' | 'unknown'
  detail: string | null
} {
  const joined = lines.join('\n')
  for (const pattern of SUBMIT_ERROR_PATTERNS) {
    const match = pattern.exec(joined)
    if (match) {
      return { state: 'error-toast', detail: match[0] }
    }
  }
  const dialog = /(trust this|directory|project copy|select (a )?folder|do you want)/i.exec(joined)
  if (dialog) {
    return { state: 'possible-dialog', detail: dialog[0] }
  }
  const working = /(esc to interrupt|thinking|working)/i.exec(joined)
  if (working) {
    return { state: 'working', detail: working[0] }
  }
  return { state: 'unknown', detail: null }
}

export type TerminalSendReceiptEvidence = {
  handleMatch: boolean | null
  accepted: boolean | null
  bytesWritten: number | null
  refusedReason: string | null
}

/** Whitelist-maps a terminal.send receipt — the real contract is
 *  { send: { handle, accepted, bytesWritten, refusedReason? } } and a refusal
 *  arrives as accepted:false WITHOUT throwing. */
export function extractTerminalSendReceipt(
  payload: unknown,
  expectedHandle: string
): TerminalSendReceiptEvidence {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const send =
    result.send && typeof result.send === 'object' && !Array.isArray(result.send)
      ? (result.send as Record<string, unknown>)
      : null
  if (!send) {
    return {
      handleMatch: null,
      accepted: null,
      bytesWritten: null,
      refusedReason: null
    }
  }
  return {
    handleMatch: send.handle === expectedHandle,
    accepted: send.accepted === true,
    bytesWritten: typeof send.bytesWritten === 'number' ? send.bytesWritten : null,
    refusedReason:
      send.refusedReason === 'permission' || send.refusedReason === 'no-agent'
        ? send.refusedReason
        : typeof send.refusedReason === 'string'
          ? 'unrecognized'
          : null
  }
}

export type TerminalProcessInspectionEvidence = {
  foregroundProcessPresent: boolean
  foregroundProcessName: string | null
  hasChildProcesses: boolean
  verdict: string | null
  foregroundProcessEvidencePresent: boolean
  ptyIncarnationIdPresent: boolean
}

/** Whitelist-maps a terminal.inspectProcess payload; the process name passes
 *  through the same redaction as screen lines before it is reported. */
export function extractProcessInspectionEvidence(
  payload: unknown
): TerminalProcessInspectionEvidence {
  const result =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const process =
    result.process && typeof result.process === 'object' && !Array.isArray(result.process)
      ? (result.process as Record<string, unknown>)
      : {}
  const foreground =
    typeof process.foregroundProcess === 'string' && process.foregroundProcess.length > 0
      ? process.foregroundProcess
      : null
  return {
    foregroundProcessPresent: foreground !== null,
    foregroundProcessName: foreground,
    hasChildProcesses: process.hasChildProcesses === true,
    verdict: typeof process.verdict === 'string' ? process.verdict : null,
    foregroundProcessEvidencePresent: process.foregroundProcessEvidence != null,
    ptyIncarnationIdPresent: typeof process.ptyIncarnationId === 'string'
  }
}

/** Redacts credential VALUES first (exact in-memory replacement), then generic
 *  long tokens, URLs, and credential KEY NAMES. Applied before anything is
 *  printed or attached. */
export function redactTerminalEvidenceText(
  text: string,
  credentialValues: readonly string[]
): string {
  let redacted = text
  for (const value of credentialValues) {
    if (value.length > 0) {
      redacted = redacted.split(value).join('[redacted-credential]')
    }
  }
  redacted = redacted.replace(/https?:\/\/\S+/g, '[redacted-url]')
  redacted = redacted.replace(/[A-Za-z0-9._%-]{24,}/g, '[redacted-token]')
  return redacted
}

export function redactTerminalEvidenceLines(
  lines: readonly string[],
  credentialValues: readonly string[]
): string[] {
  return lines.map((line) => redactTerminalEvidenceText(line, credentialValues))
}
