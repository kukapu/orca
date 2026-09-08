import { afterEach, describe, expect, it } from 'vitest'
import { reconcileLifecycleMessage } from '../lifecycle-reconciliation'
import {
  assertReportFact,
  reportMessage,
  seedLegacyReportPrincipal,
  workerReportPersistedFixture
} from './worker-report-persisted-test-fixture'

describe('legacy accepted report evidence on real constructor DB39', () => {
  let fixture: ReturnType<typeof workerReportPersistedFixture>
  afterEach(() => fixture?.close())

  function setup(outcome: 'succeeded' | 'failed') {
    fixture = workerReportPersistedFixture()
    seedLegacyReportPrincipal(fixture.db)
    const message = fixture.db.insertMessage({
      ...reportMessage(outcome),
      deliveryContract: 'legacy_direct'
    })
    const params = {
      principalId: 'principal1',
      operationKey: 'reconstruct',
      method: 'orchestration.send',
      payloadHash: 'hash',
      message: { ...reportMessage(outcome), existingId: message.id },
      lifecycle: {
        kind: 'worker_report' as const,
        taskId: 't1',
        outcome,
        result: 'Requested result is not proof'
      }
    }
    return { message, params }
  }

  it.each(['failed', 'succeeded'] as const)(
    'stored unaccepted %s message cannot borrow later completed status, including receipt replay',
    (outcome) => {
      const { params } = setup(outcome)
      fixture.db.db.exec(
        "UPDATE tasks SET status = 'completed', result = 'Completed by another path'; UPDATE dispatch_contexts SET status = 'completed'"
      )
      const db = fixture.reopen()
      const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
      expect(db.getLegacyOperationReceipt('principal1', 'reconstruct')).toBeUndefined()
      const first = db.commitLegacyLifecycleOperation(params)
      expect(first.settlement).toEqual({ action: 'settled', outcome: 'succeeded', duplicate: true })
      expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
      expect(db.commitLegacyLifecycleOperation(params)).toMatchObject({
        duplicate: true,
        settlement: { outcome: 'succeeded' }
      })
      expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
    }
  )

  it.each([
    { messageId: 'other-report', outcome: 'succeeded', provenance: 'worker_report' },
    { messageId: 'report1', outcome: 'failed', provenance: 'worker_report' },
    { messageId: 'report1', outcome: 'succeeded', provenance: 'manual' }
  ])('rejects reconstruction evidence inconsistent with message: %j', (result) => {
    const { params } = setup('succeeded')
    fixture.db.db
      .prepare("UPDATE tasks SET status = 'completed', result = ?")
      .run(JSON.stringify(result))
    fixture.db.db.exec("UPDATE dispatch_contexts SET status = 'completed'")
    const db = fixture.reopen()
    db.commitLegacyLifecycleOperation(params)
    db.commitLegacyLifecycleOperation(params)
    expect(
      db.db.prepare("SELECT * FROM attempt_observation_facts WHERE facet = 'worker_report'").all()
    ).toEqual([])
  })

  it('does not treat matching accepted-result text as proof for a contradictory message outcome', () => {
    const { params } = setup('failed')
    fixture.db.db.prepare("UPDATE tasks SET status = 'completed', result = ?").run(
      JSON.stringify({
        provenance: 'worker_report',
        messageId: 'report1',
        outcome: 'succeeded'
      })
    )
    fixture.db.db.exec("UPDATE dispatch_contexts SET status = 'completed'")
    const db = fixture.reopen()
    db.commitLegacyLifecycleOperation(params)
    db.commitLegacyLifecycleOperation(params)
    expect(
      db.db.prepare("SELECT * FROM attempt_observation_facts WHERE facet = 'worker_report'").all()
    ).toEqual([])
  })

  it.each(['succeeded', 'failed'] as const)(
    'reconstructs proven accepted %s from persisted message and task result',
    (outcome) => {
      const { params, message } = setup(outcome)
      reconcileLifecycleMessage(fixture.db, message)
      fixture.db.db.exec("DELETE FROM attempt_observation_facts WHERE facet = 'worker_report'")
      const db = fixture.reopen()
      const retry = {
        ...params,
        lifecycle: {
          ...params.lifecycle,
          outcome: outcome === 'failed' ? ('succeeded' as const) : ('failed' as const)
        }
      }
      expect(db.commitLegacyLifecycleOperation(retry).settlement).toMatchObject({
        outcome,
        duplicate: true
      })
      assertReportFact(db, message, outcome)
      db.commitLegacyLifecycleOperation(retry)
      assertReportFact(db, message, outcome)
    }
  )
})
