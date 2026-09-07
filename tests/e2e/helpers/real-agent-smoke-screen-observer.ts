/**
 * Safe screen observability for the real-agent smoke (msg_90fee9d66efa as
 * corrected by msg_670e66d2cf4e): the raw tail NEVER reaches persistence —
 * it lives in memory only to derive booleans/enums. Artifacts contain ONLY a
 * JSON of flags, timestamps, and allowlisted identities; screen strings, the
 * preamble, and its capability cannot leak even when wrapped across rows.
 * Ambiguous text patterns are named *TextualMatch and never claim blocking.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PASTED_CHIP_PATTERN } from './real-agent-screen-evidence'

export type SmokeScreenFlags = {
  chipPresent: boolean
  composerPlaceholderPresent: boolean
  /** STRICT turn activity cue: the footer shown only while a turn runs. */
  turnWorking: boolean
  authErrorTextualMatch: boolean
  quotaErrorTextualMatch: boolean
  dialogTextualMatch: boolean
  submitErrorToastPresent: boolean
  readyEchoPresent: boolean
  lineCount: number
}

export type SmokeScreenObservation = {
  runtimeId: string
  testId: string
  step: string
  capturedAtMs: number
  flags: SmokeScreenFlags
  /** True when terminal.read itself failed — recorded, never swallowed. */
  screenReadFailed: boolean
}

/** Sampling cadence for the bounded live observation window. */
export const WORKER_SCREEN_SAMPLE_INTERVAL_MS = 15_000

/** Pure sampling decision: cadence-based and INDEPENDENT of the ask — the
 *  stall-without-ask window is exactly what must be sampled. */
export function shouldSampleWorkerScreen(state: {
  lastSampleAtMs: number
  nowMs: number
  intervalMs?: number
}): boolean {
  const interval = state.intervalMs ?? WORKER_SCREEN_SAMPLE_INTERVAL_MS
  return state.nowMs - state.lastSampleAtMs >= interval
}

function compactJoined(lines: readonly string[]): string {
  return `${lines.join(' ').replace(/\s+/g, ' ')}\n${lines.join('')}`
}

export function deriveSmokeScreenFlags(tail: readonly string[]): SmokeScreenFlags {
  const joined = compactJoined(tail)
  const anyLine = (pattern: RegExp): boolean => tail.some((line) => pattern.test(line))
  return {
    chipPresent: anyLine(PASTED_CHIP_PATTERN) || PASTED_CHIP_PATTERN.test(joined),
    composerPlaceholderPresent: anyLine(/ask anything|run a command/i),
    turnWorking: anyLine(/esc (to )?interrupt/i),
    authErrorTextualMatch: anyLine(/invalid api key|unauthorized|forbidden/i),
    quotaErrorTextualMatch: anyLine(/rate limit|quota exceeded|insufficient (credit|balance)/i),
    dialogTextualMatch: anyLine(
      /trust this (directory|folder)\?|do you want to|select (a )?project copy/i
    ),
    submitErrorToastPresent: anyLine(/failed to send prompt|creating a session failed/i),
    // Boolean bookkeeping only: READY appears in the echoed user message and
    // is NEVER an assistant-reply verdict.
    readyEchoPresent: anyLine(/\bREADY\b/),
    lineCount: tail.length
  }
}

/** Persists ONLY the flag/identity JSON — never tail text or credentials. */
export function persistSmokeObservation(args: {
  evidenceRoot: string
  observation: SmokeScreenObservation
}): string {
  const dir = path.join(
    args.evidenceRoot,
    args.observation.runtimeId,
    args.observation.testId.replace(/[^\w.-]+/g, '_')
  )
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${args.observation.step}.json`)
  writeFileSync(file, `${JSON.stringify(args.observation, null, 2)}\n`, { mode: 0o600 })
  return file
}
