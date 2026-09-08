import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../orchestration-db'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../schema/persisted-schema-test-fixture'
import { planLegacyWorkerTerminalRecovery } from '../../orchestration-legacy-worker-terminal-recovery'
import { completeWorkerTerminalRelease } from '../../../rpc/methods/orchestration-worker-release-completion'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { ORCHESTRATION_WORKER_STOP_METHODS } from '../../../rpc/methods/orchestration-worker-stop'

const paneKey = 'tab-worker:11111111-1111-4111-8111-111111111111'
const ptyIncarnation = 'pty-worker:22222222-2222-4222-8222-222222222222'

describe('persisted39 structured worker retention (methods only)', () => {
  let directory: string
  let db: OrchestrationDb
  function fixture(processIncarnation = 'structured:session:generation', handle = 'worker') {
    directory = mkdtempSync(join(tmpdir(), 'orca-structured-retention-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = openPersistedSchemaMethodsFixture(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec, status) VALUES ('t1', 'r1', 'Worker task', 'dispatched');
      INSERT INTO dispatch_contexts (id, task_id, run_id, status)
        VALUES ('d1', 't1', 'r1', 'dispatched');
      INSERT INTO worker_dispatches (dispatch_id, state, worktree_id)
        VALUES ('d1', 'ready', 'folder-workspace');
      INSERT INTO worker_terminal_resources
        (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, worktree_id, host_scope)
        VALUES ('resource1', 'd1', 'd1', 'worker', 'folder-workspace', '{"kind":"ssh","targetId":"offline"}');
    `)
    db.db
      .prepare(
        'UPDATE dispatch_contexts SET process_incarnation = ?, assignee_handle = ?, assignee_pane_key = ?'
      )
      .run(processIncarnation, handle, paneKey)
    db.db.prepare('UPDATE worker_dispatches SET agent_terminal_handle = ?').run(handle)
    db.db
      .prepare(
        'UPDATE worker_terminal_resources SET process_incarnation = ?, terminal_handle = ?, pane_key = ?'
      )
      .run(processIncarnation, handle, paneKey)
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function snapshot() {
    return [
      'tasks',
      'dispatch_contexts',
      'worker_dispatches',
      'worker_terminal_resources',
      'worker_terminal_archives',
      'attempt_observation_facts',
      'structured_pointer_operations',
      'messages',
      'unknown_fork_facts'
    ].map((table) => db.db.prepare(`SELECT * FROM ${table}`).all())
  }

  it.each([
    ['structured:session:generation', 'worker'],
    ['structured:', 'worker'],
    [ptyIncarnation, 'endpoint/structworker_'],
    [ptyIncarnation, 'structworker_broken']
  ])('never recovers or settles missing structured identity %s / %s', (process, handle) => {
    fixture(process, handle)
    const before = snapshot()
    const plan = planLegacyWorkerTerminalRecovery(db.listLegacyWorkerTerminalRecoveryRows())
    expect(plan.candidates).toEqual([])
    expect(plan.blockedPanes).toHaveLength(1)
    expect(db.reconcileMissingWorkerTerminal('d1', 'PTY inventory empty').state).toBe('ready')
    expect(snapshot()).toEqual(before)
  })

  it.each(['not_requested', 'retained', 'requested', 'releasing', 'unknown'])(
    'preserves ownership and the journal through direct DB cleanup from %s',
    async (state) => {
      fixture()
      db.db.exec(
        "UPDATE worker_dispatches SET state = 'succeeded'; UPDATE dispatch_contexts SET status = 'completed'"
      )
      db.db
        .prepare(
          "UPDATE worker_terminal_resources SET release_state = ?, retained_reason = 'user_requested'"
        )
        .run(state)
      const before = snapshot()
      expect(db.requestWorkerTerminalRelease('d1').disposition).toBe('retained')
      expect(db.retainWorkerTerminalResource('d1').disposition).toBe('retained')
      db.storeWorkerTerminalArchive({
        dispatchId: 'd1',
        resourceId: 'resource1',
        kind: 'terminal_tail',
        content: '{}'
      })
      db.commitWorkerTerminalArchiveForRelease({
        dispatchId: 'd1',
        resourceId: 'resource1',
        kind: 'terminal_tail',
        content: '{}',
        archiveSource: 'terminal',
        archiveStatus: 'empty'
      })
      db.settleWorkerTerminalRelease('resource1')
      db.markWorkerTerminalReleaseUnknown('resource1', 'PTY absent')
      db.revertWorkerTerminalReleaseToRetained('resource1', 'identity_unproven')
      expect(
        db.settleDeadWorkerTerminalRelease({
          requestingDispatchId: 'd1',
          resourceId: 'resource1',
          processIncarnation: 'structured:session:generation'
        }).disposition
      ).toBe('retained')
      const runtime = {
        listTerminals: vi.fn(async () => []),
        showTerminal: vi.fn(),
        closeTerminal: vi.fn(),
        readTerminal: vi.fn(),
        getExactWorkerProviderSession: vi.fn(),
        notifyMessageArrived: vi.fn()
      }
      const result = await completeWorkerTerminalRelease({
        runtime: runtime as unknown as OrcaRuntimeService,
        db,
        dispatchId: 'd1',
        resource: db.getWorkerTerminalResource('resource1')!,
        mode: 'recovery'
      })
      expect(result).toMatchObject({ state: 'retained', processAction: 'none' })
      for (const method of Object.values(runtime)) {
        expect(method).not.toHaveBeenCalled()
      }
      expect(snapshot()).toEqual(before)
      expect(db.db.pragma('user_version', { simple: true })).toBe(39)
    }
  )

  it('protects the journal kind even when only PTY-shaped identity remains', () => {
    fixture(ptyIncarnation)
    db.db.exec(
      "UPDATE worker_dispatches SET state = 'succeeded'; UPDATE worker_terminal_resources SET release_state = 'retained', retained_reason = 'user_requested'"
    )
    const before = snapshot()
    db.storeWorkerTerminalArchive({
      dispatchId: 'd1',
      resourceId: 'resource1',
      kind: 'transcript_pin',
      content: '{}'
    })
    db.requestWorkerTerminalRelease('d1')
    db.retainWorkerTerminalResource('d1')
    db.settleDeadWorkerTerminalRelease({
      requestingDispatchId: 'd1',
      resourceId: 'resource1',
      processIncarnation: ptyIncarnation
    })
    db.settleWorkerTerminalRelease('resource1')
    expect(snapshot()).toEqual(before)
  })

  it('guards direct release without any archive to capture', async () => {
    fixture('structured:')
    db.db.exec(
      "DELETE FROM worker_terminal_archives; UPDATE worker_terminal_resources SET release_state = 'requested'"
    )
    const before = snapshot()
    await expect(
      completeWorkerTerminalRelease({
        runtime: {} as OrcaRuntimeService,
        db,
        dispatchId: 'd1',
        resource: db.getWorkerTerminalResource('resource1')!
      })
    ).resolves.toMatchObject({ state: 'retained', processAction: 'none' })
    expect(snapshot()).toEqual(before)
  })

  it('does not close a structured worker through worker-stop with an empty PTY runtime', async () => {
    fixture('structured:')
    const resource = db.getWorkerTerminalResource('resource1')
    const archive = db.getWorkerTerminalArchive('d1')
    const closeTerminal = vi.fn()
    const runtime = {
      getOrchestrationDb: () => db,
      getRuntimeId: () => 'test-runtime',
      showTerminal: vi.fn(async () => {
        throw new Error('No PTY')
      }),
      closeTerminal,
      notifyMessageArrived: vi.fn()
    } as unknown as OrcaRuntimeService
    const method = ORCHESTRATION_WORKER_STOP_METHODS.find(
      (entry) => entry.name === 'orchestration.workerStop'
    )!
    expect(await method.handler({ dispatch: 'd1' }, { runtime })).toMatchObject({
      state: 'stop_unknown',
      processAction: 'none'
    })
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(db.getWorkerTerminalResource('resource1')).toEqual(resource)
    expect(db.getWorkerTerminalArchive('d1')).toEqual(archive)
  })
})
