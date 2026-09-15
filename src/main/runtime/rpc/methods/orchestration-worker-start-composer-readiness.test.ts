import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_PROMPT_BRACKETED_PASTE_END } from '../../../../shared/agent-prompt-injection'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import {
  AGENT_PROMPT_TEST_WORKTREE_ID,
  createAgentPromptSubmissionRuntime
} from '../../agent-prompt-submission-runtime-test-fixture'
import { OrchestrationDb } from '../../orchestration/db'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'

vi.mock('../../../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/composer-readiness',
      isBare: false,
      isMainWorktree: false
    }
  ]),
  listWorktreesStrict: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/composer-readiness',
      isBare: false,
      isMainWorktree: false
    }
  ])
}))

const COORDINATOR_PANE_KEY = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKER_PANE_KEY = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb'
const OPENCODE_WORKING_TITLE = '\x1b]0;OC | ⠋ task\x07'
const OPENCODE_IDLE_TITLE = '\x1b]0;OC | Build · GLM-5.3\x07'

type ComposerScenario =
  | 'late-mount'
  | 'premounted'
  | 'never-mount'
  | 'reused'
  | 'codex'
  | 'mimo-code'
  | 'short-budget'

type ComposerHarness = {
  dispatcher: RpcDispatcher
  request: RpcRequest
  writes: string[]
  mountComposer: () => void
}

const openDatabases: OrchestrationDb[] = []
const temporaryRoots: string[] = []

async function createComposerHarness(scenario: ComposerScenario): Promise<ComposerHarness> {
  const agent: TuiAgent =
    scenario === 'codex' ? 'codex' : scenario === 'mimo-code' ? 'mimo-code' : 'opencode'
  const fixture = await createAgentPromptSubmissionRuntime(
    (runtime, data) => {
      if (data !== '\r') {
        return
      }
      runtime.onPtyData(
        'pty-prompt',
        agent === 'codex'
          ? '\x1b]0;Codex working\x07'
          : agent === 'mimo-code'
            ? '\x1b]0;mimo ⠋ task\x07'
            : OPENCODE_WORKING_TITLE,
        Date.now()
      )
    },
    agent,
    {
      getForegroundProcess: async () =>
        agent === 'codex' ? 'codex' : agent === 'mimo-code' ? 'mimo' : 'opencode'
    }
  )
  const { runtime, handle } = fixture

  // Why fragmented: the scanner must rejoin escape sequences across chunk boundaries.
  const emit = (data: string): void => {
    runtime.onPtyData('pty-prompt', data, Date.now())
  }
  if (scenario === 'late-mount' || scenario === 'never-mount' || scenario === 'short-budget') {
    emit('opencode boot frame\n')
    emit('\x1b[?20')
    emit('04h')
  }
  if (scenario === 'premounted') {
    emit('\x1b[?20')
    emit('04h')
    emit('\x1b[?2')
    emit('5h composer frame')
  }
  if (scenario === 'reused') {
    emit(OPENCODE_IDLE_TITLE)
  }
  if (scenario === 'codex') {
    emit('\x1b]0;Codex idle\x07')
  }
  if (scenario === 'mimo-code') {
    emit('\x1b]0;mimo ready\x07')
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'orca-worker-composer-'))
  temporaryRoots.push(temporaryRoot)
  const db = new OrchestrationDb(join(temporaryRoot, 'orchestration.db'))
  openDatabases.push(db)
  runtime.setOrchestrationDb(db)
  const run = db.createRun({
    objective: 'Worker composer readiness',
    coordinatorHandle: 'term_coord',
    coordinatorPaneKey: COORDINATOR_PANE_KEY
  })
  const task = db.createTask({ spec: 'gate the preamble on composer readiness', runId: run.id })
  vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((candidate) =>
    candidate === 'term_coord'
      ? COORDINATOR_PANE_KEY
      : candidate === handle
        ? WORKER_PANE_KEY
        : null
  )
  vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((candidate) =>
    candidate === handle ? `runtime_test:${handle}:1` : null
  )
  vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
  vi.spyOn(runtime, 'assertAgentLaunchableOnWorkspaceHost').mockResolvedValue()
  vi.spyOn(runtime, 'assertAgentLaunchableOnRepoHost').mockResolvedValue()
  vi.spyOn(runtime, 'showTerminal').mockImplementation(async (candidate: string) =>
    candidate === 'term_coord'
      ? ({ handle: 'term_coord', worktreeId: 'repo::parent', status: 'running' } as never)
      : ({ handle: candidate, worktreeId: 'repo::parent', status: 'running' } as never)
  )
  vi.spyOn(runtime, 'showManagedWorktree').mockResolvedValue({
    id: 'repo::parent',
    repoId: 'repo-1'
  } as never)
  vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
    id: 'repo::parent',
    repoId: 'repo-1'
  } as never)
  vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
  // Idle evidence and composer mounting are independent gates; this suite exercises the latter.
  vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
    handle,
    condition: 'tui-idle',
    satisfied: true,
    status: 'running',
    exitCode: null
  })
  vi.spyOn(runtime, 'showRepo').mockResolvedValue({ id: 'repo-1', kind: 'git' } as never)
  vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
    worktree: { id: AGENT_PROMPT_TEST_WORKTREE_ID, repoId: 'repo-1' },
    startupTerminal: { spawned: true, handle },
    setupReceipt: {
      requested: 'run',
      hookFound: false,
      startupPolicy: 'start-immediately',
      state: 'not_configured'
    }
  } as never)
  vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')

  return {
    dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }),
    request: {
      id: `rpc_${scenario}`,
      authToken: 'caller-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `composer_readiness_${scenario}`,
      method: 'orchestration.workerStart',
      params:
        scenario === 'reused'
          ? { task: task.id, from: 'term_coord', terminal: handle }
          : {
              task: task.id,
              from: 'term_coord',
              worktree: 'new-child',
              name: `composer-${scenario}`,
              agent,
              ...(scenario === 'short-budget' || scenario === 'never-mount'
                ? { timeoutMs: 5_000 }
                : {})
            }
    },
    writes: fixture.writes,
    mountComposer: () => {
      emit('\x1b[?2')
      emit('5h composer frame')
    }
  }
}

