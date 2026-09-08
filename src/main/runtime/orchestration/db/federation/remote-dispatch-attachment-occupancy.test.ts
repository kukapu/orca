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

  function prepare(dispatchId: string, paneKey = PANE): string {
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

  function expectContenderRejected(ownerId: string, paneKey = PANE): void {
    attach('ctx_contender')
    expect(() => prepare('ctx_contender', paneKey)).toThrow(
      `already has active remote Dispatch ${ownerId}`
    )
    expect(db.getRemoteDispatchAttachment('ctx_contender')).toMatchObject({
      state: 'starting',
      pane_key: null,
      capability_hash: null
    })
  }

  it.each([true, false])(
    'rejects a stalled owner with retained capability=%s',
    (retainCapability) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_stalled')
      prepare('ctx_stalled')
      db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
        retainCapability
      })
      expect(db.findActiveRemoteAttachmentForPane(PANE)?.dispatch_id).toBe(
        retainCapability ? 'ctx_stalled' : undefined
      )
      expectContenderRejected('ctx_stalled')
    }
  )

  it.each(['starting', 'ready', 'start_unknown'] as const)(
    'rejects a contender while the owner is %s',
    (state) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_owner')
      prepare('ctx_owner')
      if (state === 'ready') {
        db.markRemoteAttachmentReady('ctx_owner')
      }
      if (state === 'start_unknown') {
        db.failRemoteAttachment('ctx_owner', 'dispatch_input', 'connection lost', true)
      }
      expectContenderRejected('ctx_owner')
    }
  )

  it.each(['stopping', 'stop_unknown'] as const)(
    'keeps occupancy without ask routing while %s leaves the process unverifiable',
    (state) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_stalled')
      prepare('ctx_stalled')
      db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false)
      db.beginRemoteAttachmentStop('ctx_stalled')
      if (state === 'stop_unknown') {
        db.markRemoteAttachmentStopUnknown('ctx_stalled', 'stop response lost')
      }
      expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
      expectContenderRejected('ctx_stalled')
    }
  )

  it('accepts a contender only after stop is settled', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_stalled')
    prepare('ctx_stalled')
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false)
    db.beginRemoteAttachmentStop('ctx_stalled')
    db.settleRemoteAttachmentStop('ctx_stalled')
    attach('ctx_next')
    expect(() => prepare('ctx_next')).not.toThrow()
  })

  it.each(['succeeded', 'failed'] as const)(
    'releases occupancy after the stalled worker reports %s',
    (outcome) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_stalled')
      prepare('ctx_stalled')
      db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
        retainCapability: true
      })
      db.settleRemoteAttachmentInRelayTransaction('ctx_stalled', outcome)
      expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
      attach('ctx_next')
      expect(() => prepare('ctx_next')).not.toThrow()
    }
  )

  it('does not occupy a pane for a failure before launch without a PTY', () => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_prelaunch')
    db.failRemoteAttachment('ctx_prelaunch', 'agent_readiness', AGENT_PROMPT_STALLED_ERROR, false)
    expect(db.getRemoteDispatchAttachment('ctx_prelaunch')?.pane_key).toBeNull()
    attach('ctx_next')
    expect(() => prepare('ctx_next')).not.toThrow()
  })

  it.each(['starting', 'ready'] as const)('requires a capability for %s ask routing', (state) => {
    db = new OrchestrationDb(':memory:')
    attach('ctx_owner')
    prepare('ctx_owner')
    if (state === 'ready') {
      db.markRemoteAttachmentReady('ctx_owner')
    }
    db.db
      .prepare(
        'UPDATE remote_dispatch_attachments SET capability_hash = NULL WHERE dispatch_id = ?'
      )
      .run('ctx_owner')
    expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
    expectContenderRejected('ctx_owner')
  })

  it.each(['worker_report_queued', 'worker_report_settled'])(
    'does not route or occupy a report-settled failure at %s even with a residual hash',
    (stage) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_stalled')
      prepare('ctx_stalled')
      db.failRemoteAttachment('ctx_stalled', stage, AGENT_PROMPT_STALLED_ERROR, false, {
        retainCapability: true
      })
      expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
      expect(db.beginRemoteAttachmentStop('ctx_stalled').state).toBe('failed')
      attach('ctx_next')
      expect(() => prepare('ctx_next')).not.toThrow()
    }
  )

  it.each(['tab_reminted:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'legacy_pane'])(
    'fences occupancy for pane identity %s',
    (paneKey) => {
      db = new OrchestrationDb(':memory:')
      attach('ctx_owner')
      prepare('ctx_owner', paneKey === 'legacy_pane' ? paneKey : PANE)
      expectContenderRejected('ctx_owner', paneKey)
    }
  )
})
