import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import { createPersistedSchemaFixture } from './persisted-schema-test-fixture'

describe('schema39 admission of complete released structured history', () => {
  let directory: string
  let opened: OrchestrationDb | undefined

  afterEach(() => {
    opened?.close()
    opened = undefined
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function fixture(outcome: 'succeeded' | 'failed', change = ''): string {
    directory = mkdtempSync(join(tmpdir(), 'orca-released-structured39-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    const raw = new Database(path)
    try {
      const status = outcome === 'succeeded' ? 'completed' : 'failed'
      raw.exec(`
        INSERT INTO tasks (id, run_id, spec, status)
          VALUES ('t1', 'r1', 'Historical worker', '${status}');
        INSERT INTO dispatch_contexts
          (id, run_id, task_id, status, assignee_handle, assignee_pane_key,
           process_incarnation, capability_hash, capability_revoked_at, consumer_generation)
          VALUES ('d1', 'r1', 't1', '${status}', 'structworker_history', 'pane-history',
                  'structured:session:incarnation', 'retained-hash', '2026-09-08 05:00:00', 7);
        INSERT INTO worker_dispatches
          (dispatch_id, runtime_epoch, state, stage, agent_terminal_handle, worktree_id)
          VALUES ('d1', 'epoch1', '${outcome}', 'worker_report_settled',
                  'structworker_history', 'folder-workspace');
        INSERT INTO worker_terminal_resources
          (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, pane_key,
           process_incarnation, endpoint_id, endpoint_incarnation, host_scope, worktree_id,
           ownership_state, release_state, release_completed_at)
          VALUES ('resource1', 'd1', 'd1', 'structworker_history', 'pane-history',
                  'structured:session:incarnation', 'epoch1', 'structured:session:incarnation',
                  'ssh:offline', 'folder-workspace', 'released', 'released', '2026-09-08 05:00:00');
        ${change}
      `)
    } finally {
      raw.close()
    }
    return path
  }

  function expectRejectedWithoutWrites(path: string): void {
    const before = readFileSync(path)
    expect(() => {
      opened = new OrchestrationDb(path)
    }).toThrow(/structured/i)
    expect(readFileSync(path).equals(before)).toBe(true)
  }

  for (const outcome of ['succeeded', 'failed'] as const) {
    it.each(['retained', 'cleared'])(`${outcome}: admits released history with %s hash`, (hash) => {
      const path = fixture(
        outcome,
        hash === 'cleared'
          ? "UPDATE dispatch_contexts SET capability_hash = NULL WHERE id = 'd1'"
          : ''
      )
      const before = readFileSync(path)
      opened = new OrchestrationDb(path)
      expect(opened.getWorkerDispatch('d1')?.state).toBe(outcome)
      expect(opened.getWorkerTerminalResource('resource1')).toMatchObject({
        ownership_state: 'released',
        release_state: 'released'
      })
      expect(opened.getDispatchContextById('d1')?.capability_revoked_at).not.toBeNull()
      opened.close()
      opened = undefined
      expect(readFileSync(path).equals(before)).toBe(true)
    })

    it.each([
      ['owned', 'not_requested'],
      ['owned', 'unknown'],
      ['owned', 'released'],
      ['released', 'unknown']
    ])(`${outcome}: rejects resource ownership=%s / release=%s`, (ownership, release) => {
      expectRejectedWithoutWrites(
        fixture(
          outcome,
          `
        UPDATE worker_terminal_resources
          SET ownership_state = '${ownership}', release_state = '${release}';
      `
        )
      )
    })

    it.each(['NULL', "''"])(`${outcome}: non-revoked authority (%s) still blocks`, (revoked) => {
      expectRejectedWithoutWrites(
        fixture(outcome, `UPDATE dispatch_contexts SET capability_revoked_at = ${revoked}`)
      )
    })

    it.each([
      'DELETE FROM worker_terminal_resources',
      "UPDATE worker_terminal_resources SET owner_dispatch_id = 'somebody-else'",
      "UPDATE worker_terminal_resources SET terminal_handle = 'structworker_other'",
      "UPDATE worker_terminal_resources SET process_incarnation = 'structured:other:incarnation'"
    ])(`${outcome}: rejects missing or unrelated release proof: %s`, (change) => {
      expectRejectedWithoutWrites(fixture(outcome, change))
    })
  }

  it.each(['pending', 'dispatched'])(
    'keeps an active %s binding blocked after revocation',
    (status) => {
      expectRejectedWithoutWrites(
        fixture('succeeded', `UPDATE dispatch_contexts SET status = '${status}'`)
      )
    }
  )

  it.each(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'])(
    'keeps an active/uncertain worker state %s blocked despite a released resource',
    (state) => {
      expectRejectedWithoutWrites(
        fixture('succeeded', `UPDATE worker_dispatches SET state = '${state}'`)
      )
    }
  )
})
