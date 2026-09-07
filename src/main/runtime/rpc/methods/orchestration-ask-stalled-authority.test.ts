import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { AGENT_PROMPT_STALLED_ERROR } from '../../agent-prompt-submission-verification'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'

const WORKER = 'term_worker'
const PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCARNATION = 'runtime_test:term_worker:1'

describe('orchestration.ask after an unobserved prompt stall', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let activeRunId: string | undefined

  afterEach(() => h.cleanup())

  function setupWorker(): { dispatchId: string; capability: string } {
    ;({ db, runtime, ctx, activeRunId } = h.setup())
    const task = db.createTask({ spec: 'stalled ask', runId: activeRunId })
    const started = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: task.id,
      startOptions: {}
    })
    const capability = db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: WORKER,
      paneKey: PANE,
      processIncarnation: INCARNATION,
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [{ kind: 'terminal', action: 'created', id: WORKER }]
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === WORKER ? PANE : h.coordinatorPaneKey
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
      handle === WORKER ? INCARNATION : `runtime_test:${handle}:1`
    )
    vi.spyOn(runtime, 'waitForMessage').mockResolvedValue('timed_out')
    return { dispatchId: started.dispatch.id, capability }
  }

  async function ask(
    params: Record<string, unknown>,
    capability?: string,
    callCtx: RpcContext = ctx
  ) {
    return h.call(
      'orchestration.ask',
      { from: WORKER, timeoutMs: 1, ...params },
      capability ? { ...callCtx, orchestrationCapability: capability } : callCtx
    )
  }

  it('accepts ask and resume with the retained capability after stall', async () => {
    const { dispatchId, capability } = setupWorker()
    db.failWorkerStart(dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })

    const first = (await ask({ question: 'ready?' }, capability)) as {
      messageId: string
      timedOut: boolean
    }
    expect(first.timedOut).toBe(true)
    expect(db.getQuestion(first.messageId)).toMatchObject({
      dispatch_id: dispatchId,
      status: 'pending'
    })

    const resumed = (await ask({ resume: first.messageId }, capability)) as {
      messageId: string
      timedOut: boolean
    }
    expect(resumed.messageId).toBe(first.messageId)
    expect(db.getInbox(100).filter((message) => message.type === 'question')).toHaveLength(1)
  })

  it('rejects foreign caller, invalid token, and a different incarnation', async () => {
    const { dispatchId, capability } = setupWorker()
    db.failWorkerStart(dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })

    await expect(
      ask({ from: 'term_other', question: 'foreign same run' }, capability)
    ).rejects.toMatchObject({ code: 'dispatch_inactive' })

    await expect(ask({ question: 'bad token' }, 'dcap_not-the-token')).rejects.toMatchObject({
      code: 'dispatch_capability_invalid'
    })

    vi.mocked(runtime.getTerminalProcessIncarnation).mockImplementation((handle) =>
      handle === WORKER ? 'runtime_test:term_worker:2' : `runtime_test:${handle}:1`
    )
    await expect(ask({ question: 'old process' }, capability)).rejects.toMatchObject({
      code: 'dispatch_capability_invalid'
    })
    expect(db.getInbox(100).filter((message) => message.type === 'question')).toHaveLength(0)
  })
})
