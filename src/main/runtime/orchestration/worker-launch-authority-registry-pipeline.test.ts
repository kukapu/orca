// Host-registry launch-authority regressions: the runtime's live PTY registry
// (per-pane launchToken records) fences session authority and observed-options
// evidence for fence-scoped hook sources, and superseded replays no longer
// land. Companion to worker-observed-options-pipeline.test.ts, which keeps the
// tokenless/legacy paths; here the registry is wired exactly like production.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AgentHookServer, _internals as hookServerInternals } from '../../agent-hooks/server'
import { OrcaRuntimeService } from '../orca-runtime'
import { createHookListenerState } from '../../../shared/agent-hook-listener/listener-state'
import { normalizeHookPayload } from '../../../shared/agent-hook-listener'
import {
  buildWorkerObservedOptionsObservation,
  type WorkerObservedOptionsObservation
} from './worker-observed-options'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../../telemetry/client', () => ({ track: trackMock }))
vi.mock('../../telemetry/cohort-classifier', () => ({ getCohortAtEmit: getCohortAtEmitMock }))

const LEAF_ID = '77777777-7777-4777-8777-777777777777'
const TAB_ID = 'tab-launch-authority-registry'
const WORKTREE_ID = 'wt-launch-authority-registry'
const PTY_ID = 'pty-launch-authority-registry'
const T2 = 'launch-registry-t2'
const T1 = 'launch-registry-t1'
const MODEL_A = 'xai/grok-4.6'
const MODEL_B = 'zai/glm-5.3'
const MODEL_C = 'openai/gpt-5.3'

type RegistryPipeline = {
  handle: string
  paneKey: string
  observe: (observedAfter: number) => WorkerObservedOptionsObservation
  providerSession: (observedAfter: number) => ExactWorkerProviderSession | null
  postHook: (
    payload: Record<string, unknown>,
    options?: {
      launchToken?: string
      paneKey?: string
      source?: 'opencode' | 'pi' | 'prime-agent'
    }
  ) => Promise<void>
  ingestRemote: (
    payload: Record<string, unknown>,
    options?: {
      isReplay?: boolean
      launchToken?: string
      paneKey?: string
      source?: 'opencode' | 'pi' | 'prime-agent'
    }
  ) => void
}

function assistantMessage(
  messageID: string,
  sessionID: string,
  model: string,
  text: string
): Record<string, unknown> {
  return { hook_event_name: 'MessagePart', role: 'assistant', text, messageID, sessionID, model }
}

function userTurn(messageID: string, sessionID: string, text: string): Record<string, unknown> {
  return { hook_event_name: 'MessagePart', role: 'user', text, messageID, sessionID }
}

