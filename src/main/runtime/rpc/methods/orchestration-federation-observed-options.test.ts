// Federated worker-show must carry observed-option evidence computed on the
// EXECUTING host (the worker server), relayed verbatim by the Run home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import type { WorkerObservedOptionsSelection } from '../../orchestration/worker-observed-options'

describe('orchestration federated observed options', () => {
  const databases: OrchestrationDb[] = []
  let homeDb: OrchestrationDb
  let workerRuntime: OrcaRuntimeService
  let homeRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    const workerDb = new OrchestrationDb(':memory:')
    databases.push(homeDb, workerDb)
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    const workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: ORCHESTRATION_METHODS
    })
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: workerRuntime.getStatus(),
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        return (await workerDispatcher.dispatch({
          id: `remote_${method}`,
          authToken: 'run-home-device-token',
          method,
          params,
          orchestrationContractVersion: envelope?.orchestrationContractVersion,
          orchestrationRequestId: envelope?.orchestrationRequestId,
          orchestrationCapability: envelope?.orchestrationCapability
        })) as RuntimeRpcResponse<unknown>
      }
    }
    homeRuntime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: transport
    })
    homeRuntime.setOrchestrationDb(homeDb)
    homeDispatcher = new RpcDispatcher({
      runtime: homeRuntime,
      methods: ORCHESTRATION_METHODS
    })
    vi.spyOn(homeRuntime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null
    )
    configureWorkerRuntime(workerRuntime)
  })

  afterEach(() => {
    homeRuntime.stopOrchestrationFederationRelay()
    for (const db of databases.splice(0)) {
      db.close()
    }
  })

  function configureWorkerRuntime(runtime: OrcaRuntimeService): void {
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({
      id: 'windows-repo',
      kind: 'git'
    } as never)
    vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
      worktree: { id: 'repo::windows-worktree', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_windows_worker' },
      setupReceipt: {
        requested: 'run',
        hookFound: false,
        startupPolicy: 'start-immediately',
        state: 'not_configured'
      }
    } as never)
    vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
      terminals: [{ handle: 'term_windows_worker', title: 'Codex' }],
      totalCount: 1,
      truncated: false
    } as never)
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'term_windows_worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(
      'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('windows_runtime:pty:1')
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'term_windows_worker',
      accepted: true,
      bytesWritten: 1
    })
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      handle: 'term_windows_worker',
      worktreeId: 'repo::windows-worktree',
      status: 'running'
    } as never)
  }

  async function startRemoteWorker(): Promise<string> {
    const run = homeDb.createRun({
      objective: 'Mac to Windows observed options',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Observe Windows worker options', runId: run.id })
    await homeDispatcher.dispatch({
      id: 'rpc_worker_start',
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: 'request_windows_worker',
      method: 'orchestration.workerStart',
      params: {
        task: task.id,
        from: 'term_coord',
        on: 'windows',
        worktree: 'new-top-level',
        repo: 'id:windows-repo',
        agent: 'pi',
        name: 'windows-worker'
      }
    } satisfies RpcRequest as never)
    return homeDb.getDispatchContext(task.id)!.id
  }

  async function showRemoteWorker(dispatchId: string) {
    return homeDispatcher.dispatch({
      id: 'rpc_remote_show',
      authToken: 'coordinator-token',
      method: 'orchestration.workerShow',
      params: { dispatch: dispatchId }
    })
  }

  it('relays evidence the executing host observed, with origin and clock', async () => {
    const dispatchId = await startRemoteWorker()
    vi.spyOn(workerRuntime, 'getExactWorkerObservedOptions').mockImplementation(
      () =>
        ({
          kind: 'observed',
          evidence: {
            origin: 'hook',
            agent: 'pi',
            model: 'zai/glm-5.3',
            thinkingLevel: 'xhigh',
            observedAt: 1_788_694_000_000
          }
        }) satisfies WorkerObservedOptionsSelection as never
    )

    const shown = await showRemoteWorker(dispatchId)

    expect(shown).toMatchObject({
      ok: true,
      result: {
        observation: {
          status: 'live',
          exactWorker: true,
          observedOptions: {
            status: 'observed',
            origin: 'hook',
            agent: 'pi',
            model: 'zai/glm-5.3',
            thinkingLevel: 'xhigh',
            observedAt: 1_788_694_000_000
          }
        }
      }
    })
    // Why: the evidence must have been evaluated against the remote worker terminal.
    expect(workerRuntime.getExactWorkerObservedOptions).toHaveBeenCalledWith(
      'term_windows_worker',
      expect.any(Number)
    )
  })

  it('relays an explicit absence computed on the executing host', async () => {
    const dispatchId = await startRemoteWorker()
    vi.spyOn(workerRuntime, 'getExactWorkerObservedOptions').mockImplementation(
      () => ({ kind: 'rows_without_options', lastReceivedAt: 1_788_694_100_000 }) as never
    )

    const shown = await showRemoteWorker(dispatchId)

    expect(shown).toMatchObject({
      ok: true,
      result: {
        observation: {
          observedOptions: {
            status: 'unavailable',
            origin: 'hook',
            reason: 'status_without_options',
            lastReceivedAt: 1_788_694_100_000
          }
        }
      }
    })
  })
})
