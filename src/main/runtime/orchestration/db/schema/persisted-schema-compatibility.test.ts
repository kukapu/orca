import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { createPersistedSchemaFixture } from './persisted-schema-test-fixture'
import { getSchema39ReferenceShape } from './persisted-schema39-shape'

describe('persisted orchestration schema admission', () => {
  const directories: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function fixture(version: 30 | 39): string {
    const directory = mkdtempSync(join(tmpdir(), 'orca-schema-admission-'))
    directories.push(directory)
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, version)
    return path
  }

  function editFixture(path: string, sql: string): void {
    const db = new Database(path)
    try {
      db.exec(sql)
    } finally {
      db.close()
    }
  }

  function expectUntouchedRejection(path: string): void {
    getSchema39ReferenceShape()
    const before = readFileSync(path)
    const walBefore = existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`) : undefined
    const hadShm = existsSync(`${path}-shm`)
    const exec = vi.spyOn(Database.prototype, 'exec')
    const pragma = vi.spyOn(Database.prototype, 'pragma')
    const close = vi.spyOn(Database.prototype, 'close')
    let opened: OrchestrationDb | undefined
    let error: unknown
    try {
      opened = new OrchestrationDb(path)
    } catch (caught) {
      error = caught
    } finally {
      opened?.close()
    }
    expect(error).toMatchObject({ code: 'unsupported_persisted_schema' })
    expect(exec).not.toHaveBeenCalled()
    expect(pragma.mock.calls.every(([sql]) => !sql.includes('='))).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    expect(readFileSync(path).equals(before)).toBe(true)
    if (walBefore) {
      expect(readFileSync(`${path}-wal`).equals(walBefore)).toBe(true)
    } else {
      expect(existsSync(`${path}-wal`)).toBe(false)
    }
    expect(existsSync(`${path}-shm`)).toBe(hadShm)
    vi.restoreAllMocks()
  }

  it('admits a physical stable30 fixture, migrates to official40, and keeps durable Run ACK/replay', () => {
    const path = fixture(30)
    let db = new OrchestrationDb(path)
    let deliveryId: string
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(40)
      expect(db.hasColumn('deliveries', 'mailbox_handle')).toBe(true)
      expect(db.hasColumn('messages', 'pointer_enter_pending')).toBe(true)
      const batch = db.getOrCreateRunDelivery({ runId: 'r1', consumerGeneration: 7 })!
      expect(batch.messages.map((message) => message.id)).toEqual(['run-mail'])
      deliveryId = batch.delivery.id
    } finally {
      db.close()
    }
    db = new OrchestrationDb(path)
    try {
      const replay = db.getOrCreateRunDelivery({ runId: 'r1', consumerGeneration: 7 })!
      expect(replay.replayed).toBe(true)
      expect(replay.delivery.id).toBe(deliveryId)
      db.acknowledgeRunDelivery({ runId: 'r1', consumerGeneration: 7, deliveryId })
      expect(db.db.prepare('SELECT read FROM messages WHERE id = ?').get('worker-mail')).toEqual({
        read: 0
      })
      expect(db.db.prepare('SELECT * FROM unknown_fork_facts').get()).toEqual({
        id: 'unknown1',
        payload: 'opaque',
        extra: 'keep'
      })
      expect(db.db.pragma('user_version', { simple: true })).toBe(40)
    } finally {
      db.close()
    }
  })

  function expectUntouchedAdmission(path: string): void {
    const before = readFileSync(path)
    const opened = new OrchestrationDb(path)
    try {
      expect(opened.db.pragma('user_version', { simple: true })).toBe(39)
    } finally {
      opened.close()
    }
    expect(readFileSync(path).equals(before)).toBe(true)
  }

  it('admits validated39 without changing the physical fixture bytes', () => {
    expectUntouchedAdmission(fixture(39))
  })

  it('does not checkpoint a rejected39 WAL snapshot while closing the probe', () => {
    const source = fixture(39)
    const snapshot = `${source}.snapshot`
    const writer = new Database(source)
    try {
      writer.pragma('journal_mode = WAL')
      writer.exec("UPDATE unknown_fork_facts SET payload = 'uncheckpointed fact'")
      writer.exec('DROP INDEX idx_messages_pending_pointer_enter')
      for (const suffix of ['', '-wal', '-shm']) {
        copyFileSync(`${source}${suffix}`, `${snapshot}${suffix}`)
      }
    } finally {
      writer.close()
    }
    expectUntouchedRejection(snapshot)
  })

  it.each([1, 2, 3])('admits39 preserving pending Enter phase %s without replay', (phase) => {
    const path = fixture(39)
    editFixture(
      path,
      `
      UPDATE messages SET pointer_enter_pending = ${phase}, pointer_pty_id = 'pty1',
        pointer_process_incarnation = 'incarnation1' WHERE id = 'worker-mail';
    `
    )
    expectUntouchedAdmission(path)
  })

  it('preserves ambiguous blank deliveries at open and refuses to consume them', () => {
    const path = fixture(39)
    editFixture(
      path,
      `
      UPDATE deliveries SET mailbox_handle = '';
      INSERT INTO deliveries (id, run_id, consumer_generation, message_ids)
        VALUES ('ambiguous', 'r1', 7, '["run-mail","worker-mail"]');
    `
    )
    expectUntouchedAdmission(path)
    const opened = new OrchestrationDb(path)
    try {
      expect(() => opened.getOrCreateRunDelivery({ runId: 'r1', consumerGeneration: 7 })).toThrow()
    } finally {
      opened.close()
    }
  })

  it.each([31, 38, 40, 999])('rejects unsupported version %s without writes', (version) => {
    const path = fixture(39)
    editFixture(path, `PRAGMA user_version = ${version}`)
    expectUntouchedRejection(path)
  })

  it('rejects incomplete39 before createTables can replace missing tables or indexes', () => {
    const path = fixture(39)
    editFixture(
      path,
      `
      DROP INDEX idx_deliveries_one_outstanding;
      DROP TABLE structured_pointer_operations;
    `
    )
    expectUntouchedRejection(path)
  })

  it.each([0, 30])(
    'rejects a fork39 shape stamped %s instead of running legacy repair',
    (version) => {
      const path = fixture(39)
      editFixture(path, `PRAGMA user_version = ${version}`)
      expectUntouchedRejection(path)
    }
  )

  it.each([
    'ALTER TABLE messages ADD COLUMN pointer_pty_id TEXT',
    "ALTER TABLE deliveries ADD COLUMN mailbox_handle TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE dispatch_contexts ADD COLUMN creator_handle TEXT',
    'ALTER TABLE remote_dispatch_attachments ADD COLUMN consumer_generation INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_id TEXT',
    'CREATE TABLE attempt_observation_facts (id TEXT PRIMARY KEY)',
    'CREATE TABLE structured_pointer_operations (mailbox_handle TEXT PRIMARY KEY)',
    'CREATE TABLE lifecycle_transition_receipts (id TEXT PRIMARY KEY)',
    `DROP TABLE worker_terminal_archives;
     CREATE TABLE worker_terminal_archives (
       dispatch_id TEXT PRIMARY KEY,
       resource_id TEXT NOT NULL,
       kind TEXT NOT NULL CHECK(kind IN ('transcript_pin', 'terminal_tail', 'structured_journal')),
       content TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ])('rejects incomplete fork evidence on a physical30 schema: %s', (sql) => {
    const path = fixture(30)
    editFixture(path, sql)
    expectUntouchedRejection(path)
  })

  it('does not let an admitted30 connection authorize an incomplete39 connection', () => {
    const stablePath = fixture(30)
    const forkPath = fixture(39)
    editFixture(forkPath, 'DROP TABLE structured_pointer_operations')
    const stable = new OrchestrationDb(stablePath)
    try {
      expectUntouchedRejection(forkPath)
      expect(stable.getRun('r1')?.objective).toBe('Fixture Run')
    } finally {
      stable.close()
    }
  })
})
