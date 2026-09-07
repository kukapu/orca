// Real server+runtime pipeline regressions for observed launch-option evidence:
// hook ingress → AgentHookServer caches → OrcaRuntimeService.getExactWorkerObservedOptions.
// Defects covered: provider-session fencing in the side table, the evidence clock
// the runtime compares against the Dispatch window, and source combination when
// the side table is defined but empty.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals as hookServerInternals } from '../../agent-hooks/server'
import { OrcaRuntimeService } from '../orca-runtime'
import { createHookListenerState } from '../../../shared/agent-hook-listener/listener-state'
import { normalizeHookPayload } from '../../../shared/agent-hook-listener'
import {
  buildWorkerObservedOptionsObservation,
  selectExactWorkerObservedOptions,
  type WorkerObservedOptionsObservation
} from './worker-observed-options'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'
import { selectExactWorkerProviderSession } from './worker-provider-session'

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

const LEAF_ID = '44444444-4444-4444-8444-444444444444'
const TAB_ID = 'tab-observed-options-pipeline'
const WORKTREE_ID = 'wt-observed-options-pipeline'
const PTY_ID = 'pty-observed-options-pipeline'
const LAUNCH_TOKEN = 'launch-pipeline-1'

type Pipeline = {
  handle: string
  paneKey: string
  observe: (observedAfter: number) => WorkerObservedOptionsObservation
  providerSession: (observedAfter: number) => ExactWorkerProviderSession | null
  postHook: (
    source: 'opencode' | 'pi',
    payload: Record<string, unknown>,
    options?: { launchToken?: string }
  ) => Promise<void>
  ingestRemote: (
    payload: Record<string, unknown>,
    options?: { isReplay?: boolean; launchToken?: string }
  ) => void
}

// Why shape-agnostic: the authority entry gains source/launchToken with the
// fix, but these assertions must read the pre-fix string entries while RED.
function announcedSessionId(server: AgentHookServer, paneKey: string): string | undefined {
  const internal = server as unknown as {
    announcedProviderSessionByPaneKey: Map<string, unknown>
  }
  const entry = internal.announcedProviderSessionByPaneKey.get(paneKey)
  if (typeof entry === 'string') {
    return entry
  }
  const sessionId = (entry as { sessionId?: unknown } | undefined)?.sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

const MODEL_A = 'xai/grok-4.6'
const MODEL_B = 'zai/glm-5.3'
const MODEL_C = 'openai/gpt-5.3'
const MODEL_D = 'google/gemini-3-pro'

// Why: relaunched generations report under their own launchToken while the
// pipeline runtime stays scoped to the original process; reading through the
// real selectors with real server rows keeps the generation assertions honest.
function observeAsToken(
  srv: AgentHookServer,
  paneKey: string,
  launchToken: string,
  observedAfter: number
): {
  options: WorkerObservedOptionsObservation
  sessionId: string | undefined
} {
  const sideAndStatus = [
    ...srv.getObservedOptionsSnapshot(),
    ...srv.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true)
  ]
  const statusOnly = srv.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true)
  const scope = {
    paneKey,
    processIncarnation: 'pty:incarnation',
    connectionId: null,
    launchToken,
    observedAfter
  }
  return {
    options: buildWorkerObservedOptionsObservation({
      selection: selectExactWorkerObservedOptions({ ...scope, statuses: sideAndStatus })
    }),
    sessionId: selectExactWorkerProviderSession({ ...scope, statuses: statusOnly })?.providerSession
      .id
  }
}

function assistantMessage(
  messageID: string,
  sessionID: string,
  model: string,
  text: string
): Record<string, unknown> {
  return { hook_event_name: 'MessagePart', role: 'assistant', text, messageID, sessionID, model }
}

// Why shared: every authority test opens with the same A→B(modelB) handoff;
// the defect lives in what happens after, not in the setup.
async function seedSessionsAB(pipeline: Pipeline, dispatchCreated: number): Promise<void> {
  const { postHook, observe } = pipeline
  await postHook('opencode', assistantMessage('msg-a1', 'ses-A', MODEL_A, 'session A reply'))
  await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-B' })
  await postHook('opencode', assistantMessage('msg-b1', 'ses-B', MODEL_B, 'session B reply'))
  expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
}

