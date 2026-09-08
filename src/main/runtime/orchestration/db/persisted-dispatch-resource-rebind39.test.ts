import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from './orchestration-db'
import { LEGACY_RUN_ID } from './contract-constants'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from './schema/persisted-schema-test-fixture'

describe('existing resource authority rebind, methods only', () => {
  let directory: string
  let db: OrchestrationDb
  const paths = ['mint', 'starting', 'remote'] as const
  type Path = (typeof paths)[number]
  const identity = {
    dispatchId: 'd1',
    paneKey: 'pane-worker',
    processIncarnation: 'process-current',
    terminalHandle: 'reminted-handle',
    handle: 'reminted-handle',
    worktreeId: 'folder-workspace',
    effects: [],
    setupState: 'ready'
  }
  function fixture(path: Path, version: 30 | 39 = 39) {
    directory = mkdtempSync(join(tmpdir(), 'orca-resource-rebind-'))
    const file = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(file, version)
    db = openPersistedSchemaMethodsFixture(file)
    db.db.exec(`
      DELETE FROM worker_terminal_archives;
      INSERT INTO tasks (id, run_id, spec) VALUES ('t1', 'r1', 'Task');
      INSERT INTO dispatch_contexts
        (id, task_id, run_id, status, assignee_handle, assignee_pane_key, process_incarnation)
        VALUES ('d1', 't1', 'r1', 'pending', 'old-handle', 'pane-worker', 'process-current');
      INSERT INTO worker_dispatches (dispatch_id, runtime_epoch) VALUES ('d1', 'local-epoch');
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, pane_key, process_incarnation)
        VALUES ('d1', 'remote-task', 'peer', 'remote-epoch', 'pane-worker', 'process-current');
    `)
    db.createWorkerTerminalResourceStatement({
      ...identity,
      terminalHandle: 'old-handle',
      ownership: 'owned',
      hostScope: 'ssh:host',
      endpointId: 'historical-epoch',
      endpointIncarnation: 'stale-endpoint-incarnation'
    })
    if (version === 39) {
      db.db.exec(`
        UPDATE dispatch_contexts SET consumer_generation = 7, host_scope = 'ssh:host';
        UPDATE remote_dispatch_attachments SET consumer_generation = 11;
      `)
      if (path === 'remote') {
        db.db
          .prepare(
            "UPDATE deliveries SET run_id = ?, consumer_generation = 11 WHERE id = 'worker-delivery'"
          )
          .run(LEGACY_RUN_ID)
      }
    }
  }
  function attach(path: Path, overrides: Partial<typeof identity> & { hostScope?: string } = {}) {
    const params = { ...identity, ...overrides }
    if (path === 'mint') {
      return db.mintDispatchCapability(params)
    }
    if (path === 'starting') {
      return db.prepareStartingWorkerAuthority(params)
    }
    return db.prepareRemoteAttachmentAuthority(params)
  }
  function snapshot() {
    return [
      'dispatch_contexts',
      'worker_dispatches',
      'remote_dispatch_attachments',
      'worker_terminal_resources',
      'worker_terminal_archives',
      'deliveries'
    ].map((table) => db.db.prepare(`SELECT * FROM ${table}`).all())
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  for (const version of [30, 39] as const) {
    it.each(paths)(`schema${version} %s repairs endpoints without ownership changes`, (path) => {
      fixture(path, version)
      attach(path)
      expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
        owner_dispatch_id: 'd1',
        origin_dispatch_id: 'd1',
        prior_owner_dispatch_ids: '[]',
        process_incarnation: 'process-current',
        host_scope: 'ssh:host',
        ownership_state: 'owned'
      })
      if (version === 39) {
        expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
          endpoint_id: path === 'remote' ? 'remote-epoch' : 'local-epoch',
          endpoint_incarnation: 'process-current'
        })
        expect(db.getDispatchContextById('d1')).toMatchObject({ host_scope: 'ssh:host' })
      }
    })
  }

  it.each(paths)('%s rejects replacing a historical process', (path) => {
    fixture(path)
    const before = snapshot()
    expect(() => attach(path, { processIncarnation: 'unproven-process' })).toThrow(
      'unproven identity'
    )
    expect(snapshot()).toEqual(before)
  })

  it.each(paths)('%s cannot rewrite an old resource onto another pane', (path) => {
    fixture(path)
    const before = snapshot()
    expect(() => attach(path, { paneKey: 'other-pane' })).toThrow('unproven identity')
    expect(snapshot()).toEqual(before)
  })

  it.each(['starting', 'remote'] as const)('%s cannot rewrite host scope', (path) => {
    fixture(path)
    const before = snapshot()
    expect(() => attach(path, { hostScope: 'ssh:other-host' })).toThrow('unproven identity')
    expect(snapshot()).toEqual(before)
  })

  it.each(paths)('%s outer rollback restores the resource and fence', (path) => {
    fixture(path)
    const before = snapshot()
    db.db.exec('BEGIN IMMEDIATE')
    attach(path)
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('fenced')
    db.db.exec('ROLLBACK')
    expect(snapshot()).toEqual(before)
  })

  it.each(paths)('%s resource rollback preserves the outer transaction', (path) => {
    fixture(path)
    const before = snapshot()
    db.db.exec(`CREATE TRIGGER reject_rebind BEFORE UPDATE ON worker_terminal_resources
      BEGIN SELECT RAISE(ABORT, 'resource refused'); END;
      BEGIN IMMEDIATE;
      UPDATE unknown_fork_facts SET payload = 'outer';`)
    expect(() => attach(path)).toThrow('resource refused')
    expect(snapshot()).toEqual(before)
    db.db.exec('COMMIT')
    expect(db.db.prepare('SELECT payload FROM unknown_fork_facts').get()).toEqual({
      payload: 'outer'
    })
  })

  it.each(paths)('%s rolls back a nested fence failure without touching the resource', (path) => {
    fixture(path)
    const before = snapshot()
    db.db.exec(`CREATE TRIGGER reject_fence BEFORE UPDATE ON deliveries
      BEGIN SELECT RAISE(ABORT, 'fence refused'); END; BEGIN IMMEDIATE;`)
    expect(() => attach(path)).toThrow('fence refused')
    expect(snapshot()).toEqual(before)
    db.db.exec('COMMIT')
  })

  it.each(paths)('%s native remint cannot replace a structured journal', (path) => {
    fixture(path)
    const resource = db.getWorkerTerminalResourceByOwner('d1')!
    db.db
      .prepare(`INSERT INTO worker_terminal_archives (dispatch_id, resource_id, kind, content)
      VALUES ('d1', ?, 'structured_journal', 'keep')`)
      .run(resource.id)
    const before = snapshot()
    expect(() => attach(path)).toThrow('unproven identity')
    expect(snapshot()).toEqual(before)
  })

  it('mint keeps an unknown runtime endpoint via COALESCE, never fabricating one', () => {
    fixture('mint')
    db.db.exec('UPDATE worker_dispatches SET runtime_epoch = NULL')
    attach('mint')
    expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
      endpoint_id: 'historical-epoch',
      endpoint_incarnation: 'process-current'
    })
  })

  it.each(['requested', 'releasing', 'unknown', 'released'])(
    'does not rebind release state %s',
    (state) => {
      fixture('mint')
      db.db.prepare('UPDATE worker_terminal_resources SET release_state = ?').run(state)
      const before = snapshot()
      expect(() => attach('mint')).toThrow('release in progress')
      expect(snapshot()).toEqual(before)
    }
  )
})
