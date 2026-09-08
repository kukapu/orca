import { afterEach, describe, expect, it } from 'vitest'
import { workerReportPersistedFixture } from '../worker-report-persisted-test-fixture'

describe('explicit resets of additive persisted storage', () => {
  let fixture: ReturnType<typeof workerReportPersistedFixture>
  afterEach(() => fixture?.close())

  it.each(['resetAll', 'resetTasks', 'resetMessages'] as const)(
    '%s clears only its documented scope on DB39',
    (reset) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      // Orphan facts must be cleared too, not merely those covered by F's delete triggers.
      db.db.exec(`INSERT INTO attempt_observation_facts
      (id, dispatch_id, task_id, sequence, authority_id, authority_clock, facet, payload, home_received_at)
      VALUES ('orphan', 'missing', 'missing', 0, 'home', 'home', 'outcome', '{}', 1)`)
      const facts = db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY id').all()
      const unknown = db.db.prepare('SELECT * FROM unknown_fork_facts').all()
      const schema = db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
      const messages = db.db.prepare('SELECT * FROM messages ORDER BY sequence').all()
      db[reset]()
      expect(db.db.prepare('SELECT * FROM structured_pointer_operations').all()).toEqual([])
      expect(db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY id').all()).toEqual(
        reset === 'resetMessages' ? facts : []
      )
      expect(db.db.prepare('SELECT * FROM unknown_fork_facts').all()).toEqual(unknown)
      expect(db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema)
      expect(db.db.prepare('SELECT * FROM messages ORDER BY sequence').all()).toEqual(
        reset === 'resetTasks' ? messages : []
      )
      expect(db.db.pragma('user_version', { simple: true })).toBe(39)
    }
  )

  it.each(['resetAll', 'resetTasks', 'resetMessages'] as const)(
    '%s restores additive and core rows on failure',
    (reset) => {
      fixture = workerReportPersistedFixture()
      const { db } = fixture
      const failedTable = reset === 'resetMessages' ? 'messages' : 'tasks'
      db.db.exec(
        `CREATE TRIGGER fail_reset BEFORE DELETE ON ${failedTable} BEGIN SELECT RAISE(ABORT, 'reset failure'); END`
      )
      const tables = [
        'attempt_observation_facts',
        'structured_pointer_operations',
        'tasks',
        'dispatch_contexts',
        'messages',
        'unknown_fork_facts'
      ]
      const before = tables.map((table) =>
        db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      )
      expect(() => db[reset]()).toThrow(/reset failure/)
      expect(
        tables.map((table) => db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
      ).toEqual(before)
      expect(() => db.db.exec('BEGIN IMMEDIATE; ROLLBACK')).not.toThrow()
    }
  )

  it.each(['resetAll', 'resetTasks', 'resetMessages'] as const)(
    '%s does not create missing DB30 tables',
    (reset) => {
      fixture = workerReportPersistedFixture(30)
      const { db } = fixture
      const schema = db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
      const unknown = db.db.prepare('SELECT * FROM unknown_fork_facts').all()
      db[reset]()
      expect(db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema)
      expect(db.db.prepare('SELECT * FROM unknown_fork_facts').all()).toEqual(unknown)
      expect(db.db.pragma('user_version', { simple: true })).toBe(30)
    }
  )
})
