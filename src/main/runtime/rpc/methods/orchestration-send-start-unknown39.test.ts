import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { createPersistedSchemaFixture } from '../../orchestration/db/schema/persisted-schema-test-fixture'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'

describe('orchestration.send retains unknown-start report authority on physical DB39', () => {
  let directory: string
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  const paneKey = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const processIncarnation = 'pty:worker:1'

  afterEach(() => {
    vi.restoreAllMocks()
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function setup() {
    directory = mkdtempSync(join(tmpdir(), 'orca-report-authority39-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = new OrchestrationDb(path)
    const task = db.createTask({ runId: 'r1', spec: 'Worker report authority' })
    const { dispatch } = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {},
      runtimeEpoch: 'runtime-before-restart',
      creator: { kind: 'system' },
      maxDepth: 1
    })
    const capability = db.prepareStartingWorkerAuthority({
      dispatchId: dispatch.id,
      handle: 'term_worker',
      paneKey,
      processIncarnation,
      worktreeId: 'folder-workspace',
      effects: [],
      setupState: 'not_applicable'
    })
    expect(
      db.verifyDispatchCapability({
        dispatchId: dispatch.id,
        capability,
        paneKey,
        processIncarnation
      })
    ).toEqual({ valid: true })
    db.close()
    db = new OrchestrationDb(path)
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    // Only physical terminal identity and notification side effects are stubbed, not RPC/authority/DB.
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(paneKey)
    vi.spyOn(runtime, 'getLiveTerminalPaneKey').mockReturnValue(paneKey)
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue(processIncarnation)
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
    let request = 0
    const send = (outcome: 'succeeded' | 'failed', token = capability) =>
      dispatcher.dispatch({
        id: `report-${++request}`,
        authToken: 'test-local-auth',
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationCapability: token,
        method: 'orchestration.send',
        params: {
          from: 'term_worker',
          to: 'run:r1',
          subject: 'Report',
          type: 'worker_done',
          payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome })
        }
      })
    const facts = () =>
      db.db
        .prepare('SELECT * FROM attempt_observation_facts WHERE dispatch_id = ?')
        .all(dispatch.id)
    return { taskId: task.id, dispatchId: dispatch.id, capability, send, facts }
  }

  it.each(['succeeded', 'failed'] as const)(
    'accepts %s after public markWorkerStartUnknown with the original capability',
    async (outcome) => {
      const { taskId, dispatchId, capability, send, facts } = setup()
      const authority = db.getDispatchContextById(dispatchId)!
      expect(
        db.markWorkerStartUnknown(dispatchId, 'runtime_restarted', 'Runtime epoch changed')
      ).toMatchObject({ state: 'start_unknown' })
      expect(db.getTask(taskId)?.status).toBe('blocked')
      expect(db.getDispatchContextById(dispatchId)).toMatchObject({
        capability_hash: authority.capability_hash,
        capability_revoked_at: null,
        assignee_pane_key: paneKey,
        process_incarnation: processIncarnation
      })
      const response = await send(outcome)
      expect(response).toMatchObject({
        ok: true,
        result: { lifecycle: { action: outcome === 'succeeded' ? 'completed' : 'failed' } }
      })
      const status = outcome === 'succeeded' ? 'completed' : 'failed'
      expect(db.getTask(taskId)?.status).toBe(status)
      expect(db.getDispatchContextById(dispatchId)).toMatchObject({
        status,
        capability_hash: authority.capability_hash,
        assignee_pane_key: paneKey,
        process_incarnation: processIncarnation,
        capability_revoked_at: expect.any(String)
      })
      expect(db.getWorkerDispatch(dispatchId)).toMatchObject({ state: outcome, stage: 'settled' })
      const messageId = JSON.parse(db.getTask(taskId)!.result!).messageId as string
      const message = db.getMessageById(messageId)!
      expect(facts()).toEqual([
        expect.objectContaining({
          id: `worker_report:${messageId}`,
          task_id: taskId,
          dispatch_id: dispatchId,
          authority_id: 'run_home:r1',
          authority_clock: 'home',
          facet: 'worker_report',
          sequence: 0,
          home_received_at: Date.parse(message.created_at),
          payload: JSON.stringify({
            outcome,
            reportId: `worker_report:${messageId}`,
            status: 'accepted'
          })
        })
      ])
      expect(
        db.verifyDispatchCapability({ dispatchId, capability, paneKey, processIncarnation })
      ).toMatchObject({ valid: false, reason: expect.stringContaining('revoked') })
      expect(await send(outcome)).toMatchObject({
        ok: true,
        result: { lifecycle: { action: 'rejected', code: 'dispatch_capability_invalid' } }
      })
      expect(facts()).toHaveLength(1)
    }
  )

  it.each([
    'wrong-token',
    'wrong-pane',
    'wrong-incarnation',
    'rotated-token',
    'revoked-token'
  ] as const)('still rejects %s after unknown start', async (kind) => {
    const { taskId, dispatchId, capability, send, facts } = setup()
    if (kind === 'revoked-token') {
      db.revokeDispatchCapability(dispatchId)
    }
    db.markWorkerStartUnknown(dispatchId, 'runtime_restarted', 'Runtime epoch changed')
    if (kind === 'wrong-pane') {
      vi.mocked(runtime.getTerminalPaneKey).mockReturnValue(
        'tab_foreign:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      )
      vi.mocked(runtime.getLiveTerminalPaneKey).mockReturnValue(
        'tab_foreign:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      )
    }
    if (kind === 'wrong-incarnation') {
      vi.mocked(runtime.getTerminalProcessIncarnation).mockReturnValue('pty:worker:2')
    }
    if (kind === 'rotated-token') {
      db.mintDispatchCapability({ dispatchId, paneKey, processIncarnation })
    }
    expect(
      await send('succeeded', kind === 'wrong-token' ? 'dcap_wrong' : capability)
    ).toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'rejected', code: 'dispatch_capability_invalid' } }
    })
    expect(db.getTask(taskId)?.status).toBe('blocked')
    expect(db.getWorkerDispatch(dispatchId)?.state).toBe('start_unknown')
    expect(facts()).toEqual([])
  })

  it('preserves definitive failure revocation and rejects its late report', async () => {
    const { taskId, dispatchId, send, facts } = setup()
    db.failWorkerStart(dispatchId, 'launch_failed', 'Definitive launch failure')
    expect(db.getDispatchContextById(dispatchId)?.capability_revoked_at).toEqual(expect.any(String))
    expect(await send('succeeded')).toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'rejected', code: 'dispatch_capability_invalid' } }
    })
    expect(db.getTask(taskId)?.status).toBe('failed')
    expect(db.getWorkerDispatch(dispatchId)?.state).toBe('failed')
    expect(facts()).toEqual([])
  })
})
