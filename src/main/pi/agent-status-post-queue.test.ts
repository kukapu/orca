import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { PANE_KEY } from '../../shared/agent-hook-listener-test-harness'
import { createHookListenerState } from '../../shared/agent-hook-listener/listener-state'
import { createAgentStatusExtensionHarness as createHarness } from './agent-status-extension-test-harness'

const RUNTIMES = [
  { kind: 'pi' as const },
  { kind: 'prime-agent' as const },
  { kind: 'omp' as const },
  { kind: 'pi' as const, title: 'omp' },
  { kind: 'pi' as const, argv: ['node', '/usr/local/bin/omp'] }
]

function session(id: string, persisted = true) {
  return {
    sessionManager: {
      getSessionId: () => id,
      getSessionFile: () => (persisted ? `/sessions/${id}.jsonl` : undefined)
    }
  }
}

function stalledHarness(args: Parameters<typeof createHarness>[0]) {
  vi.useFakeTimers()
  let release = () => {}
  const harness = createHarness({
    ...args,
    env: { ORCA_PANE_KEY: PANE_KEY, ORCA_AGENT_HOOK_VERSION: '1' },
    existsSync: () => true,
    fetchImpl: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true })
          })
      )
      .mockResolvedValue({ ok: true })
  })
  return {
    ...harness,
    payloads: () =>
      harness.fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).payload),
    async drain() {
      release()
      await vi.advanceTimersByTimeAsync(0)
    },
    normalized() {
      const state = createHookListenerState()
      return harness.fetchMock.mock.calls.map(([url, init]) => {
        const kind = String(url).split('/').at(-1) as 'pi' | 'omp' | 'prime-agent'
        return normalizeHookPayload(state, kind, JSON.parse(String(init?.body)), 'env-1')
      })
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('Pi family bounded hook queue', () => {
  it.each(RUNTIMES)('preserves prompt and final answer through congestion: %j', async (args) => {
    const harness = stalledHarness(args)
    const ctx = session('one')
    await harness.callHook('session_start', {}, ctx)
    await harness.callHook('agent_start', {}, ctx)
    await harness.callHook('before_agent_start', { prompt: 'implement this task' }, ctx)
    await harness.callHook('tool_call', { toolName: 'read', input: { path: 'old.ts' } }, ctx)
    await harness.callHook('message_end', { message: { role: 'assistant', content: 'draft' } }, ctx)
    await harness.callHook(
      'message_end',
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'private' },
            { type: 'text', text: 'final ' },
            { type: 'text', text: 'answer' }
          ]
        }
      },
      ctx
    )
    await harness.callHook('agent_end', {}, ctx)
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    await harness.drain()

    expect(
      harness
        .payloads()
        .slice(-3)
        .map((payload) => payload.hook_event_name)
    ).toEqual(['before_agent_start', 'message_end', 'agent_end'])
    expect(harness.normalized().at(-1)?.payload).toMatchObject({
      state: 'done',
      prompt: 'implement this task',
      lastAssistantMessage: 'final answer'
    })
    expect(harness.payloads().at(-1)).not.toHaveProperty('tool_input')
    expect(harness.payloads().at(-1)).not.toHaveProperty('text')
    expect(harness.normalized().at(-1)?.payload.toolInput).toBeUndefined()
  })

  it.each(['pi', 'prime-agent'] as const)(
    'binds queued %s metadata before a silent reload',
    async (kind) => {
      const harness = stalledHarness({ kind })
      await harness.callHook('session_start', {}, session('one'))
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: 'answer one' } },
        session('one')
      )
      await harness.callHook('session_start', { reason: 'reload' }, session('two'))
      await harness.drain()
      expect(harness.payloads().at(-1)).toEqual({
        hook_event_name: 'message_end',
        role: 'assistant',
        text: 'answer one',
        session_id: 'one',
        session_file: '/sessions/one.jsonl'
      })
    }
  )

  it.each(RUNTIMES)('keeps consecutive turns and sessions separate: %j', async (args) => {
    const harness = stalledHarness(args)
    await harness.callHook('agent_start', {}, session('one'))
    for (const [id, prompt, text] of [
      ['one', 'first task', 'first answer'],
      ['one', 'second task', ''],
      ['two', 'third task', 'third answer']
    ]) {
      const ctx = session(id)
      await harness.callHook('before_agent_start', { prompt }, ctx)
      await harness.callHook('agent_start', {}, ctx)
      if (text) {
        await harness.callHook(
          'message_end',
          { message: { role: 'assistant', content: text } },
          ctx
        )
      }
      await harness.callHook('agent_end', {}, ctx)
    }
    await harness.drain()
    const done = harness.normalized().filter((event) => event?.payload.state === 'done')
    expect(
      done.map((event) => [event?.payload.prompt, event?.payload.lastAssistantMessage])
    ).toEqual([
      ['first task', 'first answer'],
      ['second task', undefined],
      ['third task', 'third answer']
    ])
    expect(
      harness
        .payloads()
        .filter((payload) => payload.hook_event_name === 'message_end')
        .map((payload) => [payload.session_id, payload.text])
    ).toEqual([
      ['one', 'first answer'],
      ['two', 'third answer']
    ])
  })

  it.each(['pi', 'prime-agent'] as const)(
    'cancels an old %s idle check at a session boundary',
    async (kind) => {
      const harness = stalledHarness({ kind })
      await harness.callHook('session_start', {}, session('one'))
      await harness.callHook('agent_end', {}, { ...session('one'), isIdle: () => true })
      await harness.callHook('session_start', {}, session('two'))
      await harness.drain()
      expect(harness.payloads().map((payload) => payload.hook_event_name)).toEqual([
        'session_start',
        'session_start'
      ])
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(RUNTIMES)(
    'preserves completion when agent_start precedes the next prompt: %j',
    async (args) => {
      const harness = stalledHarness(args)
      const ctx = session('one')
      await harness.callHook('agent_start', {}, ctx)
      await harness.callHook('before_agent_start', { prompt: 'first' }, ctx)
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: 'answer' } },
        ctx
      )
      await harness.callHook('agent_end', {}, ctx)
      await harness.callHook('agent_start', {}, ctx)
      await harness.callHook('before_agent_start', { prompt: 'second' }, ctx)
      await harness.callHook('agent_end', {}, ctx)
      await harness.drain()
      expect(
        harness
          .normalized()
          .filter((event) => event?.payload.state === 'done')
          .map((event) => [event?.payload.prompt, event?.payload.lastAssistantMessage])
      ).toEqual([
        ['first', 'answer'],
        ['second', undefined]
      ])
    }
  )

  it.each(RUNTIMES)('bounds a stalled burst without losing its final answer: %j', async (args) => {
    const harness = stalledHarness(args)
    const ctx = session('one')
    await harness.callHook('agent_start', {}, ctx)
    await harness.callHook('before_agent_start', { prompt: 'task' }, ctx)
    for (let i = 0; i < 2_000; i += 1) {
      await harness.callHook('tool_call', { toolName: 'read', input: { path: `old-${i}.ts` } }, ctx)
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: `answer ${i}` } },
        ctx
      )
    }
    await harness.callHook('tool_execution_end', { toolName: 'bash' }, ctx)
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    await harness.drain()
    expect(harness.payloads()).toHaveLength(4)
    expect(harness.payloads().at(-1)).toMatchObject({
      hook_event_name: 'tool_execution_end',
      tool_name: 'bash'
    })
    expect(harness.payloads().at(-1)).not.toHaveProperty('tool_input')
    expect(harness.normalized().at(-1)?.payload).toMatchObject({
      prompt: 'task',
      lastAssistantMessage: 'answer 1999'
    })
  })

  it('evicts entire oldest groups under sustained multi-turn overload', async () => {
    const harness = stalledHarness({ kind: 'pi' })
    await harness.callHook('agent_start')
    for (let i = 0; i < 100; i += 1) {
      await harness.callHook('before_agent_start', { prompt: `task ${i}` })
      await harness.callHook('message_end', {
        message: { role: 'assistant', content: `answer ${i}` }
      })
      await harness.callHook('agent_end')
    }
    await harness.drain()
    expect(harness.payloads()).toHaveLength(1 + 8 * 3)
    expect(
      harness
        .normalized()
        .filter((event) => event?.payload.state === 'done')
        .map((event) => [event?.payload.prompt, event?.payload.lastAssistantMessage])
    ).toEqual(Array.from({ length: 8 }, (_, i) => [`task ${92 + i}`, `answer ${92 + i}`]))
  })

  it('drains prompt, text and completion after the active request times out', async () => {
    const harness = stalledHarness({ kind: 'pi' })
    await harness.callHook('agent_start')
    await harness.callHook('before_agent_start', { prompt: 'task' })
    await harness.callHook('message_end', { message: { role: 'assistant', content: 'answer' } })
    await harness.callHook('agent_end')
    const signal = harness.fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal.aborted).toBe(true)
    expect(harness.normalized().at(-1)?.payload).toMatchObject({
      state: 'done',
      prompt: 'task',
      lastAssistantMessage: 'answer'
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pi', 'prime-agent'] as const)(
    'retains the %s session reset before new activity',
    async (kind) => {
      const harness = stalledHarness({ kind })
      await harness.callHook('before_agent_start', { prompt: 'old task' }, session('one'))
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: 'old answer' } },
        session('one')
      )
      await harness.callHook('session_start', {}, session('two'))
      await harness.callHook('agent_start', {}, session('two'))
      await harness.drain()
      expect(harness.payloads().map((payload) => payload.hook_event_name)).toEqual([
        'before_agent_start',
        'message_end',
        'session_start',
        'agent_start'
      ])
      expect(harness.normalized().at(-1)?.payload.prompt).toBe('')
      expect(harness.normalized().at(-1)?.payload.lastAssistantMessage).toBeUndefined()
    }
  )

  it.each(RUNTIMES)('does not combine ephemeral session messages: %j', async (args) => {
    const harness = stalledHarness(args)
    await harness.callHook('agent_start', {}, session('one', false))
    await harness.callHook(
      'message_end',
      { message: { role: 'assistant', content: 'one' } },
      session('one', false)
    )
    await harness.callHook(
      'message_end',
      { message: { role: 'assistant', content: 'two' } },
      session('two', false)
    )
    await harness.drain()
    expect(harness.payloads().slice(1)).toEqual([
      { hook_event_name: 'message_end', role: 'assistant', text: 'one' },
      { hook_event_name: 'message_end', role: 'assistant', text: 'two' }
    ])
  })

  it('rechecks the captured Pi path, not the current session path, when draining', async () => {
    const harness = stalledHarness({ kind: 'pi' })
    harness.fsMock.existsSync.mockReturnValue(false)
    await harness.callHook('session_start', {}, session('one'))
    await harness.callHook(
      'message_end',
      { message: { role: 'assistant', content: 'one' } },
      session('one')
    )
    await harness.callHook('session_start', { reason: 'reload' }, session('two'))
    harness.fsMock.existsSync.mockImplementation((path) => path === '/sessions/one.jsonl')
    await harness.drain()
    expect(harness.payloads().at(-1)).toMatchObject({
      session_id: 'one',
      session_file: '/sessions/one.jsonl'
    })
  })
})
