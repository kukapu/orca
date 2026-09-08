import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReportFact,
  reportMessage,
  seedLegacyReportPrincipal,
  workerReportPersistedFixture
} from './worker-report-persisted-test-fixture'

describe('persisted report facts through relay and legacy direct transactions', () => {
  let fixture: ReturnType<typeof workerReportPersistedFixture>
  afterEach(() => fixture?.close())

  function relay(outcome: 'succeeded' | 'failed' = 'succeeded') {
    return {
      dispatchId: 'd1',
      sequence: 1,
      message: reportMessage(outcome),
      lifecycle: { kind: 'worker_report' as const, taskId: 't1', outcome, result: 'Report' }
    }
  }

  function legacy(outcome: 'succeeded' | 'failed' = 'succeeded', existingId?: string) {
    return {
      principalId: 'principal1',
      operationKey: 'operation1',
      method: 'orchestration.send',
      payloadHash: 'payload1',
      message: { ...reportMessage(outcome), existingId },
      lifecycle: { kind: 'worker_report' as const, taskId: 't1', outcome, result: 'Report' }
    }
  }

  it.each(['succeeded', 'failed'] as const)(
    'imports and replays federated %s using the stored message time',
    (outcome) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      const first = db.importFederatedRelayItem(relay(outcome))
      expect(first.lifecycle).toMatchObject({ action: 'settled', outcome, duplicate: false })
      assertReportFact(db, first.message, outcome)
      const before = db.db
        .prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence')
        .all()
      expect(db.importFederatedRelayItem(relay(outcome))).toMatchObject({
        duplicate: true,
        lifecycle: { duplicate: true }
      })
      expect(
        db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
      ).toEqual(before)
      expect(db.getFederatedDispatch('d1')?.to_home_imported_sequence).toBe(1)
    }
  )

  it('rolls back relay message, cursor and lifecycle when fact storage fails', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    db.db.exec(
      "CREATE TRIGGER fail_report BEFORE INSERT ON attempt_observation_facts BEGIN SELECT RAISE(ABORT, 'fact failure'); END"
    )
    expect(() => db.importFederatedRelayItem(relay())).toThrow(/fact failure/)
    expect(db.getMessageById('report1')).toBeUndefined()
    expect(db.getFederatedDispatch('d1')?.to_home_imported_sequence).toBe(0)
    expect(db.getTask('t1')?.status).toBe('dispatched')
    expect(db.getWorkerDispatch('d1')?.state).toBe('ready')
  })

  it('does not record relay rejections or heartbeats as any observation facet', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
    db.importFederatedRelayItem({
      ...relay(),
      lifecycle: { kind: 'rejected', code: 'invalid_outcome', reason: 'Invalid' }
    })
    db.importFederatedRelayItem({
      ...relay(),
      sequence: 2,
      message: { ...reportMessage(), id: 'heartbeat', type: 'heartbeat' },
      lifecycle: { kind: 'heartbeat', at: '2026-09-01T00:00:00Z' }
    })
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
  })

  it.each(['succeeded', 'failed'] as const)(
    'commits legacy direct %s and replays its receipt exactly once',
    (outcome) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      seedLegacyReportPrincipal(db)
      const first = db.commitLegacyLifecycleOperation(legacy(outcome))
      expect(first.message.delivery_contract).toBe('legacy_direct')
      assertReportFact(db, first.message, outcome)
      const before = db.db
        .prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence')
        .all()
      expect(db.commitLegacyLifecycleOperation(legacy(outcome))).toMatchObject({
        duplicate: true,
        settlement: { outcome }
      })
      expect(
        db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
      ).toEqual(before)
      expect(db.getLegacyCompatibilityPrincipal('principal1')?.status).toBe('settled')
    }
  )

  it.each(['succeeded', 'failed'] as const)(
    'preserves pre-receipt %s without upgrading unstructured results into accepted facts',
    (outcome) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      seedLegacyReportPrincipal(db)
      const message = db.insertMessage({
        ...reportMessage(outcome),
        deliveryContract: 'legacy_direct'
      })
      db.settleWorkerReport({ taskId: 't1', dispatchId: 'd1', outcome, result: 'Original report' })
      const replay = legacy(outcome === 'failed' ? 'succeeded' : 'failed', message.id)
      expect(db.commitLegacyLifecycleOperation(replay).settlement).toEqual({
        action: 'settled',
        outcome,
        duplicate: true
      })
      expect(
        db.db.prepare("SELECT * FROM attempt_observation_facts WHERE facet = 'worker_report'").all()
      ).toEqual([])
      expect(db.getTask('t1')?.result).toBe('Original report')
    }
  )

  it('bridges a preexisting accepted receipt without manufacturing success from retry input', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    seedLegacyReportPrincipal(db)
    const first = db.commitLegacyLifecycleOperation(legacy('failed'))
    db.db.exec("DELETE FROM attempt_observation_facts WHERE facet = 'worker_report'")
    const replay = db.commitLegacyLifecycleOperation(legacy('succeeded'))
    expect(replay).toMatchObject({ duplicate: true, settlement: { outcome: 'failed' } })
    assertReportFact(db, first.message, 'failed')
  })

  it('does not manufacture a report fact from settled status and an ordinary legacy message', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    seedLegacyReportPrincipal(db)
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
    const message = db.insertMessage({
      ...reportMessage(),
      type: 'status',
      deliveryContract: 'legacy_direct'
    })
    db.settleWorkerReport({
      taskId: 't1',
      dispatchId: 'd1',
      outcome: 'succeeded',
      result: 'Manual settlement'
    })
    db.commitLegacyLifecycleOperation(legacy('succeeded', message.id))
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
  })

  it('rolls back legacy fact and lifecycle if receipt insertion fails later', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    seedLegacyReportPrincipal(db)
    db.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON legacy_operation_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END"
    )
    const before = db.db.prepare('SELECT * FROM messages ORDER BY sequence').all()
    expect(() => db.commitLegacyLifecycleOperation(legacy())).toThrow(/receipt failure/)
    expect(db.getTask('t1')?.status).toBe('dispatched')
    expect(db.getWorkerDispatch('d1')?.state).toBe('ready')
    expect(db.getLegacyCompatibilityPrincipal('principal1')?.status).toBe('committed')
    expect(db.db.prepare('SELECT * FROM messages ORDER BY sequence').all()).toEqual(before)
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toHaveLength(1)
  })

  it('never turns an already rejected relay message into an accepted fact on replay', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
    db.importFederatedRelayItem({
      ...relay(),
      lifecycle: { kind: 'rejected', code: 'inactive_dispatch', reason: 'Rejected earlier' }
    })
    db.settleWorkerReport({
      taskId: 't1',
      dispatchId: 'd1',
      outcome: 'succeeded',
      result: 'Other settlement'
    })
    db.importFederatedRelayItem(relay())
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
  })

  it('never bridges an already rejected legacy message during persistedOutcome reconstruction', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    seedLegacyReportPrincipal(db)
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
    const message = db.insertMessage({ ...reportMessage(), deliveryContract: 'legacy_direct' })
    db.convertLifecycleMessageToRejection(message.id, 'inactive_dispatch', 'Rejected earlier')
    db.settleWorkerReport({
      taskId: 't1',
      dispatchId: 'd1',
      outcome: 'succeeded',
      result: 'Other settlement'
    })
    db.commitLegacyLifecycleOperation(legacy('succeeded', message.id))
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
  })

  it('rejects incompatible persisted facts during legacy receipt replay', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    seedLegacyReportPrincipal(db)
    db.commitLegacyLifecycleOperation(legacy('failed'))
    db.db.exec(
      "UPDATE attempt_observation_facts SET authority_id = 'wrong' WHERE facet = 'worker_report'"
    )
    expect(() => db.commitLegacyLifecycleOperation(legacy('failed'))).toThrow(
      /replayed with different content/
    )
    expect(() => db.db.exec('BEGIN IMMEDIATE; ROLLBACK')).not.toThrow()
  })
})
