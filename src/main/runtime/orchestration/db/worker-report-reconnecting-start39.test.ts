import { afterEach, describe, expect, it } from 'vitest'
import { reconcileLifecycleMessage } from '../lifecycle-reconciliation'
import {
  assertReportFact,
  reportMessage,
  workerReportPersistedFixture
} from './worker-report-persisted-test-fixture'

describe('DB39 reconnecting start accepted reports through the real constructor', () => {
  let fixture: ReturnType<typeof workerReportPersistedFixture>
  afterEach(() => fixture?.close())

  function open(dispatchStatus: 'pending' | 'dispatched') {
    fixture = workerReportPersistedFixture()
    fixture.db.db
      .prepare('UPDATE dispatch_contexts SET status = ? WHERE id = ?')
      .run(dispatchStatus, 'd1')
    fixture.db.db.exec(
      "UPDATE tasks SET status = 'blocked'; UPDATE worker_dispatches SET state = 'start_unknown'"
    )
    return fixture.reopen()
  }

  for (const path of ['local', 'relay'] as const) {
    for (const dispatchStatus of ['pending', 'dispatched'] as const) {
      it.each(['succeeded', 'failed'] as const)(
        `${path} ${dispatchStatus} accepts %s and replays once`,
        (outcome) => {
          const db = open(dispatchStatus)
          const params = {
            dispatchId: 'd1',
            sequence: 1,
            message: reportMessage(outcome),
            lifecycle: { kind: 'worker_report' as const, taskId: 't1', outcome, result: 'Report' }
          }
          const message =
            path === 'local'
              ? db.insertMessage(params.message)
              : db.importFederatedRelayItem(params).message
          if (path === 'local') {
            expect(reconcileLifecycleMessage(db, message).action).toBe(
              outcome === 'succeeded' ? 'completed' : 'failed'
            )
          }
          const status = outcome === 'succeeded' ? 'completed' : 'failed'
          expect(db.getTask('t1')?.status).toBe(status)
          expect(db.getDispatchContextById('d1')?.status).toBe(status)
          expect(db.getWorkerDispatch('d1')).toMatchObject({ state: outcome, stage: 'settled' })
          assertReportFact(db, message, outcome)
          const before = db.db
            .prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence')
            .all()
          if (path === 'local') {
            reconcileLifecycleMessage(db, message)
          } else {
            expect(db.importFederatedRelayItem(params)).toMatchObject({
              duplicate: true,
              lifecycle: { action: 'settled', duplicate: true }
            })
          }
          expect(
            db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
          ).toEqual(before)
        }
      )
    }
  }

  it('keeps assignee identity fencing on a reconnecting start', () => {
    const db = open('pending')
    const message = db.insertMessage({ ...reportMessage(), from: 'intruder' })
    expect(reconcileLifecycleMessage(db, message)).toMatchObject({
      action: 'rejected',
      code: 'sender_not_assignee'
    })
    expect(db.getTask('t1')?.status).toBe('blocked')
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toHaveLength(1)
  })

  it('keeps active sibling fencing on a reconnecting start', () => {
    const db = open('dispatched')
    db.db.exec(`INSERT INTO dispatch_contexts (id, run_id, task_id, assignee_handle, status)
      VALUES ('other', 'r1', 't1', 'other', 'dispatched');
      INSERT INTO worker_dispatches (dispatch_id, state) VALUES ('other', 'ready')`)
    expect(reconcileLifecycleMessage(db, db.insertMessage(reportMessage()))).toMatchObject({
      action: 'rejected',
      code: 'inactive_dispatch'
    })
    expect(db.getTask('t1')?.status).toBe('blocked')
    expect(db.getWorkerDispatch('d1')?.state).toBe('start_unknown')
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toHaveLength(1)
  })

  it.each(['ready', 'starting', 'stop_unknown'] as const)(
    'does not widen blocked recovery to worker=%s',
    (state) => {
      const db = open('pending')
      db.db.prepare('UPDATE worker_dispatches SET state = ?').run(state)
      expect(reconcileLifecycleMessage(db, db.insertMessage(reportMessage()))).toMatchObject({
        action: 'rejected',
        code: 'inactive_dispatch'
      })
      expect(db.getTask('t1')?.status).toBe('blocked')
    }
  )

  it('rolls back the reconnecting states and relay cursor when fact insertion fails', () => {
    const db = open('pending')
    db.db.exec(
      "CREATE TRIGGER fail_report BEFORE INSERT ON attempt_observation_facts BEGIN SELECT RAISE(ABORT, 'fact failure'); END"
    )
    expect(() =>
      db.importFederatedRelayItem({
        dispatchId: 'd1',
        sequence: 1,
        message: reportMessage(),
        lifecycle: { kind: 'worker_report', taskId: 't1', outcome: 'succeeded', result: 'Report' }
      })
    ).toThrow(/fact failure/)
    expect(db.getTask('t1')?.status).toBe('blocked')
    expect(db.getDispatchContextById('d1')?.status).toBe('pending')
    expect(db.getWorkerDispatch('d1')?.state).toBe('start_unknown')
    expect(db.getFederatedDispatch('d1')?.to_home_imported_sequence).toBe(0)
    expect(db.getMessageById('report1')).toBeUndefined()
  })
})
