import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_PROMPT_STALLED_ERROR } from '../agent-prompt-submission-verification'
import { OrchestrationDb } from './db'

const WORKER = 'term_worker'
const PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCARNATION = 'runtime_test:term_worker:1'
const COORD_PANE = 'tab_coord:11111111-1111-4111-8111-111111111111'

let db: OrchestrationDb

afterEach(() => db?.close())

function startAskableWorker(spec = 'ask after stall'): {
  runId: string
  generation: number
  taskId: string
  dispatchId: string
  capability: string
} {
  const run = db.createRun({
    objective: spec,
    coordinatorHandle: 'term_coord',
    coordinatorPaneKey: COORD_PANE
  })
  const task = db.createTask({ spec, runId: run.id })
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
  return {
    runId: run.id,
    generation: run.consumer_generation,
    taskId: task.id,
    dispatchId: started.dispatch.id,
    capability
  }
}

function ask(runId: string, dispatchId: string, question = 'ready to proceed with smoke?') {
  return db.createQuestion({
    runId,
    dispatchId,
    askerHandle: WORKER,
    question
  })
}

function answer(runId: string, generation: number, messageId: string, body = 'yes') {
  return db.answerQuestion({
    messageId,
    runId,
    consumerGeneration: generation,
    body
  })
}

function attachSuccessor(runId: string, spec: string, handle = WORKER, paneKey = PANE): string {
  const task = db.createTask({ spec, runId })
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId: task.id,
    startOptions: {}
  })
  db.prepareStartingWorkerAuthority({
    dispatchId: started.dispatch.id,
    handle,
    paneKey,
    processIncarnation: `runtime_test:${handle}:1`,
    worktreeId: 'repo::worktree',
    setupState: 'not_applicable',
    effects: [{ kind: 'terminal', action: 'created', id: handle }]
  })
  return started.dispatch.id
}

function terminateSuccessor(dispatchId: string): void {
  db.markWorkerDispatchReady(dispatchId)
  expect(
    db.settleWorkerReport({
      taskId: db.getDispatchContextById(dispatchId)!.task_id,
      dispatchId,
      outcome: 'succeeded',
      result: 'replacement finished'
    })
  ).toMatchObject({ action: 'settled', outcome: 'succeeded' })
}

