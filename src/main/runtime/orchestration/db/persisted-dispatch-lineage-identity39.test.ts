import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from './orchestration-db'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from './schema/persisted-schema-test-fixture'
import { AGENT_PROMPT_STALLED_ERROR } from '../../agent-prompt-submission-verification'

describe('persisted retry/creator identity bridge (not admission39)', () => {
  let directory: string
  let db: OrchestrationDb
  function fixture(version: 30 | 39 = 39): OrchestrationDb {
    directory = mkdtempSync(join(tmpdir(), 'orca-lineage-identity39-'))
    const path = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(path, version)
    db = openPersistedSchemaMethodsFixture(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec, status)
        VALUES ('parent-task', 'r1', 'Parent', 'dispatched'), ('child-task', 'r1', 'Child', 'ready');
      INSERT INTO dispatch_contexts
        (id, task_id, run_id, assignee_handle, assignee_pane_key, process_incarnation, depth)
        VALUES ('parent', 'parent-task', 'r1', 'caller', 'caller-pane', 'caller-process', 2);
    `)
    return db
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  const creator = {
    kind: 'terminal' as const,
    handle: 'caller',
    paneKey: 'caller-pane',
    processIncarnation: 'caller-process'
  }
  const start = { taskId: 'child-task', startOptions: {}, creator, maxDepth: 5 }

  for (const version of [30, 39] as const) {
    it(`schema${version}: claim records current caller without guessing a retry`, () => {
      fixture(version)
      const row = db.createDispatchContext({
        ...start,
        assigneeHandle: 'child',
        assigneePaneKey: 'child-pane'
      })
      expect(row.depth).toBe(3)
      if (version === 39) {
        expect(row).toMatchObject({
          creator_dispatch_id: 'parent',
          creator_handle: 'caller',
          creator_pane_key: 'caller-pane',
          retry_of_dispatch_id: null
        })
      } else {
        expect(row).not.toHaveProperty('creator_dispatch_id')
      }
    })

    it(`schema${version}: retry records explicit retry source and the new caller, not history`, () => {
      fixture(version)
      const first = db.createStartingWorkerDispatch(start).dispatch
      db.failWorkerStart(first.id, 'setup', 'failed setup')
      const next = db.createStartingWorkerDispatch({
        ...start,
        retryOf: first.id,
        creator: { kind: 'system' }
      }).dispatch
      if (version === 39) {
        expect(next).toMatchObject({
          retry_of_dispatch_id: first.id,
          creator_dispatch_id: null,
          creator_handle: null,
          creator_pane_key: null
        })
      } else {
        expect(next).not.toHaveProperty('retry_of_dispatch_id')
      }
      expect(next.depth).toBe(1)
      expect(db.db.pragma('user_version', { simple: true })).toBe(version)
    })
  }

  it('persists a verified remote creator, but never resolves the wrong process or an ambiguous role', () => {
    fixture()
    db.db.exec(`
      UPDATE dispatch_contexts SET status = 'completed' WHERE id = 'parent';
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, pane_key, process_incarnation, depth)
        VALUES ('remote-parent', 'remote-task', 'peer', 'epoch', 'caller-pane', 'caller-process', 3);
    `)
    expect(db.resolveCreatorDispatchId({ ...creator, processIncarnation: 'stale' })).toBeNull()
    const child = db.createStartingWorkerDispatch(start).dispatch
    expect(child).toMatchObject({ creator_dispatch_id: 'remote-parent', depth: 4 })
    db.db.exec("UPDATE dispatch_contexts SET status = 'dispatched' WHERE id = 'parent'")
    expect(db.resolveCreatorDispatchId(creator)).toBeNull()
    expect(db.resolveCreatorDepth(creator)).toBe(3)
  })

  it('does not count proven self-context as delegation; unknown legacy identity still counts', () => {
    fixture()
    expect(db.resolveCreatorDepth(creator)).toBe(2)
    db.db.exec(
      "UPDATE dispatch_contexts SET creator_handle = 'caller', creator_pane_key = 'caller-pane'"
    )
    expect(db.resolveCreatorDepth(creator)).toBe(0)
    expect(db.resolveCreatorDispatchId(creator)).toBeNull()
    expect(db.createStartingWorkerDispatch(start).dispatch).toMatchObject({
      creator_dispatch_id: null,
      creator_handle: 'caller',
      creator_pane_key: 'caller-pane',
      depth: 1
    })
  })

  it('keeps an unobserved remote prompt as creator even without a retained capability', () => {
    fixture()
    db.db.exec(`
      UPDATE dispatch_contexts SET status = 'completed';
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, pane_key, process_incarnation, depth, state)
        VALUES ('remote-parent', 'remote-task', 'peer', 'epoch', 'caller-pane', 'caller-process', 3, 'failed');
    `)
    db.db
      .prepare('UPDATE remote_dispatch_attachments SET last_error = ?')
      .run(AGENT_PROMPT_STALLED_ERROR)
    expect(db.resolveCreatorDispatchId(creator)).toBe('remote-parent')
    expect(db.resolveCreatorDepth(creator)).toBe(3)
    db.db.exec("UPDATE remote_dispatch_attachments SET stage = 'worker_report_settled'")
    expect(db.resolveCreatorDispatchId(creator)).toBeNull()
  })

  it('rolls back the lineage row and mutation receipt if worker insertion fails', () => {
    fixture()
    db.db.exec(`CREATE TRIGGER reject_worker BEFORE INSERT ON worker_dispatches
      BEGIN SELECT RAISE(ABORT, 'worker refused'); END`)
    expect(() =>
      db.createStartingWorkerDispatch({
        ...start,
        mutationReceipt: {
          callerFingerprint: 'caller',
          requestId: 'request',
          method: 'worker-start',
          payloadHash: 'hash'
        }
      })
    ).toThrow('worker refused')
    expect(db.getDispatchContext('child-task')).toBeUndefined()
    expect(db.getTask('child-task')?.status).toBe('ready')
    expect(db.getMutationReceipt('caller', 'request')).toBeUndefined()
    expect(db.getDispatchContextById('parent')).toMatchObject({ creator_dispatch_id: null })
  })

  it('rolls back context-only identity when the task claim cannot be committed', () => {
    fixture()
    db.db.exec(`CREATE TRIGGER reject_task BEFORE UPDATE ON tasks
      BEGIN SELECT RAISE(ABORT, 'task refused'); END`)
    expect(() => db.createDispatchContext({ ...start, assigneeHandle: 'child' })).toThrow(
      'task refused'
    )
    expect(db.getDispatchContext('child-task')).toBeUndefined()
    expect(db.getTask('child-task')?.status).toBe('ready')
  })
})
