import { afterEach, describe, expect, it } from 'vitest'
import { reconcileLifecycleMessage } from '../lifecycle-reconciliation'
import { workerReportObservation } from '../worker-report-observation'
import { AGENT_PROMPT_STALLED_ERROR } from '../../agent-prompt-submission-verification'
import { openPersistedSchemaMethodsFixture } from './schema/persisted-schema-test-fixture'
import {
  assertReportFact,
  reportMessage,
  workerReportPersistedFixture
} from './worker-report-persisted-test-fixture'

describe('accepted report bridge on physical persisted DB39', () => {
  let fixture: ReturnType<typeof workerReportPersistedFixture>
  afterEach(() => fixture?.close())

  it.each(['succeeded', 'failed'] as const)(
    'persists %s with the exact F contract and stable replay',
    (outcome) => {
      fixture = workerReportPersistedFixture()
      const { db, path } = fixture
      const prior = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
      const schema = db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
      db.insertMessage(reportMessage(outcome))
      db.db.exec("UPDATE messages SET created_at = '2026-09-01 12:34:56' WHERE id = 'report1'")
      const message = db.getMessageById('report1')!
      expect(reconcileLifecycleMessage(db, message).action).toBe(
        outcome === 'succeeded' ? 'completed' : 'failed'
      )
      assertReportFact(db, message, outcome)
      const facts = db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
      expect(facts[0]).toEqual(prior[0])
      expect(facts).toHaveLength(2)
      const reopened = openPersistedSchemaMethodsFixture(path)
      try {
        expect(
          reconcileLifecycleMessage(reopened, reopened.getMessageById(message.id)!).action
        ).toBe(outcome === 'succeeded' ? 'completed' : 'failed')
        expect(
          reopened.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
        ).toEqual(facts)
        expect(reopened.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(
          schema
        )
        expect(reopened.db.pragma('user_version', { simple: true })).toBe(39)
      } finally {
        reopened.close()
      }
    }
  )

  it('accepts an exact F-persisted report even with later facts already present', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const message = db.insertMessage(reportMessage())
    db.db
      .prepare(`INSERT INTO attempt_observation_facts
      (id, dispatch_id, task_id, sequence, authority_id, authority_clock, facet, payload, home_received_at)
      VALUES ('worker_report:report1', 'd1', 't1', 3, 'run_home:r1', 'home', 'worker_report', ?, ?)`)
      .run(
        '{"outcome":"succeeded","reportId":"worker_report:report1","status":"accepted"}',
        Date.parse(message.created_at)
      )
    db.db.exec(
      "UPDATE tasks SET status = 'completed'; UPDATE dispatch_contexts SET status = 'completed'"
    )
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
    expect(reconcileLifecycleMessage(db, message).action).toBe('completed')
    expect(
      db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
    ).toEqual(before)
  })

  it.each([
    ['dispatch_id', 'other'],
    ['task_id', 'other'],
    ['authority_id', 'execution:other'],
    ['authority_clock', 'execution'],
    ['facet', 'outcome'],
    ['payload', '{"status":"missing"}'],
    ['source_observed_at', 1],
    ['execution_received_at', 1],
    ['home_received_at', 1]
  ] as const)(
    'rejects same-ID incompatible %s without IGNORE or partial lifecycle writes',
    (column, value) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      const message = db.insertMessage(reportMessage())
      reconcileLifecycleMessage(db, message)
      db.db
        .prepare(
          `UPDATE attempt_observation_facts SET ${column} = ? WHERE id = 'worker_report:report1'`
        )
        .run(value)
      db.db.exec(
        "UPDATE tasks SET status = 'dispatched'; UPDATE dispatch_contexts SET status = 'dispatched'; UPDATE worker_dispatches SET state = 'ready'"
      )
      const before = db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY id').all()
      expect(() => reconcileLifecycleMessage(db, message)).toThrow(
        /replayed with different content/
      )
      expect(db.getTask('t1')?.status).toBe('dispatched')
      expect(db.getDispatchContextById('d1')?.status).toBe('dispatched')
      expect(db.getWorkerDispatch('d1')?.state).toBe('ready')
      expect(db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY id').all()).toEqual(
        before
      )
      expect(() => db.db.exec('BEGIN IMMEDIATE; ROLLBACK')).not.toThrow()
    }
  )

  it('rolls back lifecycle, questions and dependency promotion on fact insertion failure', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const message = db.insertMessage(reportMessage())
    db.db
      .exec(`INSERT INTO tasks (id, run_id, spec, deps) VALUES ('dependent', 'r1', 'Next', '["t1"]');
      CREATE TRIGGER fail_report BEFORE INSERT ON attempt_observation_facts BEGIN SELECT RAISE(ABORT, 'fact failure'); END`)
    const question = db.createQuestion({
      runId: 'r1',
      dispatchId: 'd1',
      askerHandle: 'worker',
      question: 'Proceed?'
    })
    expect(() => reconcileLifecycleMessage(db, message)).toThrow(/fact failure/)
    expect(db.getTask('t1')?.status).toBe('dispatched')
    expect(db.getTask('dependent')?.status).toBe('pending')
    expect(db.getDispatchContextById('d1')?.capability_revoked_at).toBeNull()
    expect(db.getWorkerDispatch('d1')?.state).toBe('ready')
    expect(
      db.db
        .prepare('SELECT status FROM question_threads WHERE message_id = ?')
        .get(question.message.id)
    ).toEqual({ status: 'pending' })
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toHaveLength(1)
  })

  it('does not turn status-only settlement, heartbeats, or rejected messages into observations', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const before = db.db.prepare('SELECT * FROM attempt_observation_facts').all()
    const heartbeat = db.insertMessage({ ...reportMessage(), id: 'heartbeat', type: 'heartbeat' })
    expect(reconcileLifecycleMessage(db, heartbeat).action).toBe('heartbeat_recorded')
    const rejected = db.insertMessage({ ...reportMessage(), from: 'intruder' })
    expect(reconcileLifecycleMessage(db, rejected).action).toBe('rejected')
    db.settleWorkerReport({
      taskId: 't1',
      dispatchId: 'd1',
      outcome: 'succeeded',
      result: 'manual'
    })
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(before)
  })

  it('rejects invalid observation time atomically', () => {
    fixture = workerReportPersistedFixture()
    const { db } = fixture
    const message = db.insertMessage(reportMessage())
    expect(() =>
      db.settleWorkerReport({
        taskId: 't1',
        dispatchId: 'd1',
        outcome: 'succeeded',
        result: 'done',
        observation: { ...workerReportObservation(message)!, homeReceivedAt: Number.NaN }
      })
    ).toThrow(/Invalid worker report/)
    expect(db.getTask('t1')?.status).toBe('dispatched')
  })

  it('keeps the migrated DB30 schema unchanged while accepting a report', () => {
    fixture = workerReportPersistedFixture(30)
    const { db } = fixture
    const before = db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    const version = db.db.pragma('user_version', { simple: true })
    expect(reconcileLifecycleMessage(db, db.insertMessage(reportMessage())).action).toBe(
      'completed'
    )
    expect(db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(before)
    expect(db.db.pragma('user_version', { simple: true })).toBe(version)
  })

  it.each(['succeeded', 'failed'] as const)(
    'records a late %s report correcting an unobserved prompt',
    (outcome) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      db.db.exec(
        "UPDATE tasks SET status = 'failed'; UPDATE worker_dispatches SET state = 'failed'"
      )
      db.db
        .prepare("UPDATE dispatch_contexts SET status = 'failed', last_failure = ?")
        .run(AGENT_PROMPT_STALLED_ERROR)
      const message = db.insertMessage(reportMessage(outcome))
      expect(reconcileLifecycleMessage(db, message).action).toBe(
        outcome === 'succeeded' ? 'completed' : 'failed'
      )
      assertReportFact(db, message, outcome)
      expect(db.getWorkerDispatch('d1')?.state).toBe(outcome)
    }
  )
})