function seedSessionsABRemote(pipeline: Pipeline, dispatchCreated: number): void {
  const { ingestRemote, observe } = pipeline
  ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'session A reply'))
  ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
  ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'session B reply'))
  expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
}

// Why shared: the boundary-only handoff (no B options yet) opens every
// reintroduction test; the defect lives in the late arrival, not the setup.
async function seedBoundaryAB(pipeline: Pipeline, dispatchCreated: number): Promise<void> {
  const { postHook, observe } = pipeline
  await postHook('opencode', assistantMessage('msg-a1', 'ses-A', MODEL_A, 'session A reply'))
  expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
  await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-B' })
  expect(observe(dispatchCreated)).toEqual({
    origin: 'hook',
    status: 'unavailable',
    reason: 'status_without_options',
    lastReceivedAt: expect.any(Number)
  })
}

function seedBoundaryABRemote(pipeline: Pipeline, dispatchCreated: number): void {
  const { ingestRemote, observe } = pipeline
  ingestRemote(assistantMessage('msg-a1', 'ses-A', MODEL_A, 'session A reply'))
  expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
  ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
  expect(observe(dispatchCreated)).toEqual({
    origin: 'hook',
    status: 'unavailable',
    reason: 'status_without_options',
    lastReceivedAt: expect.any(Number)
  })
}

