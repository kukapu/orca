/**
 * Observed-option evidence rides OpenCode assistant messages only: the
 * user message's model is a client selection, not execution confirmation,
 * and compaction summaries run on a different model than the worker's.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

import { _internals } from './hook-service'

type SessionFixture = { id: string; parentID?: string }
type PluginEvent = { type: string; properties?: Record<string, unknown> }
type PluginEventHandler = (input: { event: PluginEvent }) => Promise<void>
type PluginHooks = { event: PluginEventHandler; dispose?: () => Promise<void> }
type RecordedPost = {
  hook_event_name: string
  sessionID?: string
  role?: string
  model?: string
  variant?: string
}

const ENV_KEYS = [
  'ORCA_PANE_KEY',
  'ORCA_AGENT_HOOK_PORT',
  'ORCA_AGENT_HOOK_TOKEN',
  'ORCA_AGENT_HOOK_ENDPOINT'
] as const

describe('OpenCode plugin observed-option evidence', () => {
  let tempDir: string
  let posts: RecordedPost[]
  let savedEnv: Record<string, string | undefined>
  let savedFetch: typeof globalThis.fetch

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-opencode-observed-plugin-'))
    posts = []
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    process.env.ORCA_PANE_KEY = 'tab-1:leaf-1'
    process.env.ORCA_AGENT_HOOK_PORT = '45678'
    process.env.ORCA_AGENT_HOOK_TOKEN = 'test-token'
    delete process.env.ORCA_AGENT_HOOK_ENDPOINT
    savedFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      posts.push(readPayload(init))
      return new Response(null, { status: 204 })
    }) as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = savedFetch
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  function readPayload(init?: RequestInit): RecordedPost {
    return JSON.parse(String(init?.body)).payload as RecordedPost
  }

  async function loadHooks(sessions: SessionFixture[] = [{ id: 'root' }]): Promise<PluginHooks> {
    const pluginPath = join(tempDir, 'orca-opencode-status.mjs')
    writeFileSync(pluginPath, _internals.getOpenCodePluginSource())
    const module = (await import(pathToFileURL(pluginPath).href)) as {
      OrcaOpenCodeStatusPlugin: (ctx: unknown) => Promise<PluginHooks>
    }
    const client = {
      session: {
        list: async () => ({ data: sessions }),
        get: async (args: { path?: { id?: string }; sessionID?: string }) => {
          const id = args?.path?.id ?? args?.sessionID
          const session = sessions.find((entry) => entry.id === id)
          return { data: session ?? null }
        }
      }
    }
    return module.OrcaOpenCodeStatusPlugin({ client })
  }

  function messageUpdated(info: Record<string, unknown>, sessionID = 'root'): PluginEvent {
    return { type: 'message.updated', properties: { sessionID, info } }
  }

  function assistantTextPart(messageID: string, text: string): PluginEvent {
    return {
      type: 'message.part.updated',
      properties: { sessionID: 'root', part: { type: 'text', text, messageID } }
    }
  }

  it('attaches the executed assistant model and variant to assistant MessagePart posts', async () => {
    const hooks = await loadHooks()
    await hooks.event({
      event: messageUpdated({
        id: 'msg-user',
        role: 'user',
        model: { providerID: 'zai', modelID: 'glm-5.3' }
      })
    })
    await hooks.event({
      event: messageUpdated({
        id: 'msg-assistant',
        role: 'assistant',
        providerID: 'xai',
        modelID: 'grok-4.6',
        variant: 'code'
      })
    })
    await hooks.event({ event: assistantTextPart('msg-assistant', 'here is the edit') })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'root' } } })

    const assistantPart = posts.find(
      (post) => post.hook_event_name === 'MessagePart' && post.role === 'assistant'
    )
    expect(assistantPart).toMatchObject({ model: 'xai/grok-4.6', variant: 'code' })
  })

  it('does not publish the user message model as execution evidence', async () => {
    const hooks = await loadHooks()
    await hooks.event({
      event: messageUpdated({
        id: 'msg-user',
        role: 'user',
        model: { providerID: 'zai', modelID: 'glm-5.3', variant: 'fast' }
      })
    })
    await hooks.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'root',
          part: { type: 'text', text: 'the prompt', messageID: 'msg-user' }
        }
      }
    })

    const userPart = posts.find(
      (post) => post.hook_event_name === 'MessagePart' && post.role === 'user'
    )
    expect(userPart).toBeDefined()
    expect(userPart).not.toHaveProperty('model')
    expect(userPart).not.toHaveProperty('variant')
  })

  it('never contaminates the pane model with compaction-summary models', async () => {
    const hooks = await loadHooks()
    // Why: the real-world case — a Grok worker whose compaction ran on gpt-5.6-luna.
    await hooks.event({
      event: messageUpdated({
        id: 'msg-worker',
        role: 'assistant',
        providerID: 'xai',
        modelID: 'grok-4.6'
      })
    })
    await hooks.event({
      event: messageUpdated({
        id: 'msg-summary',
        role: 'assistant',
        providerID: 'openai-codex',
        modelID: 'gpt-5.6-luna',
        summary: true
      })
    })
    await hooks.event({ event: assistantTextPart('msg-summary', 'compaction summary text') })
    await hooks.event({ event: assistantTextPart('msg-worker', 'actual worker reply') })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'root' } } })

    const summaryPart = posts.find(
      (post) => post.role === 'assistant' && post.model === 'openai-codex/gpt-5.6-luna'
    )
    expect(summaryPart).toBeUndefined()
    const workerParts = posts.filter((post) => post.role === 'assistant' && post.model)
    expect(workerParts).toHaveLength(1)
    expect(workerParts[0]).toMatchObject({ model: 'xai/grok-4.6' })
  })

  it('never publishes a child-session assistant model as execution evidence', async () => {
    // Why: sub-agent/compaction sessions run other models; only the root session's
    // own assistant messages may carry the pane's observed options. The factory
    // remembers options before the child gate, so the gate must keep them unheard.
    const hooks = await loadHooks([{ id: 'root' }, { id: 'child-1', parentID: 'root' }])
    await hooks.event({
      event: messageUpdated(
        {
          id: 'msg-child',
          role: 'assistant',
          providerID: 'openai-codex',
          modelID: 'gpt-5.6-luna'
        },
        'child-1'
      )
    })
    await hooks.event({
      event: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'child-1',
          part: { type: 'text', text: 'child reply', messageID: 'msg-child' }
        }
      }
    })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'child-1' } } })

    expect(posts.filter((post) => post.sessionID === 'child-1')).toHaveLength(0)
    expect(posts.find((post) => post.model === 'openai-codex/gpt-5.6-luna')).toBeUndefined()
  })

  it('keeps the newest assistant model when the model changes between turns', async () => {
    const hooks = await loadHooks()
    await hooks.event({
      event: messageUpdated({
        id: 'msg-a1',
        role: 'assistant',
        providerID: 'zai',
        modelID: 'glm-5.3'
      })
    })
    await hooks.event({ event: assistantTextPart('msg-a1', 'first reply') })
    await hooks.event({
      event: messageUpdated({
        id: 'msg-a2',
        role: 'assistant',
        providerID: 'xai',
        modelID: 'grok-4.6'
      })
    })
    await hooks.event({ event: assistantTextPart('msg-a2', 'second reply') })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'root' } } })

    const assistantParts = posts.filter(
      (post) => post.hook_event_name === 'MessagePart' && post.role === 'assistant'
    )
    const withModels = assistantParts.filter((post) => post.model)
    expect(withModels.map((post) => post.model)).toEqual(['zai/glm-5.3', 'xai/grok-4.6'])
  })

  it('omits model fields when an older OpenCode posts assistant messages without ids', async () => {
    const hooks = await loadHooks()
    await hooks.event({
      event: messageUpdated({ id: 'msg-legacy', role: 'assistant' })
    })
    await hooks.event({ event: assistantTextPart('msg-legacy', 'legacy reply') })
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'root' } } })

    const assistantPart = posts.find(
      (post) => post.hook_event_name === 'MessagePart' && post.role === 'assistant'
    )
    expect(assistantPart).toBeDefined()
    expect(assistantPart).not.toHaveProperty('model')
  })
})