describe('orchestration worker-start OpenCode composer readiness', () => {
  afterEach(() => {
    for (const db of openDatabases.splice(0)) {
      db.close()
    }
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
    vi.useRealTimers()
  })

  it('holds the preamble until the OpenCode composer mounts after tui-idle settles', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('late-mount')
    const pending = harness.dispatcher.dispatch(harness.request)

    // Even with positive idle evidence, paste must wait for the show-cursor.
    await vi.advanceTimersByTimeAsync(6_000)
    expect(harness.writes.some((data) => data.includes(AGENT_PROMPT_BRACKETED_PASTE_END))).toBe(
      false
    )
    expect(harness.writes).not.toContain('\r')

    harness.mountComposer()
    await vi.runAllTimersAsync()
    const response = await pending
    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(harness.writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('resolves the composer gate from fragmented markers that predate the wait', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('premounted')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.runAllTimersAsync()
    const response = await pending
    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(harness.writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('does not write the preamble when the marker arrives after the remaining readiness budget', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('short-budget')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.advanceTimersByTimeAsync(4_200)
    expect(harness.writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    harness.mountComposer()
    await vi.advanceTimersByTimeAsync(2_000)
    const response = await pending
    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'failed',
        failedStage: 'agent_readiness',
        lastError: expect.stringContaining('composer')
      }
    })
    expect(harness.writes).toHaveLength(0)
  })

  it('fails with zero preamble writes when the composer never mounts', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('never-mount')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.advanceTimersByTimeAsync(15_000)
    const response = await pending
    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'failed',
        failedStage: 'agent_readiness',
        lastError: expect.stringContaining('composer')
      }
    })
    expect(harness.writes).toHaveLength(0)
  })

  it('skips the composer gate for a reused terminal', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('reused')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.runAllTimersAsync()
    const response = await pending
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(harness.writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('leaves mimo-code created workers on the existing readiness path', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('mimo-code')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.runAllTimersAsync()
    const response = await pending
    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(harness.writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('leaves Codex worker starts on the existing readiness path', async () => {
    vi.useFakeTimers()
    const harness = await createComposerHarness('codex')
    const pending = harness.dispatcher.dispatch(harness.request)

    await vi.runAllTimersAsync()
    const response = await pending
    expect(response).toMatchObject({ ok: true, result: { state: 'ready' } })
    expect(harness.writes.filter((data) => data === '\r')).toHaveLength(1)
  })

  it('rejects composer ready when the same pty generation changes during the wait', async () => {
    vi.useFakeTimers()
    const fixture = await createAgentPromptSubmissionRuntime(() => {}, 'opencode', {
      getForegroundProcess: async () => 'opencode'
    })
    fixture.runtime.onPtyData('pty-prompt', '\x1b[?2004h', Date.now())
    const pending = fixture.runtime.waitForWorkerAgentComposerReady(fixture.handle, 'opencode')
    const internals = fixture.runtime as unknown as {
      advancePtyLifecycleGeneration: (ptyId: string) => void
    }
    internals.advancePtyLifecycleGeneration('pty-prompt')
    fixture.runtime.onPtyData('pty-prompt', '\x1b[?25h composer frame', Date.now())
    await expect(pending).resolves.toBe(false)
    expect(fixture.writes).toHaveLength(0)
  })

  it('aborts the composer wait without side effects', async () => {
    // Direct runtime API only: workerStart RPC is a durable mutation and
    // must not treat client-disconnect RpcContext.signal as worker cancel.
    vi.useFakeTimers()
    const fixture = await createAgentPromptSubmissionRuntime(() => {}, 'opencode', {
      getForegroundProcess: async () => 'opencode'
    })
    fixture.runtime.onPtyData('pty-prompt', '\x1b[?2004h', Date.now())
    const abort = new AbortController()
    const pending = fixture.runtime.waitForWorkerAgentComposerReady(fixture.handle, 'opencode', {
      signal: abort.signal
    })
    abort.abort()
    await expect(pending).rejects.toThrow('request_aborted')
    expect(fixture.writes).toHaveLength(0)
  })

  it('ignores composer markers emitted by another pty', async () => {
    vi.useFakeTimers()
    let spawns = 0
    const fixture = await createAgentPromptSubmissionRuntime(() => {}, 'opencode', {
      getForegroundProcess: async () => 'opencode',
      spawn: async () => ({ id: `pty-prompt-${(spawns += 1)}` })
    })
    const second = await fixture.runtime.createTerminal('path:/tmp/worktree-a', {
      launchAgent: 'opencode'
    })
    expect(second.handle).not.toBe(fixture.handle)
    fixture.runtime.onPtyData('pty-prompt-1', '\x1b[?2004h', Date.now())
    fixture.runtime.onPtyData(
      'pty-prompt-2',
      '\x1b[?2004h\x1b[?25h other pane composer',
      Date.now()
    )
    const pending = fixture.runtime.waitForWorkerAgentComposerReady(fixture.handle, 'opencode')
    await vi.advanceTimersByTimeAsync(9_000)
    await expect(pending).resolves.toBe(false)
    expect(fixture.writes).toHaveLength(0)
  })
})
