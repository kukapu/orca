import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

const WORKER_PANE_KEY = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_PANE_KEY = 'tab_other:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LEGACY_PROTOCOL_VERSION = 2
const CURRENT_PROTOCOL_VERSION = 3

// An unobserved prompt leaves the delivery possibly executed: the attachment
// keeps its capability so the worker's own late report stays authoritative,
// while every other failure keeps fencing the pane out.
describe('remote dispatch attachments after an unobserved prompt', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function createAttachment(
    dispatchId = 'ctx_stalled',
    protocolVersion = CURRENT_PROTOCOL_VERSION,
    paneKey = WORKER_PANE_KEY
  ) {
    db.createRemoteDispatchAttachment({
      dispatchId,
      taskId: `task_${dispatchId}`,
      homePeerFingerprint: 'home_peer',
      protocolVersion,
      runtimeEpoch: 'worker_runtime',
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: `attach_${dispatchId}`,
        method: 'orchestration.federationAttachStart',
        payloadHash: `attach_${dispatchId}_payload`
      }
    })
    return db.prepareRemoteAttachmentAuthority({
      dispatchId,
      paneKey,
      processIncarnation: 'worker_runtime:pty:1',
      worktreeId: 'repo::worktree',
      terminalHandle: 'term_worker',
      setupState: 'completed',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }]
    })
  }

  function paneIdentity() {
    return {
      paneKey: WORKER_PANE_KEY,
      processIncarnation: 'worker_runtime:pty:1'
    }
  }

  function reportPayload(dispatchId: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
    return JSON.stringify({
      payload: JSON.stringify({
        taskId: `task_${dispatchId}`,
        dispatchId,
        outcome
      })
    })
  }

  it('retains the capability for a stalled prompt and revokes it otherwise', () => {
    db = new OrchestrationDb(':memory:')
    const capability = createAttachment()

    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
      retainCapability: true
    })
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'failed',
      last_error: 'agent_prompt_stalled',
      capability_hash: expect.any(String)
    })
    expect(
      db.verifyRemoteAttachmentAuthority({
        dispatchId: 'ctx_stalled',
        capability,
        ...paneIdentity()
      })
    ).toBe(true)

    const revokedCapability = createAttachment(
      'ctx_revoked',
      CURRENT_PROTOCOL_VERSION,
      OTHER_PANE_KEY
    )
    db.failRemoteAttachment('ctx_revoked', 'agent_readiness', 'Agent did not become ready.', false)
    expect(db.getRemoteDispatchAttachment('ctx_revoked')?.capability_hash).toBeNull()
    expect(
      db.verifyRemoteAttachmentAuthority({
        dispatchId: 'ctx_revoked',
        capability: revokedCapability,
        paneKey: OTHER_PANE_KEY,
        processIncarnation: 'worker_runtime:pty:1'
      })
    ).toBe(false)
  })

  it('keeps routing the worker pane while the retained capability proves identity', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
      retainCapability: true
    })
    expect(db.findActiveRemoteAttachmentForPane(WORKER_PANE_KEY)?.dispatch_id).toBe('ctx_stalled')

    db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'succeeded')
    expect(db.findActiveRemoteAttachmentForPane(WORKER_PANE_KEY)).toBeUndefined()

    createAttachment('ctx_revoked')
    db.failRemoteAttachment('ctx_revoked', 'agent_readiness', 'Agent did not become ready.', false)
    expect(db.findActiveRemoteAttachmentForPane(WORKER_PANE_KEY)).toBeUndefined()
  })

  it('settles a late report from the retained-failure state on the current protocol', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
      retainCapability: true
    })

    expect(() =>
      db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'succeeded')
    ).not.toThrow()
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'succeeded',
      stage: 'worker_report_queued',
      capability_hash: null
    })
  })

  it('still settles a late legacy report enqueued from the retained-failure state', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment('ctx_stalled', LEGACY_PROTOCOL_VERSION)
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
      retainCapability: true
    })

    const relay = db.enqueueFederationRelay({
      dispatchId: 'ctx_stalled',
      direction: 'to_home',
      kind: 'worker_done',
      payload: reportPayload('ctx_stalled'),
      settleRemoteOutcome: 'succeeded'
    })

    expect(relay.kind).toBe('worker_done')
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'succeeded',
      capability_hash: null
    })
  })

  it('rejects relay settlement from a failure whose capability was revoked', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'agent_readiness', 'Agent did not become ready.', false)

    expect(() =>
      db.enqueueFederationRelay({
        dispatchId: 'ctx_stalled',
        direction: 'to_home',
        kind: 'worker_done',
        payload: reportPayload('ctx_stalled'),
        settleRemoteOutcome: 'succeeded'
      })
    ).toThrow('is not active')
    expect(db.getRemoteDispatchAttachment('ctx_stalled')?.state).toBe('failed')
  })

  // Hosts running the pre-.2 code persisted stalled failures with the hash already
  // cleared: authority is gone, but the process verdict is unchanged — the prompt
  // bytes were written and the worker may still be executing them.
  it('begins an explicit stop from a legacy stalled failure that lost its hash', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false)
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'failed',
      stage: 'dispatch_input',
      last_error: 'agent_prompt_stalled',
      capability_hash: null
    })

    const begun = db.beginRemoteAttachmentStop('ctx_stalled')

    expect(begun).toMatchObject({ state: 'stopping', stage: 'stop_requested' })
    expect(db.getRemoteDispatchAttachment('ctx_stalled')?.state).toBe('stopping')
  })

  it('does not reopen a failure its own worker already reported', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
      retainCapability: true
    })
    db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'failed')
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'failed',
      stage: 'worker_report_queued',
      last_error: 'agent_prompt_stalled',
      capability_hash: null
    })

    const begun = db.beginRemoteAttachmentStop('ctx_stalled')

    expect(begun.state).toBe('failed')
    expect(db.getRemoteDispatchAttachment('ctx_stalled')?.state).toBe('failed')
  })

  it('still fences late reports from a legacy stalled failure that lost its hash', () => {
    db = new OrchestrationDb(':memory:')
    createAttachment()
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false)

    expect(() => db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'succeeded')).toThrow(
      'cannot settle as succeeded from failed'
    )
    expect(() =>
      db.enqueueFederationRelay({
        dispatchId: 'ctx_stalled',
        direction: 'to_home',
        kind: 'worker_done',
        payload: reportPayload('ctx_stalled'),
        settleRemoteOutcome: 'succeeded'
      })
    ).toThrow('is not active')
    expect(db.findActiveRemoteAttachmentForPane(WORKER_PANE_KEY)).toBeUndefined()
    expect(db.getRemoteDispatchAttachment('ctx_stalled')?.state).toBe('failed')
  })

  it.each(['stopping', 'stop_unknown', 'stopped'] as const)(
    'fences late remote reports once stop revoked authority: %s',
    (state) => {
      db = new OrchestrationDb(':memory:')
      const capability = createAttachment()
      db.failRemoteAttachment('ctx_stalled', 'dispatch_input', 'agent_prompt_stalled', false, {
        retainCapability: true
      })
      db.beginRemoteAttachmentStop('ctx_stalled')
      if (state === 'stop_unknown') {
        db.markRemoteAttachmentStopUnknown('ctx_stalled', 'stop response lost')
      } else if (state === 'stopped') {
        db.settleRemoteAttachmentStop('ctx_stalled')
      }
      expect(
        db.verifyRemoteAttachmentAuthority({
          dispatchId: 'ctx_stalled',
          capability,
          ...paneIdentity()
        })
      ).toBe(false)
      expect(() => db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'succeeded')).toThrow(
        `cannot settle as succeeded from ${state}`
      )
      expect(() =>
        db.enqueueFederationRelay({
          dispatchId: 'ctx_stalled',
          direction: 'to_home',
          kind: 'worker_done',
          payload: reportPayload('ctx_stalled'),
          settleRemoteOutcome: 'succeeded'
        })
      ).toThrow('is not active')
      expect(db.getRemoteDispatchAttachment('ctx_stalled')?.state).toBe(state)
    }
  )

  it('keeps a stalled federated Dispatch relay-eligible until its own report settles it', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'Relay eligibility',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = db.createTask({ spec: 'stalled federated worker', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: task.id,
      startOptions: {},
      runtimeEpoch: 'home_runtime',
      federation: {
        environmentId: 'environment_windows',
        environmentName: 'windows',
        peerFingerprint: 'windows_peer',
        protocolVersion: CURRENT_PROTOCOL_VERSION
      }
    })
    db.failWorkerStart(started.dispatch.id, 'dispatch_input', 'agent_prompt_stalled')

    expect(db.isFederatedDispatchRelayEligible(started.dispatch.id)).toBe(true)
    expect(db.listActiveFederatedDispatches().map((row) => row.dispatch_id)).toContain(
      started.dispatch.id
    )

    db.settleWorkerReport({
      taskId: task.id,
      dispatchId: started.dispatch.id,
      outcome: 'succeeded',
      result: 'done despite the unobserved prompt'
    })
    expect(db.isFederatedDispatchRelayEligible(started.dispatch.id)).toBe(false)
    expect(db.listActiveFederatedDispatches().map((row) => row.dispatch_id)).not.toContain(
      started.dispatch.id
    )
  })

  it('settles the worker row a late report corrected from any recovery state', () => {
    const opened: OrchestrationDb[] = []
    for (const recoveryState of ['stopping', 'stop_unknown'] as const) {
      db = new OrchestrationDb(':memory:')
      opened.push(db)
      const task = db.createTask({
        spec: `late report after ${recoveryState}`,
        runId: db.createRun({
          objective: 'Late settlement',
          coordinatorHandle: 'term_coord',
          coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        }).id
      })
      const started = db.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER,
        taskId: task.id,
        startOptions: {},
        runtimeEpoch: 'home_runtime'
      })
      db.failWorkerStart(started.dispatch.id, 'dispatch_input', 'agent_prompt_stalled', {
        retainCapability: true
      })
      db.beginWorkerStop(started.dispatch.id, 'home_runtime')
      if (recoveryState === 'stop_unknown') {
        db.markWorkerStopUnknown(started.dispatch.id, 'stop response lost')
      }
      expect(db.getWorkerDispatch(started.dispatch.id)?.state).toBe(recoveryState)

      expect(
        db.settleWorkerReport({
          taskId: task.id,
          dispatchId: started.dispatch.id,
          outcome: 'succeeded',
          result: 'the prompt had landed'
        })
      ).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: false })
      expect(db.getTask(task.id)?.status).toBe('completed')
      expect(db.getWorkerDispatch(started.dispatch.id)).toMatchObject({
        state: 'succeeded',
        stage: 'settled'
      })
    }
    // The afterEach closes only the instance `db` still points at.
    for (const early of opened.slice(0, -1)) {
      early.close()
    }
  })
})
