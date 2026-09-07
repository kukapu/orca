// Full-route check: observed options must survive HTTP ingest → normalization →
// cached snapshot — the exact rows worker-show's exact selector reads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { buildBody, PANE } from './server.test-fixtures'
import { selectExactWorkerObservedOptions } from '../runtime/orchestration/worker-observed-options'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

describe('observed options survive the hook route into the exact-worker snapshot', () => {
  let server: AgentHookServer | undefined

  beforeEach(() => {
    _internals.resetCachesForTests()
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await server?.stop()
    server = undefined
    vi.restoreAllMocks()
  })

  async function postHook(source: string, payload: Record<string, unknown>): Promise<Response> {
    const env = server!.buildPtyEnv()
    return fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/hook/${source}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN
      },
      body: JSON.stringify(buildBody(payload))
    })
  }

  it('keeps Pi model/thinking evidence from loopback POST to worker-show selection', async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })

    const response = await postHook('pi', {
      hook_event_name: 'before_agent_start',
      prompt: 'fix the parser',
      model: 'zai/glm-5.3',
      thinking_level: 'xhigh'
    })
    expect(response.status).toBe(204)

    const snapshot = server.getStatusSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]).toMatchObject({
      paneKey: PANE,
      model: 'zai/glm-5.3',
      thinkingLevel: 'xhigh',
      agentType: 'pi'
    })
    // Origin/timestamp facet: the ingress stamped hook provenance on the row.
    expect(snapshot[0].observation?.origin).toBe('hook')
    expect(snapshot[0].observation?.observedAt).toEqual(expect.any(Number))

    const selection = selectExactWorkerObservedOptions({
      paneKey: PANE,
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: snapshot
    })
    expect(selection).toEqual({
      kind: 'observed',
      evidence: {
        origin: 'hook',
        agent: 'pi',
        model: 'zai/glm-5.3',
        thinkingLevel: 'xhigh',
        observedAt: expect.any(Number)
      }
    })
  })

  it('keeps OpenCode assistant model/variant evidence through the same route', async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })

    const response = await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'here is the edit',
      messageID: 'msg-1',
      sessionID: 'ses-1',
      model: 'xai/grok-4.6',
      variant: 'code'
    })
    expect(response.status).toBe(204)

    const snapshot = server.getStatusSnapshot()
    expect(snapshot[0]).toMatchObject({
      paneKey: PANE,
      model: 'xai/grok-4.6',
      variant: 'code',
      agentType: 'opencode'
    })
  })

  it('degrades to explicit rows_without_options when no event ever carried options', async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })

    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'reply',
      messageID: 'msg-1',
      sessionID: 'ses-1'
    })

    const snapshot = server.getStatusSnapshot()
    expect(snapshot[0].model).toBeUndefined()
    const selection = selectExactWorkerObservedOptions({
      paneKey: PANE,
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: snapshot
    })
    expect(selection?.kind).toBe('rows_without_options')
  })

  it('keeps side-table evidence after an option-less lifecycle row replaces the status', async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })

    await postHook('opencode', {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      text: 'reply',
      messageID: 'msg-1',
      sessionID: 'ses-1',
      model: 'xai/grok-4.6'
    })
    await postHook('opencode', { hook_event_name: 'SessionIdle' })

    // The mutable last-status row no longer carries the model…
    expect(server.getStatusSnapshot()[0].model).toBeUndefined()
    // …but the observed-options side table still holds it for exact-worker reads.
    const sideRows = server.getObservedOptionsSnapshot()
    expect(sideRows).toHaveLength(1)
    expect(sideRows[0]).toMatchObject({
      paneKey: PANE,
      model: 'xai/grok-4.6',
      agentType: 'opencode',
      origin: 'hook',
      // Why: the runtime selector reads the evidence clock from evidenceObservedAt;
      // observedAt here would silently fall back to the delivery clock there.
      evidenceObservedAt: expect.any(Number),
      providerSessionId: 'ses-1'
    })
    const selection = selectExactWorkerObservedOptions({
      paneKey: PANE,
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: sideRows
    })
    expect(selection).toEqual({
      kind: 'observed',
      evidence: {
        origin: 'hook',
        agent: 'opencode',
        model: 'xai/grok-4.6',
        observedAt: expect.any(Number)
      }
    })
  })
})
