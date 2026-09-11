import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { createPersistedSchemaFixture } from './persisted-schema-test-fixture'
import { readArchivedWorkerOutput } from '../../../rpc/methods/orchestration/worker/worker-archive-read'

describe('real constructor admission of published schema39', () => {
  let directory: string
  let db: OrchestrationDb | undefined
  function fixture(): string {
    directory = mkdtempSync(join(tmpdir(), 'orca-real-admission39-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    return path
  }
  function edit(path: string, sql: string): void {
    const raw = new Database(path)
    try {
      raw.exec(sql)
    } finally {
      raw.close()
    }
  }
  afterEach(() => {
    vi.restoreAllMocks()
    db?.close()
    db = undefined
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('opens39 without rebuilding schema or touching opaque history and orphan facts', () => {
    const path = fixture()
    const raw = new Database(path, { readonly: true })
    const schema = raw.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    const facts = raw.prepare('SELECT * FROM attempt_observation_facts').all()
    const journal = raw.prepare('SELECT * FROM worker_terminal_archives').all()
    raw.close()
    const create = vi.spyOn(OrchestrationDb.prototype, 'createTables')
    const migrate = vi.spyOn(OrchestrationDb.prototype, 'migrate')
    db = new OrchestrationDb(path)
    expect(db.db.pragma('user_version', { simple: true })).toBe(39)
    expect(db.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema)
    expect(db.db.prepare('SELECT * FROM attempt_observation_facts').all()).toEqual(facts)
    expect(db.db.prepare('SELECT * FROM worker_terminal_archives').all()).toEqual(journal)
    expect(create).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
    expect(db.getOrCreateRunDelivery({ runId: 'r1', consumerGeneration: 7 })?.delivery.id).toBe(
      'run-delivery'
    )
  })

  it.each(['starting', 'ready', 'failed', 'succeeded', 'stop_unknown'])(
    'rejects an unreleased structured resource even when worker state is %s',
    (state) => {
      const path = fixture()
      edit(
        path,
        `
        INSERT INTO worker_dispatches (dispatch_id, state) VALUES ('d1', '${state}');
        INSERT INTO worker_terminal_resources
          (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, process_incarnation)
          VALUES ('resource1', 'd1', 'd1', 'worker', 'structured:session:generation');
      `
      )
      const before = readFileSync(path)
      expect(() => {
        db = new OrchestrationDb(path)
      }).toThrow(/structured/i)
      expect(readFileSync(path).equals(before)).toBe(true)
    }
  )

  it('admits ordinary PTY resources without treating their absence as process death', () => {
    const path = fixture()
    edit(
      path,
      `
      INSERT INTO worker_dispatches (dispatch_id, state) VALUES ('d1', 'stop_unknown');
      INSERT INTO worker_terminal_resources
        (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, process_incarnation, host_scope)
        VALUES ('resource1', 'd1', 'd1', 'worker', 'pty:incarnation', 'ssh:offline');
    `
    )
    db = new OrchestrationDb(path)
    expect(db.getWorkerDispatch('d1')?.state).toBe('stop_unknown')
    expect(db.getWorkerTerminalResource('resource1')).toMatchObject({
      ownership_state: 'owned',
      release_state: 'not_requested',
      host_scope: 'ssh:offline'
    })
  })

  it.each([
    'ALTER TABLE worker_terminal_resources DROP COLUMN endpoint_id',
    'ALTER TABLE dispatch_contexts DROP COLUMN creator_handle',
    'DROP TABLE structured_pointer_operations',
    'DROP TABLE attempt_observation_facts',
    'DROP INDEX idx_messages_pending_pointer_enter',
    'DROP TRIGGER trg_messages_route_coordinator_mail',
    "ALTER TABLE dispatch_contexts DROP COLUMN creator_handle; ALTER TABLE dispatch_contexts ADD COLUMN creator_handle TEXT DEFAULT 'invented'",
    'ALTER TABLE worker_terminal_resources DROP COLUMN endpoint_id; ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_id TEXT COLLATE NOCASE',
    'CREATE TRIGGER unknown_writer AFTER INSERT ON messages BEGIN DELETE FROM unknown_fork_facts; END'
  ])('refuses incomplete39 before repairing %s', (sql) => {
    const path = fixture()
    edit(path, sql)
    const before = readFileSync(path)
    expect(() => {
      db = new OrchestrationDb(path)
    }).toThrow()
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('admits released history but refuses a malformed journal at the action reader', async () => {
    const path = fixture()
    edit(
      path,
      `
      INSERT INTO worker_dispatches (dispatch_id, state) VALUES ('d1', 'succeeded');
      INSERT INTO worker_terminal_resources
        (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, process_incarnation,
         ownership_state, release_state)
        VALUES ('resource1', 'd1', 'd1', 'structworker_old', 'structured:historic', 'released', 'released');
    `
    )
    const before = readFileSync(path)
    db = new OrchestrationDb(path)
    await expect(
      readArchivedWorkerOutput({
        db,
        dispatchId: 'd1',
        workerState: 'succeeded',
        resource: db.getWorkerTerminalResource('resource1')!
      })
    ).rejects.toMatchObject({ code: 'archive_unavailable' })
    db.close()
    db = undefined
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it.each([
    "UPDATE runs SET coordinator_handle = 'structworker_coordinator' WHERE id = 'r1'",
    "INSERT INTO dispatch_contexts (id, task_id, assignee_handle) VALUES ('active', 'missing-task', 'structworker_broken')",
    "INSERT INTO remote_dispatch_attachments (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, process_incarnation) VALUES ('active', 'missing-task', 'peer', 'epoch', 'structured:')"
  ])('rejects active structured bindings even without resource rows: %s', (sql) => {
    const path = fixture()
    edit(path, sql)
    const before = readFileSync(path)
    expect(() => {
      db = new OrchestrationDb(path)
    }).toThrow(/structured/i)
    expect(readFileSync(path).equals(before)).toBe(true)
  })

  it('backfills current coordinator handle memory without replacing the F routing trigger', () => {
    const path = fixture()
    edit(
      path,
      `UPDATE runs SET coordinator_handle = 'coordinator' WHERE id = 'r1';
      DELETE FROM run_coordinator_handles WHERE run_id = 'r1'`
    )
    db = new OrchestrationDb(path)
    expect(
      db.db.prepare("SELECT terminal_handle FROM run_coordinator_handles WHERE run_id = 'r1'").get()
    ).toEqual({ terminal_handle: 'coordinator' })
    const message = db.insertMessage({
      runId: 'r1',
      from: 'sender',
      to: 'coordinator',
      subject: 'route me'
    })
    expect(db.getMessageById(message.id)?.to_handle).toBe('run:r1')
    expect(db.getMessageById('worker-mail')?.to_handle).toBe('dispatch:d1')
  })
})
