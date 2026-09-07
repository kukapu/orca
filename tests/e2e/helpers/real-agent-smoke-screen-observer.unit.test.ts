import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKER_SCREEN_SAMPLE_INTERVAL_MS,
  deriveSmokeScreenFlags,
  persistSmokeObservation,
  shouldSampleWorkerScreen
} from './real-agent-smoke-screen-observer'

describe('shouldSampleWorkerScreen (temporal)', () => {
  it('samples on cadence WITHOUT any ask — the stall window is covered', () => {
    const startedAt = 1_000_000
    let lastSampleAtMs = Number.NEGATIVE_INFINITY
    const sampled: number[] = []
    for (const tick of [0, 1_000, 5_000, 10_000, 16_000, 20_000, 25_000, 31_000, 46_000]) {
      const nowMs = startedAt + tick
      if (shouldSampleWorkerScreen({ lastSampleAtMs, nowMs })) {
        lastSampleAtMs = nowMs
        sampled.push(tick)
      }
    }
    expect(sampled).toEqual([0, 16_000, 31_000, 46_000])
    expect(WORKER_SCREEN_SAMPLE_INTERVAL_MS).toBe(15_000)
  })
})

describe('deriveSmokeScreenFlags', () => {
  it('detects the real chip, also when wrapped across screen rows', () => {
    expect(deriveSmokeScreenFlags(['banner', ' [Pasted ~12 lines] ', 'footer']).chipPresent).toBe(
      true
    )
    expect(deriveSmokeScreenFlags(['[Pasted ~12 li', 'nes] Ask']).chipPresent).toBe(true)
    expect(deriveSmokeScreenFlags(['Ask anything… "Fix broken tests"']).chipPresent).toBe(false)
  })

  it('strict turn working: only the esc-interrupt footer, never bare dots', () => {
    expect(deriveSmokeScreenFlags(['esc interrupt', 'tab agents']).turnWorking).toBe(true)
    expect(deriveSmokeScreenFlags(['\u25a3  Build · GLM-5.3']).turnWorking).toBe(false)
  })

  it('textual matches stay narrow and never claim blocking', () => {
    const flags = deriveSmokeScreenFlags([
      'Error: invalid API key',
      'Creating a session failed. Open console'
    ])
    expect(flags.authErrorTextualMatch).toBe(true)
    expect(flags.submitErrorToastPresent).toBe(true)
    // Ordinary instruction text does not trip the narrowed patterns.
    const instructions = deriveSmokeScreenFlags([
      'Task: reply READY. Do not use the api key or credential store.',
      'Change directory to the project copy folder.'
    ])
    expect(instructions.authErrorTextualMatch).toBe(false)
    expect(instructions.dialogTextualMatch).toBe(false)
    expect(deriveSmokeScreenFlags(['quota exceeded']).quotaErrorTextualMatch).toBe(true)
    expect(deriveSmokeScreenFlags(['Trust this directory?']).dialogTextualMatch).toBe(true)
  })
})

describe('persistSmokeObservation', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists ONLY flags JSON — a capability SPLIT across rows never appears', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'orca-smoke-observer-test-'))
    dirs.push(root)
    const capability = 'dcap_DEADBEEFCAFEBABE1234'
    const tail = [
      'worker preamble below',
      `capability: ${capability.slice(0, 12)}`,
      `${capability.slice(12)} and instructions`,
      '[Pasted ~12 lines]'
    ]
    const flags = deriveSmokeScreenFlags(tail)
    const file = persistSmokeObservation({
      evidenceRoot: root,
      observation: {
        runtimeId: 'runtime-1',
        testId: 'real OpenCode worker / completes',
        step: '01-worker-start-failed',
        capturedAtMs: 1_000,
        flags,
        screenReadFailed: false
      }
    })
    expect(file).toBe(
      path.join(root, 'runtime-1', 'real_OpenCode_worker_completes', '01-worker-start-failed.json')
    )
    const artifact = readFileSync(file, 'utf8')
    const parsed = JSON.parse(artifact) as { flags: { chipPresent: boolean } }
    expect(parsed.flags.chipPresent).toBe(true)
    // No capability fragment — full, head, or tail — leaks into the artifact.
    expect(artifact).not.toContain(capability)
    expect(artifact).not.toContain(capability.slice(0, 12))
    expect(artifact).not.toContain(capability.slice(12))
    expect(artifact).not.toContain('preamble')
    expect(artifact).not.toContain('Pasted')
    expect(parsed).toMatchObject({ screenReadFailed: false })
  })

  it('records screenReadFailed without any screen string in the artifact', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'orca-smoke-observer-fail-'))
    dirs.push(root)
    const file = persistSmokeObservation({
      evidenceRoot: root,
      observation: {
        runtimeId: 'runtime-1',
        testId: 'read-failed',
        step: '00-ask-poll-live',
        capturedAtMs: 2_000,
        flags: deriveSmokeScreenFlags([]),
        screenReadFailed: true
      }
    })
    const artifact = readFileSync(file, 'utf8')
    const parsed = JSON.parse(artifact) as {
      screenReadFailed: boolean
      flags: { lineCount: number }
    }
    expect(parsed.screenReadFailed).toBe(true)
    expect(parsed.flags.lineCount).toBe(0)
    expect(artifact).not.toContain('terminal.read')
    expect(Object.keys(JSON.parse(artifact))).toEqual([
      'runtimeId',
      'testId',
      'step',
      'capturedAtMs',
      'flags',
      'screenReadFailed'
    ])
  })
})