describe('questions after an unobserved prompt stall', () => {
  it('keeps a question asked before stall answerable while capability is retained', () => {
    db = new OrchestrationDb(':memory:')
    const started = startAskableWorker()
    const created = ask(started.runId, started.dispatchId)

    db.failWorkerStart(started.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })

    expect(db.getDispatchContextById(started.dispatchId)).toMatchObject({
      status: 'failed',
      capability_revoked_at: null
    })
    expect(db.getActiveDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)?.id).toBe(started.dispatchId)
    expect(db.getQuestion(created.message.id)?.status).toBe('pending')
    expect(answer(started.runId, started.generation, created.message.id).question.status).toBe(
      'answered'
    )
    expect(answer(started.runId, started.generation, created.message.id).duplicate).toBe(true)
  })

  it('accepts a new question after stall while capability is retained', () => {
    db = new OrchestrationDb(':memory:')
    const started = startAskableWorker()
    db.failWorkerStart(started.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })

    const created = ask(started.runId, started.dispatchId, 'still blocked?')
    expect(created.question.status).toBe('pending')
    expect(answer(started.runId, started.generation, created.message.id).duplicate).toBe(false)
  })

  it('closes questions when the stall revokes capability', () => {
    db = new OrchestrationDb(':memory:')
    const started = startAskableWorker()
    const created = ask(started.runId, started.dispatchId)
    db.failWorkerStart(started.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR)

    expect(db.getQuestion(created.message.id)?.status).toBe('closed')
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(() => answer(started.runId, started.generation, created.message.id)).toThrow(/inactive/)
    expect(() => ask(started.runId, started.dispatchId)).toThrow(/not active/)
  })

  it('closes questions when stop reaches a retained stall', () => {
    db = new OrchestrationDb(':memory:')
    const started = startAskableWorker()
    const created = ask(started.runId, started.dispatchId)
    db.failWorkerStart(started.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    expect(db.beginWorkerStop(started.dispatchId, 'epoch').disposition).toBe('stopping')

    expect(db.getQuestion(created.message.id)?.status).toBe('closed')
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(() => ask(started.runId, started.dispatchId)).toThrow(/not active/)
  })

  it('closes questions on abandon of a retained stall', () => {
    db = new OrchestrationDb(':memory:')
    const started = startAskableWorker()
    const created = ask(started.runId, started.dispatchId)
    db.failWorkerStart(started.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    expect(db.abandonWorkerDispatch(started.dispatchId).disposition).toBe('abandoned')

    expect(db.getQuestion(created.message.id)?.status).toBe('closed')
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
  })

  it('rejects a question for a foreign dispatch', () => {
    db = new OrchestrationDb(':memory:')
    const owner = startAskableWorker('owner')
    const foreignRun = db.createRun({
      objective: 'foreign',
      coordinatorHandle: 'term_other_coord',
      coordinatorPaneKey: 'tab_other:22222222-2222-4222-8222-222222222222'
    })
    const foreignTask = db.createTask({ spec: 'foreign', runId: foreignRun.id })
    const foreign = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: foreignTask.id,
      startOptions: {}
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: foreign.dispatch.id,
      handle: 'term_foreign',
      paneKey: 'tab_foreign:cccccccccccccccc-cccc-4ccc-8ccc-cccccccccccc',
      processIncarnation: 'runtime_test:term_foreign:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_foreign' }]
    })
    expect(() =>
      db.createQuestion({
        runId: owner.runId,
        dispatchId: foreign.dispatch.id,
        askerHandle: WORKER,
        question: 'wrong run'
      })
    ).toThrow(/not active/)
  })

  it('rejects a new question after a superseding dispatch owns the pane', () => {
    db = new OrchestrationDb(':memory:')
    const first = startAskableWorker('first')
    const pending = ask(first.runId, first.dispatchId, 'before successor')
    db.failWorkerStart(first.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    const liveSuccessor = attachSuccessor(first.runId, 'live-successor')

    expect(db.getAskableDispatchForIdentity(WORKER, PANE)?.id).toBe(liveSuccessor)
    expect(() => ask(first.runId, first.dispatchId)).toThrow(/not active/)
    expect(() => answer(first.runId, first.generation, pending.message.id)).toThrow(/inactive/)
    expect(ask(first.runId, liveSuccessor).question.dispatch_id).toBe(liveSuccessor)
  })

  it('does not resurrect a stalled dispatch after its successor has terminated', () => {
    db = new OrchestrationDb(':memory:')
    const first = startAskableWorker('first-terminated')
    const pending = ask(first.runId, first.dispatchId)
    db.failWorkerStart(first.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    terminateSuccessor(attachSuccessor(first.runId, 'done-successor'))

    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(() => ask(first.runId, first.dispatchId)).toThrow(/not active/)
    expect(() => answer(first.runId, first.generation, pending.message.id)).toThrow(/inactive/)
  })

  it('does not resurrect a stall after a later occupant of the same pane terminates under a new handle', () => {
    db = new OrchestrationDb(':memory:')
    const first = startAskableWorker('old-handle')
    const pending = ask(first.runId, first.dispatchId)
    db.failWorkerStart(first.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    terminateSuccessor(attachSuccessor(first.runId, 'reminted-handle', 'term_reminted', PANE))

    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(db.getAskableDispatchForIdentity('term_reminted', PANE)).toBeUndefined()
    expect(() => ask(first.runId, first.dispatchId)).toThrow(/not active/)
    expect(() => answer(first.runId, first.generation, pending.message.id)).toThrow(/inactive/)
  })

  it('treats a reminted equivalent pane as the same occupancy', () => {
    db = new OrchestrationDb(':memory:')
    const first = startAskableWorker('equivalent-pane')
    const pending = ask(first.runId, first.dispatchId)
    db.failWorkerStart(first.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    const remintedPane = 'tab_reminted:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    terminateSuccessor(
      attachSuccessor(first.runId, 'equivalent-successor', 'term_reminted', remintedPane)
    )

    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(db.getAskableDispatchForIdentity('term_reminted', remintedPane)).toBeUndefined()
    expect(() => ask(first.runId, first.dispatchId)).toThrow(/not active/)
    expect(() => answer(first.runId, first.generation, pending.message.id)).toThrow(/inactive/)
  })

  it('keeps a stall askable when a later dispatch occupies a foreign pane', () => {
    db = new OrchestrationDb(':memory:')
    const first = startAskableWorker('isolated-pane')
    const pending = ask(first.runId, first.dispatchId)
    db.failWorkerStart(first.dispatchId, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    terminateSuccessor(
      attachSuccessor(
        first.runId,
        'other-pane',
        'term_other',
        'tab_other:cccccccccccccccc-cccc-4ccc-8ccc-cccccccccccc'
      )
    )

    expect(db.getAskableDispatchForIdentity(WORKER, PANE)?.id).toBe(first.dispatchId)
    expect(answer(first.runId, first.generation, pending.message.id).question.status).toBe(
      'answered'
    )
  })

  it('does not treat other retained failures or tokenless stalls as askable', () => {
    db = new OrchestrationDb(':memory:')
    const other = startAskableWorker('other-failure')
    const otherQuestion = ask(other.runId, other.dispatchId)
    db.failWorkerStart(other.dispatchId, 'agent_readiness', 'Agent did not become ready.', {
      retainCapability: true
    })
    expect(db.getQuestion(otherQuestion.message.id)?.status).toBe('closed')
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()

    const tokenlessTask = db.createTask({ spec: 'tokenless', runId: other.runId })
    const tokenless = db.createStartingWorkerDispatch({
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      taskId: tokenlessTask.id,
      startOptions: {}
    })
    db.failWorkerStart(tokenless.dispatch.id, 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, {
      retainCapability: true
    })
    expect(db.getAskableDispatchForIdentity(WORKER, PANE)).toBeUndefined()
    expect(() => ask(other.runId, tokenless.dispatch.id)).toThrow(/not active/)
  })

  it('keeps a remote question pending and routed after a retained stall', () => {
    db = new OrchestrationDb(':memory:')
    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_stalled',
      taskId: 'task_stalled',
      homePeerFingerprint: 'home_peer',
      protocolVersion: 3,
      runtimeEpoch: 'worker_runtime',
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: 'attach_stalled',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach_stalled_payload'
      }
    })
    db.prepareRemoteAttachmentAuthority({
      dispatchId: 'ctx_stalled',
      paneKey: PANE,
      processIncarnation: INCARNATION,
      worktreeId: 'repo::worktree',
      terminalHandle: WORKER,
      setupState: 'completed',
      effects: [{ kind: 'terminal', action: 'created', id: WORKER }]
    })
    const relay = db.enqueueFederationRelay({
      dispatchId: 'ctx_stalled',
      direction: 'to_home',
      kind: 'question',
      payload: JSON.stringify({ type: 'question' }),
      remoteQuestion: true
    })
    db.failRemoteAttachment('ctx_stalled', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })

    expect(db.getRemoteQuestion(relay.message_id)?.status).toBe('pending')
    expect(db.findActiveRemoteAttachmentForPane(PANE)?.dispatch_id).toBe('ctx_stalled')
    db.answerRemoteQuestion({
      messageId: relay.message_id,
      dispatchId: 'ctx_stalled',
      answerMessageId: 'msg_answer',
      body: 'yes'
    })
    expect(db.getRemoteQuestion(relay.message_id)?.status).toBe('answered')
    const later = db.enqueueFederationRelay({
      dispatchId: 'ctx_stalled',
      direction: 'to_home',
      kind: 'question',
      payload: JSON.stringify({ type: 'question', later: true }),
      remoteQuestion: true
    })
    expect(db.getRemoteQuestion(later.message_id)?.status).toBe('pending')
    expect(db.findActiveRemoteAttachmentForPane(PANE)?.dispatch_id).toBe('ctx_stalled')
  })

  it('does not route a remote stall after stop or revoke', () => {
    db = new OrchestrationDb(':memory:')
    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_stop',
      taskId: 'task_stop',
      homePeerFingerprint: 'home_peer',
      protocolVersion: 3,
      runtimeEpoch: 'worker_runtime',
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: 'attach_stop',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach_stop_payload'
      }
    })
    db.prepareRemoteAttachmentAuthority({
      dispatchId: 'ctx_stop',
      paneKey: PANE,
      processIncarnation: INCARNATION,
      worktreeId: 'repo::worktree',
      terminalHandle: WORKER,
      setupState: 'completed',
      effects: [{ kind: 'terminal', action: 'created', id: WORKER }]
    })
    db.failRemoteAttachment('ctx_stop', 'dispatch_input', AGENT_PROMPT_STALLED_ERROR, false, {
      retainCapability: true
    })
    db.beginRemoteAttachmentStop('ctx_stop')
    expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
    // Occupancy holds until stop is confirmed: beginStop fences routing but does
    // not prove the process exited, so a contender on this pane must wait.
    db.settleRemoteAttachmentStop('ctx_stop')

    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_revoked',
      taskId: 'task_revoked',
      homePeerFingerprint: 'home_peer',
      protocolVersion: 3,
      runtimeEpoch: 'worker_runtime',
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: 'attach_revoked',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach_revoked_payload'
      }
    })
    db.prepareRemoteAttachmentAuthority({
      dispatchId: 'ctx_revoked',
      paneKey: PANE,
      processIncarnation: INCARNATION,
      worktreeId: 'repo::worktree',
      terminalHandle: WORKER,
      setupState: 'completed',
      effects: [{ kind: 'terminal', action: 'created', id: WORKER }]
    })
    db.failRemoteAttachment('ctx_revoked', 'agent_readiness', 'Agent did not become ready.', false)
    expect(db.findActiveRemoteAttachmentForPane(PANE)).toBeUndefined()
  })
})
