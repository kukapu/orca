// `worker-show` must publish observed launch-option evidence from the host that
// owns the terminal — or an explicit absence — never a launch-selection echo.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { ORCHESTRATION_METHODS } from './orchestration'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status-types'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const LEAF_ID = '33333333-3333-4333-8333-333333333333'
const TAB_ID = 'tab-worker-options'
const WORKTREE_ID = 'wt-worker-options'
const PTY_ID = 'pty-worker-options'

function workerShowMethod() {
  const method = ORCHESTRATION_METHODS.find(
    (candidate) => candidate.name === 'orchestration.workerShow'
  )
  if (!method) {
    throw new Error('Missing method orchestration.workerShow')
  }
  return method
}

function statusRow(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    paneKey: 'unset',
    connectionId: null,
    receivedAt: 0,
    stateStartedAt: 0,
    state: 'working',
    prompt: '',
    ...overrides
  }
}

describe('worker-show observed options evidence', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  async function showWorkerWithStatuses(
    statusesByPane: (paneKey: string) => AgentStatusIpcPayload[],
    opts?: { breakIdentity?: boolean }
  ) {
    // Why a mutable closure: the runtime captures the dep at construction, so
    // pane-keyed rows can only be swapped through the same function reference.
    let statuses: AgentStatusIpcPayload[] = []
    const runtime = new OrcaRuntimeService(null, undefined, {
      getAgentStatusSnapshot: () => statuses
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
          paneTitle: 'pi'
        }
      ]
    })

    const paneKey = runtime.getTerminalPaneKey(terminal.handle)
    const incarnation = runtime.getTerminalProcessIncarnation(terminal.handle)
    if (!paneKey || !incarnation) {
      throw new Error('Runtime did not expose the worker pane identity.')
    }
    statuses = statusesByPane(paneKey)

    db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'observe workers',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:leaf_coord'
    })
    const task = db.createTask({ spec: 'run the suite', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER
    })
    db.mintDispatchCapability({
      dispatchId: started.dispatch.id,
      paneKey,
      processIncarnation: opts?.breakIdentity === true ? `${incarnation}:replaced` : incarnation
    })
    ;(
      db as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
      }
    ).db
      .prepare(
        `UPDATE worker_dispatches
           SET state = 'ready', stage = 'agent_ready', worktree_id = ?, agent_terminal_handle = ?
           WHERE dispatch_id = ?`
      )
      .run(WORKTREE_ID, terminal.handle, started.dispatch.id)

    const method = workerShowMethod()
    const result = (await method.handler(method.params?.parse({ dispatch: started.dispatch.id }), {
      runtime
    })) as { observation: Record<string, unknown> }
    return { result, paneKey }
  }

  it('publishes observed model and thinking evidence with origin and clock', async () => {
    const t0 = Date.now()
    const { result } = await showWorkerWithStatuses((paneKey) => [
      statusRow({
        paneKey,
        agentType: 'pi',
        state: 'working',
        receivedAt: t0 + 100,
        stateStartedAt: t0 + 90,
        model: 'zai/glm-5.3',
        thinkingLevel: 'xhigh'
      })
    ])

    expect(result.observation).toMatchObject({
      exactWorker: true,
      observedOptions: {
        status: 'observed',
        origin: 'hook',
        agent: 'pi',
        model: 'zai/glm-5.3',
        thinkingLevel: 'xhigh',
        observedAt: expect.any(Number)
      }
    })
  })

  it('reports explicit status_without_options when the pane reports without evidence', async () => {
    const t0 = Date.now()
    const { result } = await showWorkerWithStatuses((paneKey) => [
      statusRow({
        paneKey,
        agentType: 'pi',
        state: 'done',
        receivedAt: t0 + 100,
        stateStartedAt: t0 + 90
      })
    ])

    expect(result.observation.observedOptions).toEqual({
      status: 'unavailable',
      origin: 'hook',
      reason: 'status_without_options',
      lastReceivedAt: expect.any(Number)
    })
  })

  it('reports explicit no_status_row when no hook ever reported for the pane', async () => {
    const { result } = await showWorkerWithStatuses(() => [])

    expect(result.observation.observedOptions).toEqual({
      status: 'unavailable',
      origin: 'hook',
      reason: 'no_status_row'
    })
  })

  it('does not observe options for a replaced worker process', async () => {
    const t0 = Date.now()
    const { result } = await showWorkerWithStatuses(
      (paneKey) => [
        statusRow({
          paneKey,
          agentType: 'pi',
          model: 'zai/glm-5.3',
          receivedAt: t0 + 100,
          stateStartedAt: t0 + 90
        })
      ],
      { breakIdentity: true }
    )

    expect(result.observation.exactWorker).toBe(false)
    expect(result.observation.observedOptions).toEqual({
      status: 'unavailable',
      origin: 'hook',
      reason: 'worker_identity_not_exact'
    })
  })
})