describe('observed options through the real hook-server + runtime pipeline', () => {
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function startPipeline(): Promise<Pipeline> {
    server = new AgentHookServer()
    await server.start({ env: 'production' })
    runtime = new OrcaRuntimeService(null, undefined, {
      // Why mirror main-process-runtime-service: identity-only rows must not read
      // as turn status, and the side table is the durable options evidence.
      getAgentStatusSnapshot: () =>
        server!.getStatusSnapshot().filter((entry) => entry.providerSessionOnly !== true),
      getObservedOptionsSnapshot: () => server!.getObservedOptionsSnapshot()
    })
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
      getForegroundProcess: async () => 'pi'
    })
    const terminal = await runtime.createTerminal(`id:${WORKTREE_ID}`, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      title: 'worker'
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
    const incarnation = runtime.getTerminalProcessIncarnation(terminal.handle)
    if (!paneKey || !incarnation) {
      throw new Error('Runtime did not expose the worker pane identity.')
    }
    return {
      handle: terminal.handle,
      paneKey,
      observe: (observedAfter: number) =>
        buildWorkerObservedOptionsObservation({
          selection: runtime!.getExactWorkerObservedOptions(terminal.handle, observedAfter)
        }),
      providerSession: (observedAfter: number) =>
        runtime!.getExactWorkerProviderSession(terminal.handle, observedAfter),
      postHook: async (source, payload, options = {}) => {
        const env = server!.buildPtyEnv()
        const response = await fetch(
          `http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/${source}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
            },
            body: JSON.stringify({
              paneKey,
              launchToken: options.launchToken ?? LAUNCH_TOKEN,
              tabId: paneKey.split(':')[0],
              worktreeId: WORKTREE_ID,
              env: 'production',
              payload
            })
          }
        )
        expect(response.status).toBe(204)
      },
      // Why ingestRemote (the SSH ingress) instead of HTTP: the replay clock gap
      // needs fake timers, and fetch must not run under them.
      ingestRemote: (payload, options = {}) => {
        const event = normalizeHookPayload(
          createHookListenerState(),
          'opencode',
          {
            paneKey,
            launchToken: options.launchToken ?? LAUNCH_TOKEN,
            tabId: paneKey.split(':')[0],
            worktreeId: WORKTREE_ID,
            env: 'production',
            payload
          },
          'production'
        )
        if (!event) {
          throw new Error('normalizeHookPayload rejected a known-good opencode fixture')
        }
        server!.ingestRemote({ ...event, ...(options.isReplay ? { isReplay: true } : {}) }, null)
      }
    }
  }

  it('fences session A model when /new starts session B in the same pane/process/token', async () => {
    const { observe, postHook } = await startPipeline()
    const dispatchCreated = Date.now() - 60_000

    await postHook('opencode', assistantMessage('msg-a1', 'ses-A', MODEL_A, 'session A reply'))
    // Sanity: while session A is the pane's session, its evidence is current.
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })

    await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })

    await postHook('opencode', assistantMessage('msg-b1', 'ses-B', MODEL_B, 'session B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    // Same-session option-less lifecycle must not erase the evidence.
    await postHook('opencode', { hook_event_name: 'SessionIdle', sessionID: 'ses-B' })
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
  })

  it('fences Pi evidence when a providerSessionOnly session_start announces the next session', async () => {
    const { observe, postHook } = await startPipeline()
    const dispatchCreated = Date.now() - 60_000

    await postHook('pi', {
      hook_event_name: 'before_agent_start',
      prompt: 'session A work',
      model: 'zai/glm-5.3',
      thinking_level: 'high',
      session_id: 'ses-A',
      session_file: '/tmp/orca-observed-options-pipeline/ses-A.jsonl'
    })
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'observed',
      model: 'zai/glm-5.3'
    })

    await postHook('pi', {
      hook_event_name: 'session_start',
      session_id: 'ses-B',
      session_file: '/tmp/orca-observed-options-pipeline/ses-B.jsonl'
    })
    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'no_status_row'
    })

    await postHook('pi', {
      hook_event_name: 'before_agent_start',
      prompt: 'session B work',
      model: 'xai/grok-4.6',
      session_id: 'ses-B',
      session_file: '/tmp/orca-observed-options-pipeline/ses-B.jsonl'
    })
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'observed',
      model: 'xai/grok-4.6'
    })
  })

  it('diagnoses status_without_options when the side table is empty but hooks reported', async () => {
    const { observe, postHook } = await startPipeline()
    const dispatchCreated = Date.now() - 60_000

    await postHook('opencode', { hook_event_name: 'SessionBusy', sessionID: 'ses-1' })

    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })
  })

  it('does not reintroduce session A evidence when a late A event arrives after boundary B (HTTP)', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedBoundaryAB(pipeline, dispatchCreated)

    // Late straggler: session A's in-flight turn finishing after /new started B.
    await postHook('opencode', assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))

    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })
    // Neither source the selector combines may leak the superseded session's model.
    const statusRow = server!.getStatusSnapshot().find((row) => row.paneKey === paneKey)
    expect(statusRow?.model).toBeUndefined()
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow?.model).toBeUndefined()
  })

  it('keeps session B evidence when a late session A event arrives after B was observed (HTTP)', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedSessionsAB(pipeline, dispatchCreated)

    await postHook('opencode', assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))

    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow?.model).toBe(MODEL_B)
    expect(sideRow?.providerSessionId).toBe('ses-B')
  })

  it('does not reintroduce session A evidence after boundary B over the SSH remote ingress', async () => {
    const pipeline = await startPipeline()
    const { observe, ingestRemote } = pipeline
    const dispatchCreated = Date.now() - 60_000

    seedBoundaryABRemote(pipeline, dispatchCreated)

    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))
    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })

    // The same straggler replayed after a relay reconnect stays fenced too.
    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'), {
      isReplay: true
    })
    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })
  })

  it('keeps session B evidence when a late session A event arrives over the SSH remote ingress', async () => {
    const pipeline = await startPipeline()
    const { observe, ingestRemote } = pipeline
    const dispatchCreated = Date.now() - 60_000

    seedSessionsABRemote(pipeline, dispatchCreated)

    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
  })

  it('re-admits session A evidence after an explicit session A boundary announces the resume', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedBoundaryAB(pipeline, dispatchCreated)
    await postHook('opencode', assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'unavailable',
      reason: 'status_without_options'
    })

    // Explicit return to A: the pane announces session A again (resume/--continue).
    await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-A' })
    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'session A resumed reply',
      messageID: 'msg-a3',
      sessionID: 'ses-A',
      model: 'zai/glm-5.3'
    })
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'observed',
      model: 'zai/glm-5.3'
    })
  })

  it('keeps same-session option-less lifecycle evidence surviving the fence', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedSessionsAB(pipeline, dispatchCreated)

    // Same-session lifecycle row carries the session id and must not erase evidence.
    await postHook('opencode', { hook_event_name: 'SessionIdle', sessionID: 'ses-B' })
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
  })

  it('clears the session announcement fence with pane state', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedBoundaryAB(pipeline, dispatchCreated)
    await postHook('opencode', assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'unavailable',
      reason: 'status_without_options'
    })

    // Pane teardown must drop the announcement fence: a fresh pane lifecycle
    // re-establishes evidence without needing a new session announcement.
    server!.clearPaneState(paneKey)
    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'fresh session reply',
      messageID: 'msg-c1',
      sessionID: 'ses-C',
      model: 'zai/glm-5.3'
    })
    expect(observe(dispatchCreated)).toMatchObject({
      status: 'observed',
      model: 'zai/glm-5.3'
    })
  })

  it('re-admits session A evidence after a real user-prompt resume inside one Dispatch (HTTP)', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey, providerSession } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedSessionsAB(pipeline, dispatchCreated)
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-B')

    // Real resume: OpenCode emits no SessionStart for it — the user prompt
    // MessagePart (role=user, the new turn) is the session's return signal.
    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'user',
      text: 'back on A: fix the parser instead',
      messageID: 'msg-a2-user',
      sessionID: 'ses-A'
    })
    await postHook('opencode', { hook_event_name: 'SessionBusy', sessionID: 'ses-A' })
    await postHook(
      'opencode',
      assistantMessage('msg-a3', 'ses-A', MODEL_A, 'session A resumed reply')
    )

    // All events arrived inside the same Dispatch window: the worker must read
    // the resumed session's model, not the fenced-away B evidence.
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-A')
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow).toMatchObject({ providerSessionId: 'ses-A', model: MODEL_A })

    // The resumed session stays valid for its next turn too.
    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'user',
      text: 'A follow-up',
      messageID: 'msg-a4-user',
      sessionID: 'ses-A'
    })
    await postHook('opencode', assistantMessage('msg-a5', 'ses-A', MODEL_A, 'session A again'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
  })

  it('re-admits session A evidence after a real user-prompt resume over SSH ingestRemote', async () => {
    const pipeline = await startPipeline()
    const { observe, ingestRemote, providerSession } = pipeline
    const dispatchCreated = Date.now() - 60_000

    seedSessionsABRemote(pipeline, dispatchCreated)
    ingestRemote({
      hook_event_name: 'MessagePart',
      role: 'user',
      text: 'back on A: fix the parser instead',
      messageID: 'msg-a2-user',
      sessionID: 'ses-A'
    })
    ingestRemote(assistantMessage('msg-a3', 'ses-A', MODEL_A, 'session A resumed reply'))

    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_A })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-A')
  })

  // Why one body for both ingresses: the generation scenario is ingress-agnostic;
  // HTTP and SSH differ only in how bytes arrive, never in authority semantics.
  async function runRelaunchScenario(
    pipeline: Pipeline,
    post: (payload: Record<string, unknown>, launchToken?: string) => Promise<void> | void
  ): Promise<void> {
    const { paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000
    const T2 = 'launch-pipeline-2'
    const readAsT2 = (): ReturnType<typeof observeAsToken> =>
      observeAsToken(server!, paneKey, T2, dispatchCreated)

    // Old generation T1 on the same pane.
    await post(assistantMessage('msg-a1', 'ses-A1', MODEL_A, 'A1 reply'))
    await post({ hook_event_name: 'SessionStart', sessionID: 'ses-B1' })
    await post(assistantMessage('msg-b1', 'ses-B1', MODEL_B, 'B1 reply'))

    // Legit relaunch: the new generation announces itself and reports.
    await post({ hook_event_name: 'SessionStart', sessionID: 'ses-A2' }, T2)
    await post(assistantMessage('msg-a2', 'ses-A2', MODEL_C, 'A2 reply'), T2)
    expect(readAsT2().options).toMatchObject({ status: 'observed', model: MODEL_C })

    // A second session born inside T2 observes its own model.
    await post({ hook_event_name: 'SessionStart', sessionID: 'ses-B2' }, T2)
    await post(assistantMessage('msg-b2', 'ses-B2', MODEL_D, 'B2 reply'), T2)
    expect(readAsT2().options).toMatchObject({ status: 'observed', model: MODEL_D })
    expect(readAsT2().sessionId).toBe('ses-B2')

    // Late arrival from inside T2 cannot re-assert A2 as current.
    await post(assistantMessage('msg-a2-late', 'ses-A2', MODEL_C, 'A2 late reply'), T2)
    expect(readAsT2().options).toMatchObject({ status: 'observed', model: MODEL_D })

    // A straggler from the dead T1 generation cannot clobber T2's evidence.
    await post(
      assistantMessage('msg-a1-late', 'ses-A1', MODEL_A, 'A1 late reply'),
      'launch-pipeline-1'
    )
    expect(readAsT2().options).toMatchObject({ status: 'observed', model: MODEL_D })
    expect(readAsT2().sessionId).toBe('ses-B2')
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow).toMatchObject({ providerSessionId: 'ses-B2', model: MODEL_D })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B2')
  }

  it('establishes authority in a relaunched generation and fences its late arrivals (HTTP)', async () => {
    const pipeline = await startPipeline()
    await runRelaunchScenario(pipeline, (payload, launchToken) =>
      pipeline.postHook('opencode', payload, launchToken ? { launchToken } : {})
    )
  })

  it('establishes authority in a relaunched generation and fences its late arrivals (SSH)', async () => {
    const pipeline = await startPipeline()
    await runRelaunchScenario(pipeline, (payload, launchToken) =>
      pipeline.ingestRemote(payload, launchToken ? { launchToken } : {})
    )
  })

  it('moves session authority and evidence on pane transfer (server)', async () => {
    const pipeline = await startPipeline()
    const { postHook, paneKey } = pipeline
    const target = 'tab-transfer:55555555-5555-4555-9555-555555555555'

    await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-src' })
    await postHook('opencode', assistantMessage('msg-src', 'ses-src', MODEL_A, 'source reply'))

    server!.transferPaneAuthority(paneKey, target, 'pty-transfer')

    // The transferred ownership carries its authority and evidence re-keyed…
    expect(announcedSessionId(server!, target)).toBe('ses-src')
    const targetSide = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === target)
    expect(targetSide).toMatchObject({ providerSessionId: 'ses-src', model: MODEL_A })
    // …and the detached key retains nothing that could fence later posts by alias.
    expect(announcedSessionId(server!, paneKey)).toBeUndefined()
    expect(
      server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    ).toBeUndefined()
  })

  it('does not overwrite the transfer target with unrelated evidence (server)', async () => {
    const pipeline = await startPipeline()
    const { postHook, paneKey } = pipeline
    const target = 'tab-transfer:66666666-6666-4666-a666-666666666666'
    const seedEnvelope = (
      targetPaneKey: string,
      sessionId: string,
      model: string | undefined
    ): void => {
      server!.ingestRemote(
        {
          paneKey: targetPaneKey,
          source: 'opencode',
          hookEventName: model ? 'MessagePart' : 'SessionStart',
          launchToken: LAUNCH_TOKEN,
          providerSession: { key: 'session_id', id: sessionId },
          payload: model
            ? { state: 'working', prompt: '', agentType: 'opencode', model }
            : { state: 'done', prompt: '', agentType: 'opencode' }
        },
        null
      )
    }

    await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-src' })
    await postHook('opencode', assistantMessage('msg-src', 'ses-src', MODEL_A, 'source reply'))
    seedEnvelope(target, 'ses-tgt', undefined)
    seedEnvelope(target, 'ses-tgt', MODEL_B)

    server!.transferPaneAuthority(paneKey, target, 'pty-transfer')

    // Ownership moves, but rows from other panes are never merged or clobbered.
    expect(announcedSessionId(server!, target)).toBe('ses-src')
    const unrelated = server!
      .getObservedOptionsSnapshot()
      .filter((row) => row.paneKey !== paneKey && row.paneKey !== target)
    expect(unrelated).toEqual([])
    expect(announcedSessionId(server!, paneKey)).toBeUndefined()
  })

  it('keeps the live B row untouched when a late A straggler lands (HTTP)', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey, providerSession } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedSessionsAB(pipeline, dispatchCreated)
    await postHook('opencode', assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))

    // Options evidence stays B…
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    // …and the straggler must not land at all: relabeling its content with the
    // live session would mix A's prompt/model into B's row. The pane keeps B's
    // full row — session, options and content coherent.
    const statusRow = server!.getStatusSnapshot().find((row) => row.paneKey === paneKey)
    expect(statusRow).toMatchObject({
      providerSession: { key: 'session_id', id: 'ses-B' },
      model: MODEL_B,
      state: 'working'
    })
    expect(providerSession(dispatchCreated)?.providerSession.id).toBe('ses-B')
  })

  it('does not move session authority on a replayed SessionStart (SSH ingestRemote)', async () => {
    const pipeline = await startPipeline()
    const { observe, ingestRemote, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    seedSessionsABRemote(pipeline, dispatchCreated)

    // A reconnect replay restates the old A announcement; authority stays B.
    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-A' }, { isReplay: true })
    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))

    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
  })

  it('does not let a new launchToken inherit the previous fence (SSH ingestRemote)', async () => {
    const pipeline = await startPipeline()
    const { ingestRemote, paneKey } = pipeline
    const NEW_LAUNCH_TOKEN = 'launch-pipeline-2'

    seedSessionsABRemote(pipeline, Date.now() - 60_000)

    // A new process generation announces and reports in the same pane: its
    // evidence must not be fenced by the previous generation's authority…
    ingestRemote(
      { hook_event_name: 'SessionStart', sessionID: 'ses-C' },
      { launchToken: NEW_LAUNCH_TOKEN }
    )
    ingestRemote(assistantMessage('msg-c1', 'ses-C', 'openai/gpt-5.3', 'session C reply'), {
      launchToken: NEW_LAUNCH_TOKEN
    })
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow).toMatchObject({ providerSessionId: 'ses-C', model: 'openai/gpt-5.3' })

    // …and the new generation's birth establishes the live authority.
    expect(announcedSessionId(server!, paneKey)).toBe('ses-C')
  })

  it('keeps fenced evidence after the announcement watermark is evicted (SSH ingestRemote)', async () => {
    const pipeline = await startPipeline()
    const { observe, ingestRemote, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000
    const syntheticPaneKey = (index: number): string => {
      const hex = index.toString(16).padStart(12, '0')
      return `tab-evicted:${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(0, 3)}-a${hex.slice(0, 3)}-${hex}`
    }

    ingestRemote({ hook_event_name: 'SessionStart', sessionID: 'ses-B' })
    ingestRemote(assistantMessage('msg-b1', 'ses-B', MODEL_B, 'session B reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })

    // Evict this pane's announcement with 1024 announcements for other panes.
    for (let index = 1; index <= 1024; index += 1) {
      server!.ingestRemote(
        {
          paneKey: syntheticPaneKey(index),
          source: 'opencode',
          hookEventName: 'SessionStart',
          launchToken: LAUNCH_TOKEN,
          providerSession: { key: 'session_id', id: `ses-${index}` },
          payload: { state: 'done', prompt: '', agentType: 'opencode' }
        },
        null
      )
    }
    const internal = server as unknown as {
      announcedProviderSessionByPaneKey: Map<string, { sessionId: string }>
    }
    expect(internal.announcedProviderSessionByPaneKey.has(paneKey)).toBe(false)

    // Losing the watermark must fail safe: the stored B row is the fallback
    // authority, so a late A straggler still cannot re-assert A as current.
    ingestRemote(assistantMessage('msg-a2', 'ses-A', MODEL_A, 'session A late reply'))
    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    const sideRow = server!.getObservedOptionsSnapshot().find((row) => row.paneKey === paneKey)
    expect(sideRow).toMatchObject({ providerSessionId: 'ses-B', model: MODEL_B })
    // The straggler never lands: the pane keeps B's full row, options included.
    const statusRow = server!.getStatusSnapshot().find((row) => row.paneKey === paneKey)
    expect(statusRow).toMatchObject({
      providerSession: { key: 'session_id', id: 'ses-B' },
      model: MODEL_B
    })
  })

  it('does not move session authority on a disposition-rejected announcement (HTTP)', async () => {
    const pipeline = await startPipeline()
    const { observe, postHook, paneKey } = pipeline
    const dispatchCreated = Date.now() - 60_000

    await seedSessionsAB(pipeline, dispatchCreated)

    // The tab closes: the next announcement is disposition-rejected and must
    // not move the pane's session authority.
    server!.dropStatusEntriesByTabPrefix(paneKey.split(':')[0]!)
    await postHook('opencode', { hook_event_name: 'SessionStart', sessionID: 'ses-C' })

    expect(observe(dispatchCreated)).toMatchObject({ status: 'observed', model: MODEL_B })
    expect(announcedSessionId(server!, paneKey)).toBe('ses-B')
  })

  it('bounds the session announcement watermark like the observed-options side table', async () => {
    const syntheticPaneKey = (index: number): string => {
      const hex = index.toString(16).padStart(12, '0')
      return `tab-bound:${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(0, 3)}-a${hex.slice(0, 3)}-${hex}`
    }
    const announce = (paneKey: string, sessionId: string): void => {
      server!.ingestRemote(
        {
          paneKey,
          source: 'opencode',
          hookEventName: 'SessionStart',
          launchToken: LAUNCH_TOKEN,
          providerSession: { key: 'session_id', id: sessionId },
          payload: { state: 'done', prompt: '', agentType: 'opencode' }
        },
        null
      )
    }

    await startPipeline()
    const firstPane = syntheticPaneKey(0)
    announce(firstPane, 'ses-B')

    // Evict the first pane's announcement with MAX_REMEMBERED_OBSERVED_OPTIONS
    // announcements for other panes (LRU bound shared with the side table).
    for (let index = 1; index <= 1024; index += 1) {
      announce(syntheticPaneKey(index), `ses-${index}`)
    }

    const internal = server as unknown as {
      announcedProviderSessionByPaneKey: Map<string, string>
    }
    expect(internal.announcedProviderSessionByPaneKey.size).toBe(1024)
    expect(internal.announcedProviderSessionByPaneKey.has(firstPane)).toBe(false)
  })

  it('does not present replayed evidence older than the Dispatch as current', async () => {
    const { observe, ingestRemote } = await startPipeline()
    const evidenceAt = Date.now() - 10 * 60 * 1000
    const dispatchCreated = evidenceAt + 60_000
    vi.useFakeTimers()
    vi.setSystemTime(evidenceAt)
    ingestRemote({
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'old reply',
      messageID: 'msg-old',
      sessionID: 'ses-old',
      model: 'xai/grok-4.6'
    })
    // Why a relay replay: it restamps receivedAt to clear the connection
    // watermark while the evidence clock must stay at the original observation.
    vi.setSystemTime(evidenceAt + 5 * 60 * 1000)
    ingestRemote(
      {
        hook_event_name: 'MessagePart',
        role: 'assistant',
        text: 'old reply',
        messageID: 'msg-old',
        sessionID: 'ses-old',
        model: 'xai/grok-4.6'
      },
      { isReplay: true }
    )
    vi.useRealTimers()

    expect(observe(dispatchCreated)).toEqual({
      origin: 'hook',
      status: 'unavailable',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })
  })
})