function announcedSessionId(server: AgentHookServer, paneKey: string): string | undefined {
  const internal = server as unknown as {
    announcedProviderSessionByPaneKey: Map<string, { sessionId?: unknown }>
  }
  const sessionId = internal.announcedProviderSessionByPaneKey.get(paneKey)?.sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

function statusRowFor(server: AgentHookServer, paneKey: string) {
  return server.getStatusSnapshot().find((row) => row.paneKey === paneKey)
}

function sideRowFor(server: AgentHookServer, paneKey: string) {
  return server.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
}

// Why shared: every stale-content invariant test opens with the same
// A→B handoff followed by removing the previous row (transport clear);
// variants additionally evict the announced watermark so only the
// side-table row names the live session.
function clearPaneStatusRow(server: AgentHookServer, paneKey: string): void {
  const state = (
    server as unknown as {
      _getStateForTests: () => { lastStatusByPaneKey: Map<string, unknown> }
    }
  )._getStateForTests()
  state.lastStatusByPaneKey.delete(paneKey)
}

function evictAnnouncedAuthority(server: AgentHookServer, paneKey: string): void {
  const internal = server as unknown as {
    announcedProviderSessionByPaneKey: Map<string, unknown>
  }
  internal.announcedProviderSessionByPaneKey.delete(paneKey)
}

describe('host-registry launch authority through the real server + runtime pipeline', () => {
  let server: AgentHookServer | undefined
  let runtime: OrcaRuntimeService | undefined

  beforeEach(() => {
    hookServerInternals.resetCachesForTests()
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({})
  })

  afterEach(async () => {
    await server?.stop()
    server = undefined
    runtime = undefined
    vi.restoreAllMocks()
  })

  async function startRegistryPipeline(
    options: { launchToken?: string } = {}
  ): Promise<RegistryPipeline> {
    server = new AgentHookServer()
    await server.start({ env: 'production' })
    runtime = new OrcaRuntimeService(null, undefined, {
      getAgentStatusSnapshot: () =>
        server!.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true),
      getObservedOptionsSnapshot: () => server!.getObservedOptionsSnapshot()
    })
    // Why mirror main-process-runtime-service byte for byte: this binding is
    // the production seam under test (desktop and serve promote through it).
    server.setLiveLaunchTokenHashProvider((paneKey) =>
      runtime!.getLiveLaunchTokenHashForPaneKey(paneKey)
    )
    const internals = runtime as unknown as {
      resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<unknown>
    }
    vi.spyOn(internals, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: WORKTREE_ID,
      path: '/repo/app',
      connectionId: null,
      repo: null,
      folderWorkspace: null
    })
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: PTY_ID, incarnationId: 'inc-1' }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => 'opencode'
    })
    const terminal = await runtime.createTerminal(`id:${WORKTREE_ID}`, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      title: 'worker',
      ...(options.launchToken
        ? { launchConfig: { agentArgs: '', agentEnv: {} }, launchToken: options.launchToken }
        : {})
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'worker',
          activeLeafId: LEAF_ID,
          layout: null
        }
      ],
      leaves: [
        {
          tabId: TAB_ID,
          worktreeId: WORKTREE_ID,
          leafId: LEAF_ID,
          paneRuntimeId: 1,
          ptyId: PTY_ID,
          paneTitle: 'worker'
        }
      ]
    })
    const paneKey = runtime.getTerminalPaneKey(terminal.handle)
    if (!paneKey) {
      throw new Error('Runtime did not expose the worker pane identity.')
    }
    const buildBody = (
      payload: Record<string, unknown>,
      hookOptions: { launchToken?: string; paneKey?: string }
    ): Record<string, unknown> => ({
      paneKey: hookOptions.paneKey ?? paneKey,
      launchToken: hookOptions.launchToken ?? options.launchToken,
      tabId: (hookOptions.paneKey ?? paneKey).split(':')[0],
      worktreeId: WORKTREE_ID,
      env: 'production',
      payload
    })
    return {
      handle: terminal.handle,
      paneKey,
      observe: (observedAfter: number) =>
        buildWorkerObservedOptionsObservation({
          selection: runtime!.getExactWorkerObservedOptions(terminal.handle, observedAfter)
        }),
      providerSession: (observedAfter: number) =>
        runtime!.getExactWorkerProviderSession(terminal.handle, observedAfter),
      postHook: async (payload, hookOptions = {}) => {
        const env = server!.buildPtyEnv()
        const response = await fetch(
          `http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/${hookOptions.source ?? 'opencode'}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
            },
            body: JSON.stringify(buildBody(payload, hookOptions))
          }
        )
        expect(response.status).toBe(204)
      },
      ingestRemote: (payload, hookOptions = {}) => {
        const event = normalizeHookPayload(
          createHookListenerState(),
          hookOptions.source ?? 'opencode',
          buildBody(payload, hookOptions),
          'production'
        )
        if (!event) {
          throw new Error('normalizeHookPayload rejected a known-good fixture')
        }
        server!.ingestRemote(
          { ...event, ...(hookOptions.isReplay ? { isReplay: true } : {}) },
          null
        )
      }
    }
  }

  it('ignores old-generation SessionStart, user turn and assistant when the registry holds T2 (HTTP)', async () => {
    const { observe, providerSession, postHook, paneKey } = await startRegistryPipeline({
      launchToken: T2
    })
    const dispatchCreated = Date.now() - 60_000

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    await postHook(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')

    // Old generation T1 stragglers: birth, resume signal, turn content.
    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-A' }, { launchToken: T1 })
    await postHook(userTurn('msg-a1-user', 'ses-A', 'old generation turn'), { launchToken: T1 })
    await postHook(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'), { launchToken: T1 })

    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
    expect(sideRowFor(server!, paneKey)).toMatchObject({
      providerSessionId: 'ses-B',
      model: MODEL_B
    })
    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-B' },
      model: MODEL_B
    })
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-B')
  })

  it('ignores an old-generation birth even before the new generation speaks (no previous row)', async () => {
    const { postHook, paneKey } = await startRegistryPipeline({ launchToken: T2 })

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-A' }, { launchToken: T1 })
    await postHook(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'), { launchToken: T1 })

    expect(statusRowFor(server!, paneKey)).toBeUndefined()
    expect(sideRowFor(server!, paneKey)).toBeUndefined()
    expect(announcedSessionId(server!, paneKey)).toBeUndefined()

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
  })

  it('keeps legit T2 births, in-generation session changes and user-turn resumes working', async () => {
    const { observe, postHook, paneKey } = await startRegistryPipeline({ launchToken: T2 })
    const dispatchCreated = Date.now() - 60_000

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-A2' })
    await postHook(assistantMessage('msg-a2', 'ses-A2', MODEL_A, 'A2 reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-B2' })
    await postHook(assistantMessage('msg-b2', 'ses-B2', MODEL_B, 'B2 reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B2')

    // Resume of the earlier session inside the same generation.
    await postHook(userTurn('msg-a3-user', 'ses-A2', 'back on A2'))
    await postHook(assistantMessage('msg-a3', 'ses-A2', MODEL_C, 'A2 resumed reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_C })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-A2')
  })

  it('fences old-generation events over the SSH remote ingress (registry-live T2)', async () => {
    const { observe, providerSession, ingestRemote, paneKey } = await startRegistryPipeline({
      launchToken: T2
    })
    const dispatchCreated = Date.now() - 60_000

    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-A' }, { launchToken: T1 })
    ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'), { launchToken: T1 })
    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'A late reply'), {
      launchToken: T1,
      isReplay: true
    })

    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
    expect(sideRowFor(server!, paneKey)).toMatchObject({
      providerSessionId: 'ses-B',
      model: MODEL_B
    })
    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-B' },
      model: MODEL_B
    })
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-B')
  })

  it('rejects a superseded replay restating session A after B holds the row (same generation)', async () => {
    const { observe, ingestRemote, paneKey } = await startRegistryPipeline({ launchToken: T2 })
    const dispatchCreated = Date.now() - 60_000

    ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'))
    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A replayed reply'), {
      isReplay: true
    })

    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-B' },
      model: MODEL_B
    })
    expect(sideRowFor(server!, paneKey)).toMatchObject({
      providerSessionId: 'ses-B',
      model: MODEL_B
    })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
  })

  it('does not land a superseded replay without a previous row; the read never attributes A', async () => {
    const { observe, providerSession, ingestRemote, paneKey } = await startRegistryPipeline({
      launchToken: T2
    })
    const dispatchCreated = Date.now() - 60_000

    ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'))
    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))

    // Transport clear: the status row is deleted (absence, not completion)
    // while the announced authority survives, like a relay reconnect clear.
    const state = (
      server as unknown as {
        _getStateForTests: () => { lastStatusByPaneKey: Map<string, unknown> }
      }
    )._getStateForTests()
    state.lastStatusByPaneKey.delete(paneKey)

    ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A replayed reply'), {
      isReplay: true
    })

    // The dead session's replay never lands as current evidence…
    expect(statusRowFor(server!, paneKey)).toBeUndefined()
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
    // …the exact read declares no session rather than attributing A…
    expect(providerSession(dispatchCreated)).toBeNull()
    // …and B's valid stored option evidence still answers the options read.
    expect(sideRowFor(server!, paneKey)).toMatchObject({
      providerSessionId: 'ses-B',
      model: MODEL_B
    })
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    // The live session's own replay still rehydrates after the same clear.
    ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B replayed reply'), {
      isReplay: true
    })
    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-B' },
      model: MODEL_B
    })
  })

  it('does not land a superseded identity-only Pi session_start replay without a previous row', async () => {
    const { providerSession, postHook, ingestRemote, paneKey } = await startRegistryPipeline({
      launchToken: T2
    })
    const dispatchCreated = Date.now() - 60_000

    await postHook(
      {
        hook_event_name: 'before_agent_start',
        prompt: 'session A work',
        model: MODEL_B,
        session_id: 'ses-pi-a',
        session_file: '/tmp/orca-launch-authority/ses-pi-a.jsonl'
      },
      { source: 'pi' }
    )
    await postHook(
      {
        hook_event_name: 'session_start',
        session_id: 'ses-pi-b',
        session_file: '/tmp/orca-launch-authority/ses-pi-b.jsonl'
      },
      { source: 'pi' }
    )
    expect(announcedSessionId(server!, paneKey)).toBe('ses-pi-b')

    const state = (
      server as unknown as {
        _getStateForTests: () => { lastStatusByPaneKey: Map<string, unknown> }
      }
    )._getStateForTests()
    state.lastStatusByPaneKey.delete(paneKey)

    // Replayed identity-only announcement of the dead session: must not land.
    ingestRemote(
      {
        hook_event_name: 'session_start',
        session_id: 'ses-pi-a',
        session_file: '/tmp/orca-launch-authority/ses-pi-a.jsonl'
      },
      { isReplay: true, source: 'pi' }
    )

    expect(statusRowFor(server!, paneKey)).toBeUndefined()
    expect(announcedSessionId(server!, paneKey)).toBe('ses-pi-b')
    expect(providerSession(dispatchCreated)).toBeNull()
  })

  // Why shared body: the stale-session invariant is ingress-agnostic — the
  // same A→B handoff, clear, and stale arrival must behave identically over
  // HTTP and the remote relay path.
  async function runStaleContentInvariant(
    pipeline: RegistryPipeline,
    post: (
      payload: Record<string, unknown>,
      options?: { isReplay?: boolean }
    ) => Promise<void> | void,
    options: { evictAuthority?: boolean; isReplay?: boolean } = {}
  ): Promise<void> {
    const { paneKey, providerSession, observe } = pipeline
    const dispatchCreated = Date.now() - 60_000
    await post(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'))
    await post({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    await post(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    clearPaneStatusRow(server!, paneKey)
    if (options.evictAuthority) {
      evictAnnouncedAuthority(server!, paneKey)
    }

    await post(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'A stale reply'), {
      isReplay: options.isReplay
    })

    expect(statusRowFor(server!, paneKey)).toBeUndefined()
    expect(sideRowFor(server!, paneKey)).toMatchObject({
      providerSessionId: 'ses-B',
      model: MODEL_B
    })
    expect(providerSession(dispatchCreated)).toBeNull()
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
  }

  it('never lands a live stale-A straggler without a previous row (HTTP, announced authority)', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    await runStaleContentInvariant(pipeline, (payload) => pipeline.postHook(payload))
  })

  it('never lands a live stale-A straggler without a previous row (remote, announced authority)', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    await runStaleContentInvariant(pipeline, (payload) => pipeline.ingestRemote(payload))
  })

  it('never lands a replayed stale-A row when only the side-table fallback names B (remote)', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    await runStaleContentInvariant(
      pipeline,
      (payload, options = {}) => pipeline.ingestRemote(payload, options),
      {
        evictAuthority: true,
        isReplay: true
      }
    )
  })

  it('never lands a live stale-A straggler when the announcement watermark was evicted (HTTP)', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    await runStaleContentInvariant(pipeline, (payload) => pipeline.postHook(payload), {
      evictAuthority: true
    })
  })

  it('never lands a live stale-A straggler when the announcement watermark was evicted (remote)', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    await runStaleContentInvariant(pipeline, (payload) => pipeline.ingestRemote(payload), {
      evictAuthority: true
    })
  })

  it('keeps current-B content landing after a clear and the legitimate user-turn resume of A working', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    const { observe, providerSession, postHook, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await postHook(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'A reply'))
    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    await postHook(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    clearPaneStatusRow(server!, paneKey)

    // Live current-session content still lands after the clear…
    await postHook(assistantMessage('msg-b2', 'ses-B', MODEL_B, 'B reply two'))
    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-B' },
      model: MODEL_B
    })

    // …and a legitimate non-replay user-turn resume of A is never blocked.
    await postHook(userTurn('msg-a3-user', 'ses-A', 'back on A for real'))
    expect(announcedSessionId(server!, paneKey)).toBe('ses-A')
    await postHook(assistantMessage('msg-a3', 'ses-A', MODEL_A, 'A resumed reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-A')
  })

  it('suppresses a stale prime-agent before_agent_start under a known B side-row, keeps current B passing', async () => {
    const pipeline = await startRegistryPipeline({ launchToken: T2 })
    const { postHook, paneKey } = pipeline
    const primeAgentTurn = (sessionId: string, prompt: string): Record<string, unknown> => ({
      hook_event_name: 'before_agent_start',
      prompt,
      model: MODEL_B,
      session_id: sessionId,
      session_file: `/tmp/orca-launch-authority/${sessionId}.jsonl`
    })

    // prime-agent (pi-family mapping) announces no SessionStart here, so the
    // valid B evidence lives in the observed-options side row.
    await postHook(primeAgentTurn('ses-pa-b', 'B work'), { source: 'prime-agent' })
    clearPaneStatusRow(server!, paneKey)
    expect(sideRowFor(server!, paneKey)).toMatchObject({ providerSessionId: 'ses-pa-b' })

    await postHook(primeAgentTurn('ses-pa-a', 'stale A work'), { source: 'prime-agent' })
    expect(statusRowFor(server!, paneKey)).toBeUndefined()
    expect(sideRowFor(server!, paneKey)).toMatchObject({ providerSessionId: 'ses-pa-b' })

    await postHook(primeAgentTurn('ses-pa-b', 'B work two'), { source: 'prime-agent' })
    expect(statusRowFor(server!, paneKey)).toMatchObject({
      providerSession: { id: 'ses-pa-b' }
    })
  })

  it('keeps the tokenless pane on hook-data rules: a token the pane never minted still lands', async () => {
    const { observe, postHook, paneKey } = await startRegistryPipeline()
    const dispatchCreated = Date.now() - 60_000

    await postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    await postHook(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
  })

  it('keeps unknown panes on hook-data rules when the registry has no answer', async () => {
    const { ingestRemote } = await startRegistryPipeline({ launchToken: T2 })
    const unknownPane = 'tab-registry-unknown:88888888-8888-4888-9888-888888888888'

    ingestRemote(
      { hook_event_name: 'SessionStart', sessionID: 'ses-X' },
      { paneKey: unknownPane, launchToken: 'launch-somebody-elses' }
    )
    ingestRemote(assistantMessage('msg-x1', 'ses-X', MODEL_A, 'X reply'), {
      paneKey: unknownPane,
      launchToken: 'launch-somebody-elses'
    })

    expect(announcedSessionId(server!, unknownPane)).toBe('ses-X')
    expect(sideRowFor(server!, unknownPane)).toMatchObject({ providerSessionId: 'ses-X' })
  })

  it('answers unknown, not tokenless, for a remote-execution pane without a local token', async () => {
    const { paneKey } = await startRegistryPipeline()
    const internal = runtime as unknown as {
      ptysById: Map<string, { launchToken: string | null; connectionId: string | null }>
    }
    const pty = internal.ptysById.get(PTY_ID)!

    expect(pty.launchToken).toBeNull()
    expect(runtime!.getLiveLaunchTokenHashForPaneKey(paneKey)).toBeNull()

    pty.connectionId = 'conn-remote'
    expect(runtime!.getLiveLaunchTokenHashForPaneKey(paneKey)).toBeUndefined()

    pty.launchToken = T2
    pty.connectionId = null
    const hash = runtime!.getLiveLaunchTokenHashForPaneKey(paneKey)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)

    expect(
      runtime!.getLiveLaunchTokenHashForPaneKey('tab-none:99999999-9999-4999-8999-999999999999')
    ).toBeUndefined()
  })

  it('composes pane transfer with the live registry: backstop where silent, fence where live', async () => {
    // Backstop: a detached target with no live pty accepts the transferred
    // process's posts through the alias, exactly as before the registry.
    const backstop = await startRegistryPipeline({ launchToken: T1 })
    const detachedTarget = 'tab-registry-move:aaaaaaaa-1aaa-4aaa-9aaa-aaaaaaaaaaaa'
    await backstop.postHook({ hook_event_name: 'SessionStart', sessionID: 'ses-src' })
    await backstop.postHook(assistantMessage('msg-src', 'ses-src', MODEL_A, 'src reply'))
    server!.transferPaneAuthority(backstop.paneKey, detachedTarget, 'pty-move')
    expect(announcedSessionId(server!, detachedTarget)).toBe('ses-src')
    await backstop.postHook(assistantMessage('msg-src-2', 'ses-src', MODEL_A, 'src later reply'))
    expect(statusRowFor(server!, detachedTarget)?.providerSession?.id).toBe('ses-src')
    await server!.stop()

    // Fence: a target pane with a live T2 pty suppresses the transferred
    // process's T1 posts — the registry outranks moved hook-data authority.
    const fenced = await startRegistryPipeline({ launchToken: T2 })
    const liveTarget = fenced.paneKey
    const source = 'tab-registry-src:bbbbbbbb-2bbb-4bbb-9bbb-bbbbbbbbbbbb'
    server!.transferPaneAuthority(source, liveTarget, 'pty-move-2')
    await fenced.postHook(
      { hook_event_name: 'SessionStart', sessionID: 'ses-old' },
      { launchToken: T1, paneKey: source }
    )
    await fenced.postHook(assistantMessage('msg-old', 'ses-old', MODEL_A, 'old reply'), {
      launchToken: T1,
      paneKey: source
    })
    expect(statusRowFor(server!, liveTarget)).toBeUndefined()
    expect(announcedSessionId(server!, liveTarget)).toBeUndefined()
  })

  it('binds the registry provider in the shared desktop/serve runtime wiring', async () => {
    await startRegistryPipeline()
    const wiringSource = readFileSync(
      fileURLToPath(new URL('../../startup/main-process-runtime-service.ts', import.meta.url)),
      'utf8'
    )
    // Why a source assertion: ingestRemote tests cannot substitute for the
    // host wiring — this locks the production seam both entry points share.
    expect(wiringSource).toContain('agentHookServer.setLiveLaunchTokenHashProvider')
    expect(wiringSource).toMatch(/runtime\.getLiveLaunchTokenHashForPaneKey\(paneKey\)/)
  })
})
