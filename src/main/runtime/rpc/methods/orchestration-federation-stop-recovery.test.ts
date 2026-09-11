import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration/federation/federation-request.test-support'

// Recovery of a federated worker whose prompt delivery was never observed: the task
// failure is a delivery verdict, not a process verdict, so stop must still reach the
// remote terminal while the worker's own late report stays authoritative.
describe('orchestration federation stop recovery', () => {
  const databases: OrchestrationDb[] = []
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher
  let workerStatusCapabilities: string[] | undefined

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    databases.push(homeDb, workerDb)
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    workerDispatcher = new RpcDispatcher({ runtime: workerRuntime, methods: ORCHESTRATION_METHODS })
    workerStatusCapabilities = undefined
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        if (method === 'status.get') {
          const status = workerRuntime.getStatus()
          return {
            id: 'status',
            ok: true,
            result: { ...status, capabilities: workerStatusCapabilities ?? status.capabilities },
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
    homeDispatcher = new RpcDispatcher({ runtime: homeRuntime, methods: ORCHESTRATION_METHODS })
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

  function createHomeTask() {
    const run = homeDb.createRun({
      objective: 'Unobserved remote prompt',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    return homeDb.createTask({ spec: 'Audit Windows behavior', runId: run.id })
  }

  function configureWorkerRuntime(runtime: OrcaRuntimeService): void {
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showRepo').mockResolvedValue({ id: 'windows-repo', kind: 'git' } as never)
    vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
      worktree: { id: 'repo::windows-worktree', repoId: 'repo' },
      startupTerminal: { spawned: true, handle: 'term_windows_worker' },
      setupReceipt: {
        requested: 'run',
        hookFound: true,
        startupPolicy: 'start-immediately',
        state: 'running'
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
    vi.spyOn(runtime, 'closeTerminal').mockResolvedValue({
      handle: 'term_windows_worker',
      tabId: 'tab-windows-worker',
      ptyKilled: true
    } as never)
  }

  async function startStalledFederatedWorker(taskId: string) {
    vi.mocked(workerRuntime.sendTerminalAgentPrompt).mockRejectedValueOnce(
      new Error('agent_prompt_stalled')
    )
    const response = await homeDispatcher.dispatch(startRequest(taskId))
    expect(response).toMatchObject({
      ok: true,
      result: { state: 'failed', lastError: 'agent_prompt_stalled' }
    })
    homeRuntime.stopOrchestrationFederationRelay()
    const dispatch = homeDb.getDispatchContext(taskId)!
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''
    const capability = prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1]
    return { dispatch, capability }
  }

  function sendRemoteWorkerDone(taskId: string, dispatchId: string, capability: string) {
    const controller = new AbortController()
    const sent = workerDispatcher.dispatch(
      {
        id: `rpc_stalled_worker_done_${dispatchId}`,
        authToken: 'worker-local-token',
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationRequestId: `stalled_worker_done_${dispatchId}`,
        orchestrationCapability: capability,
        method: 'orchestration.send',
        params: {
          from: 'term_windows_worker',
          subject: 'Done despite the unobserved prompt',
          body: 'The prompt had landed and the work finished.',
          type: 'worker_done',
          payload: JSON.stringify({
            taskId,
            dispatchId,
            outcome: 'succeeded',
            filesModified: [],
            reportPath: null
          })
        }
      },
      { signal: controller.signal }
    )
    return {
      settle: async () => {
        await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)
        controller.abort()
        return sent
      }
    }
  }

  function requestWorkerStop(requestId: string, dispatchId: string) {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `request_${requestId}`,
      method: 'orchestration.workerStop',
      params: { dispatch: dispatchId }
    })
  }

  it.each([
    { mode: 'local error', error: new Error('agent_prompt_stalled') },
    { mode: 'relayed error', error: { code: 'agent_prompt_stalled', message: 'Not observed' } }
  ])('refuses to duplicate an unobserved remote prompt: $mode', async ({ error }) => {
    const task = createHomeTask()
    vi.mocked(workerRuntime.sendTerminalAgentPrompt).mockRejectedValueOnce(error)

    const response = await homeDispatcher.dispatch(startRequest(task.id))
    expect(response).toMatchObject({
      ok: true,
      result: { state: 'failed', lastError: 'agent_prompt_stalled' }
    })
    const dispatch = homeDb.getDispatchContext(task.id)!
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'failed',
      last_error: 'agent_prompt_stalled',
      // Why retained: the prompt bytes were written, so the worker's own late
      // report must stay authoritative instead of being fenced out.
      capability_hash: expect.any(String)
    })

    const retry = await homeDispatcher.dispatch({
      ...startRequest(task.id, { retryOf: dispatch.id }),
      orchestrationRequestId: 'request_stalled_replacement'
    })
    expect(retry).toMatchObject({
      ok: false,
      error: {
        code: 'task_not_startable',
        data: { taskId: task.id, retryOf: dispatch.id }
      }
    })
    expect(homeDb.getDispatchContext(task.id)?.id).toBe(dispatch.id)
    expect(homeDb.getTask(task.id)?.status).toBe('failed')
    expect(workerRuntime.createManagedWorktree).toHaveBeenCalledOnce()
    expect(workerRuntime.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('keeps the late result of a federated worker whose prompt went unobserved', async () => {
    const task = createHomeTask()
    const { dispatch, capability } = await startStalledFederatedWorker(task.id)
    expect(homeDb.listActiveFederatedDispatches().map((row) => row.dispatch_id)).toContain(
      dispatch.id
    )

    const { settle } = sendRemoteWorkerDone(task.id, dispatch.id, capability!)
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatch.id, 'to_home')).toHaveLength(1)
    )
    const sent = await settle()

    expect(sent).toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed', authority: 'run_home' } }
    })
    expect(homeDb.getTask(task.id)).toMatchObject({ status: 'completed' })
    expect(homeDb.getDispatchContextById(dispatch.id)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'worker_report_settled'
    })
    expect(workerDb.listPendingFederationRelay(dispatch.id, 'to_home')).toHaveLength(0)
    expect(workerRuntime.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    expect(homeDb.listActiveFederatedDispatches().map((row) => row.dispatch_id)).not.toContain(
      dispatch.id
    )
  })

  it('stops a federated worker whose prompt went unobserved', async () => {
    const task = createHomeTask()
    const { dispatch } = await startStalledFederatedWorker(task.id)

    const stopped = await requestWorkerStop('stalled_remote_stop', dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: {
        state: 'stopped',
        alreadySettled: false,
        processAction: 'closed_agent_terminal'
      }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_worker')
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'stopped',
      capability_hash: null
    })
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({ state: 'stopped' })
    expect(homeDb.getTask(task.id)?.status).toBe('failed')
    expect(homeDb.getDispatchContextById(dispatch.id)?.last_failure).toBe('agent_prompt_stalled')

    const retry = await requestWorkerStop('stalled_remote_stop_retry', dispatch.id)
    expect(retry).toMatchObject({
      ok: true,
      result: { state: 'stopped', alreadySettled: true, processAction: 'none' }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledTimes(1)
  })

  // The pre-.2 worker servers persisted stalled failures with the capability hash
  // already cleared: no authority is left, but the process verdict is unchanged.
  async function startLegacyNullHashStalledWorker(taskId: string) {
    const { dispatch } = await startStalledFederatedWorker(taskId)
    ;(
      workerDb as unknown as {
        db: { prepare: (sql: string) => { run: (id: string) => void } }
      }
    ).db
      .prepare(
        'UPDATE remote_dispatch_attachments SET capability_hash = NULL WHERE dispatch_id = ?'
      )
      .run(dispatch.id)
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.capability_hash).toBeNull()
    return { dispatch }
  }

  it('stops a federated worker stalled before this host retained capabilities', async () => {
    const task = createHomeTask()
    const { dispatch } = await startLegacyNullHashStalledWorker(task.id)

    const stopped = await requestWorkerStop('legacy_stalled_remote_stop', dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: {
        state: 'stopped',
        alreadySettled: false,
        processAction: 'closed_agent_terminal'
      }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_worker')
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'stopped'
    })
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({ state: 'stopped' })
    expect(homeDb.getTask(task.id)?.status).toBe('failed')
    expect(homeDb.getDispatchContextById(dispatch.id)?.last_failure).toBe('agent_prompt_stalled')
  })

  it('fences the old-host stalled stop when the pane hosts a replacement process', async () => {
    const task = createHomeTask()
    const { dispatch } = await startLegacyNullHashStalledWorker(task.id)
    vi.mocked(workerRuntime.getTerminalProcessIncarnation).mockReturnValue(
      'windows_runtime:pty:replacement'
    )

    const stopped = await requestWorkerStop('legacy_stalled_replaced_stop', dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: { state: 'stop_unknown', processAction: 'none' }
    })
    expect(stopped).toMatchObject({
      ok: true,
      result: { lastError: expect.stringContaining('identity_changed') }
    })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.state).toBe('stop_unknown')
    expect(homeDb.getWorkerDispatch(dispatch.id)?.state).toBe('stop_unknown')
    expect(homeDb.getTask(task.id)?.status).toBe('failed')
  })

  it('keeps the late federated result when the stop attempt never reached the worker server', async () => {
    const task = createHomeTask()
    const { dispatch, capability } = await startStalledFederatedWorker(task.id)
    vi.spyOn(homeRuntime, 'callOrchestrationWorkerServer').mockRejectedValueOnce(
      new Error('connection lost before the stop reached the worker server')
    )

    const stopped = await requestWorkerStop('stalled_unreached_stop', dispatch.id)
    expect(stopped).toMatchObject({
      ok: true,
      result: { state: 'stop_unknown', processAction: 'unknown' }
    })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()

    const { settle } = sendRemoteWorkerDone(task.id, dispatch.id, capability!)
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatch.id, 'to_home')).toHaveLength(1)
    )
    const sent = await settle()

    expect(sent).toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed', authority: 'run_home' } }
    })
    expect(homeDb.getTask(task.id)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'worker_report_settled'
    })
  })

  it('lets a queued remote report outrank the stop of an unobserved prompt', async () => {
    const task = createHomeTask()
    const { dispatch, capability } = await startStalledFederatedWorker(task.id)
    const { settle } = sendRemoteWorkerDone(task.id, dispatch.id, capability!)
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatch.id, 'to_home')).toHaveLength(1)
    )

    const stopped = await requestWorkerStop('stalled_report_races_stop', dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: { state: 'succeeded', alreadySettled: true, processAction: 'none' }
    })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    const sent = await settle()
    expect(sent).toMatchObject({ ok: true })
    expect(homeDb.getTask(task.id)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.state).toBe('succeeded')
  })

  it('keeps a legacy-protocol late report ahead of the stop', async () => {
    const realStatus = workerRuntime.getStatus()
    workerStatusCapabilities = (realStatus.capabilities ?? []).filter(
      (capability) =>
        capability !== ORCHESTRATION_FEDERATION_LIFECYCLE_SETTLEMENT_RUNTIME_CAPABILITY
    )
    const task = createHomeTask()
    const { dispatch, capability } = await startStalledFederatedWorker(task.id)
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.protocol_version).toBe(2)

    const { settle } = sendRemoteWorkerDone(task.id, dispatch.id, capability!)
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatch.id, 'to_home')).toHaveLength(1)
    )
    // Why asserted before the stop: the legacy enqueue settles the attachment
    // terminally on queue, so the stop can only ever discover it already decided.
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({ state: 'succeeded' })

    const stopped = await requestWorkerStop('legacy_report_races_stop', dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: { state: 'succeeded', alreadySettled: true, processAction: 'none' }
    })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    const sent = await settle()
    expect(sent).toMatchObject({ ok: true })
    expect(homeDb.getTask(task.id)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatch.id)).toMatchObject({
      state: 'succeeded',
      stage: 'settled'
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)).toMatchObject({
      state: 'succeeded'
    })
  })
})
