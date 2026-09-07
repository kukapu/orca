import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { OrchestrationDb } from '../orchestration-db'

const PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('remote attachment pane occupancy', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  function attach(dispatchId: string): void {
    db.createRemoteDispatchAttachment({
      dispatchId,
      taskId: `task_${dispatchId}`,
      homePeerFingerprint: 'home_peer',
      protocolVersion: 3,
      runtimeEpoch: 'worker_runtime',
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: `attach_${dispatchId}`,
        method: 'orchestration.federationAttachStart',
        payloadHash: `attach_${dispatchId}_payload`
      }
    })
  }

  function prepare(dispatchId: string): string {
    return db.prepareRemoteAttachmentAuthority({
      dispatchId,
      paneKey: PANE,
      processIncarnation: 'worker_runtime:pty:1',
      worktreeId: 'repo::worktree',
      terminalHandle: 'term_worker',
      setupState: 'completed',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }]
    })
  }

  function expectContenderRejected(ownerId: string): void {
    attach('ctx_contender')
    expect(() => prepare('ctx_contender')).toThrow(`already has active remote Dispatch ${ownerId}`)
    expect(db.getRemoteDispatchAttachment('ctx_contender')).toMatchObject({
      state: 'starting',
      pane_key: null
    })
  }

  it('rejects a contender while a retained stalled attachment still holds the pane', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })
    expectContenderRejected('ctx_stalled')
  })

  it('rejects a contender while a legacy-cleared stalled attachment still holds the pane', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false)
    expectContenderRejected('ctx_stalled')
  })

  it('rejects a contender after beginStop without a stop ack', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })
    db.beginRemoteAttachmentStop('ctx_stalled')
    expect(db.getRemoteDispatchAttachment('ctx_stalled')).toMatchObject({
      state: 'stopping',
      stage: 'stop_requested'
    })
    expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
    expectContenderRejected('ctx_stalled')
  })

  it('rejects a contender while stop_unknown leaves the process unverifiable', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false)
    db.beginRemoteAttachmentStop('ctx_stalled')
    db.markRemoteAttachmentStopUnknown('ctx_stalled', 'stop response lost')
    expectContenderRejected('ctx_stalled')
  })

  it('accepts a contender only after stop is settled', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })
    db.beginRemoteAttachmentStop('ctx_stalled')
    db.settleRemoteAttachmentStop('ctx_stalled')
    attach('ctx_next')
    expect(() => prepare('ctx_next')).not.toThrow()
  })

  it('accepts a contender after the stalled worker reports itself settled', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })
    db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', 'succeeded')
    attach('ctx_next')
    expect(() => prepare('ctx_next')).not.toThrow()
  })

  it('does not occupy a pane for a failure before launch without a PTY', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_prelaunch')
    db.failRemoteAttachment('ctx_prelaunch', 'agent_readiness', AGENT_PROMPT_STALLED_ERROR, false)
    expect(db.getRemoteDispatchAttachment('ctx_prelaunch')?.pane_key).toBeNull()
    attach('ctx_next')
    expect(() => prepare('ctx_next')).not.toThrow()
  })
})
