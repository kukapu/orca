import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationDb } from '../../../../orchestration/db'
import { ORCHESTRATION_METHODS } from '../../orchestration'

const WORKER_PANE_KEY = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// A worker whose prompt delivery was never observed may still be executing it:
// task failure is not process exit, so worker-stop must still be able to reach
// the terminal. Every other `failed` record keeps its already-settled no-op.
describe('worker-stop from a failed unobserved-prompt worker', () => {
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(WORKER_PANE_KEY)
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('runtime:pty:1')
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      handle: 'term_worker',
      worktreeId: 'repo::worktree',
      connected: true,
      status: 'running'
    } as never)
    vi.spyOn(runtime, 'getTerminalLivenessVerdict').mockReturnValue({
      status: 'live',
      ptyIds: ['runtime:pty:1']
    })
    vi.spyOn(runtime, 'closeTerminal').mockResolvedValue({
      handle: 'term_worker',
      tabId: 'tab_worker',
      ptyKilled: true
    } as never)
  })

  afterEach(() => db.close())

  async function call(name: string, params: Record<string, unknown>) {
    const method = ORCHESTRATION_METHODS.find((candidate) => candidate.name === name)
    if (!method) {
      throw new Error(`Method not found: ${name}`)
    }
    return method.handler(method.params!.parse(params), { runtime })
  }

  function createStalledWorker() {
    const run = db.createRun({
      objective: 'Stop stalled worker',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = db.createTask({ spec: 'possibly still running', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: task.id,
      startOptions: {},
      runtimeEpoch: runtime.getRuntimeId()
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_worker',
      paneKey: WORKER_PANE_KEY,
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }],
      terminalOwnership: 'created'
    })
    db.failWorkerStart(started.dispatch.id, 'dispatch_input', 'agent_prompt_stalled', {
      retainCapability: true
    })
    return { task, dispatch: started.dispatch }
  }

  it('stops the possibly-live worker instead of answering already-settled', async () => {
    const { task, dispatch } = createStalledWorker()

    const stopped = (await call('orchestration.workerStop', { dispatch: dispatch.id })) as {
      state: string
      alreadySettled: boolean
      processAction: string
    }

    expect(stopped).toMatchObject({
      state: 'stopped',
      alreadySettled: false,
      processAction: 'closed_agent_terminal'
    })
    expect(runtime.closeTerminal).toHaveBeenCalledWith('term_worker')
    expect(db.getWorkerDispatch(dispatch.id)).toMatchObject({
      state: 'stopped',
      stage: 'process_stopped'
    })
    // The unobserved-prompt cause is first-hand evidence and survives the stop.
    expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
      status: 'failed',
      last_failure: 'agent_prompt_stalled',
      capability_revoked_at: expect.any(String)
    })
    expect(db.getTask(task.id)?.status).toBe('failed')
  })

  it('keeps the stop idempotent once the stalled worker is stopped', async () => {
    const { dispatch } = createStalledWorker()
    await call('orchestration.workerStop', { dispatch: dispatch.id })

    const retry = (await call('orchestration.workerStop', { dispatch: dispatch.id })) as {
      state: string
      alreadySettled: boolean
      processAction: string
    }

    expect(retry).toMatchObject({
      state: 'stopped',
      alreadySettled: true,
      processAction: 'none'
    })
    expect(runtime.closeTerminal).toHaveBeenCalledTimes(1)
  })

  it('still fences an unowned terminal before closing it', async () => {
    const { dispatch } = createStalledWorker()
    expect(db.markWorkerTerminalUserOwned(WORKER_PANE_KEY)).toBe(1)

    const stopped = (await call('orchestration.workerStop', { dispatch: dispatch.id })) as {
      state: string
      lastError: string
    }

    expect(stopped).toMatchObject({
      state: 'stop_unknown',
      lastError: 'The worker terminal is user_owned; no terminal was closed.'
    })
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(db.getWorkerDispatch(dispatch.id)?.state).toBe('stop_unknown')
  })

  it('does not settle a stop on an unconfirmed close of a stalled worker', async () => {
    const { dispatch } = createStalledWorker()
    vi.mocked(runtime.closeTerminal).mockResolvedValue({
      handle: 'term_worker',
      tabId: 'tab_worker',
      ptyKilled: false
    } as never)

    const stopped = (await call('orchestration.workerStop', { dispatch: dispatch.id })) as {
      state: string
      lastError: string
    }

    expect(stopped.state).toBe('stop_unknown')
    expect(stopped.lastError).toContain('could not be confirmed stopped')
    expect(db.getWorkerDispatch(dispatch.id)?.state).toBe('stop_unknown')
  })

  it('stays already-settled for a failure the worker itself reported', async () => {
    const { task, dispatch } = createStalledWorker()
    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'failed',
      result: 'build broke on X'
    })

    const stopped = (await call('orchestration.workerStop', { dispatch: dispatch.id })) as {
      state: string
      alreadySettled: boolean
      processAction: string
    }

    expect(stopped).toMatchObject({
      state: 'failed',
      alreadySettled: true,
      processAction: 'none'
    })
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(db.getWorkerDispatch(dispatch.id)).toMatchObject({ state: 'failed', stage: 'settled' })
  })

  it('stays already-settled for a failure whose prompt never landed', async () => {
    const run = db.createRun({
      objective: 'Never ready',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = db.createTask({ spec: 'never became ready', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: task.id,
      startOptions: {},
      runtimeEpoch: runtime.getRuntimeId()
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_worker',
      paneKey: WORKER_PANE_KEY,
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }],
      terminalOwnership: 'created'
    })
    db.failWorkerStart(started.dispatch.id, 'agent_readiness', 'Agent did not become ready (idle).')

    const stopped = (await call('orchestration.workerStop', {
      dispatch: started.dispatch.id
    })) as { state: string; alreadySettled: boolean }

    expect(stopped).toMatchObject({ state: 'failed', alreadySettled: true })
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
  })
})
