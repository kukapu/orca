import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../orchestration/db'
import { createPersistedSchemaFixture } from '../../orchestration/db/schema/persisted-schema-test-fixture'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationWorkerReadResult } from '../../../../shared/orchestration-worker-output'
import { ORCHESTRATION_WORKER_CONTROL_METHODS } from './orchestration/worker/worker-control'
import { completeWorkerTerminalRelease } from './orchestration/worker/worker-release-completion'
import { readArchivedWorkerOutput } from './orchestration/worker/worker-archive-read'

vi.mock('../../orchestration/worker-transcript-read', () => ({
  readWorkerTranscript: vi.fn(async () => ({
    ok: true,
    messages: [],
    nextOffset: 7,
    limited: false,
    warnings: []
  }))
}))

const snapshot = {
  version: 2,
  agent: 'codex',
  processIncarnation: 'pty:inc',
  messages: [],
  limited: false,
  warnings: []
}
const archives = [
  { name: 'snapshot', kind: 'transcript_pin', content: snapshot },
  {
    name: 'legacy pin',
    kind: 'transcript_pin',
    content: {
      agent: 'codex',
      providerSessionKey: 'key',
      providerSessionId: 'session',
      transcriptPath: null,
      processIncarnation: 'pty:inc',
      observedAfter: 0,
      endOffset: 7
    }
  },
  {
    name: 'tail',
    kind: 'terminal_tail',
    content: { lines: ['preserved output'], truncated: false, warnings: [] }
  },
  {
    name: 'journal',
    kind: 'structured_journal',
    content: { ...snapshot, version: 1, processIncarnation: 'structured:session:inc' }
  }
] as const

describe('workerRead archive status through schema39 constructor and RPC', () => {
  let directory: string
  let db: OrchestrationDb
  function fixture(state: string, archive: (typeof archives)[number] = archives[0]) {
    directory = mkdtempSync(join(tmpdir(), 'orca-archive-rpc-status-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = new OrchestrationDb(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec, status) VALUES ('t1', 'r1', 'Historical worker', 'completed');
      INSERT INTO dispatch_contexts
        (id, task_id, run_id, status, assignee_handle, assignee_pane_key, process_incarnation)
        VALUES ('d1', 't1', 'r1', 'completed', 'worker', 'tab:leaf', 'pty:inc');
      INSERT INTO worker_dispatches (dispatch_id, state, agent_terminal_handle)
        VALUES ('d1', 'succeeded', 'worker');
      INSERT INTO worker_terminal_resources
        (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, pane_key, process_incarnation, host_scope)
        VALUES ('resource1', 'd1', 'd1', 'worker', 'tab:leaf', 'pty:inc', '{"kind":"local","hostId":"local"}');
    `)
    db.db.prepare('UPDATE worker_terminal_resources SET release_state = ?').run(state)
    db.db
      .prepare('UPDATE worker_terminal_archives SET kind = ?, content = ?')
      .run(archive.kind, JSON.stringify(archive.content))
    if (state === 'released' && archive.kind === 'structured_journal') {
      db.db.exec(`
        UPDATE worker_terminal_resources SET ownership_state = 'released',
          terminal_handle = 'endpoint/structworker_history', process_incarnation = 'structured:session:inc';
        UPDATE dispatch_contexts SET assignee_handle = 'endpoint/structworker_history',
          process_incarnation = 'structured:session:inc';
        UPDATE worker_dispatches SET agent_terminal_handle = 'endpoint/structworker_history';
      `)
    }
    db.close()
    db = new OrchestrationDb(path)
    const runtime = {
      getOrchestrationDb: () => db,
      showTerminal: vi.fn(async () => {
        throw new Error('No PTY inventory')
      }),
      closeTerminal: vi.fn(),
      readTerminal: vi.fn(),
      getTerminalLivenessVerdict: vi.fn()
    }
    return runtime
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  async function read(runtime: object, params: Record<string, unknown> = { dispatch: 'd1' }) {
    const method = ORCHESTRATION_WORKER_CONTROL_METHODS.find(
      (entry) => entry.name === 'orchestration.workerRead'
    )!
    return (await method.handler(method.params!.parse(params), {
      runtime: runtime as OrcaRuntimeService
    })) as OrchestrationWorkerReadResult
  }
  function preservedRows() {
    return [
      db.getWorkerTerminalResource('resource1'),
      db.getWorkerTerminalArchive('d1'),
      db.getDispatchContextById('d1'),
      db.getWorkerDispatch('d1')
    ]
  }

  for (const archive of archives) {
    it.each(['unknown', 'releasing', 'released'])(
      `${archive.name} reports process evidence separately from bytes in %s`,
      async (state) => {
        const runtime = fixture(state, archive)
        const before = preservedRows()
        const result = await read(runtime)
        const terminal = state === 'released' ? 'exited' : 'unknown'
        expect(result).toMatchObject({
          archived: true,
          status: {
            worker: 'succeeded',
            terminal,
            liveness: state === 'released' ? 'exited' : 'unverifiable'
          }
        })
        if (result.source === 'terminal') {
          expect(result.terminal.status).toBe(terminal)
        }
        expect(runtime.showTerminal).not.toHaveBeenCalled()
        expect(runtime.closeTerminal).not.toHaveBeenCalled()
        expect(runtime.readTerminal).not.toHaveBeenCalled()
        expect(runtime.getTerminalLivenessVerdict).not.toHaveBeenCalled()
        expect(preservedRows()).toEqual(before)
      }
    )
  }

  it.each(['retained', 'requested', 'not_requested'])(
    'reads a stored journal in %s without PTY resolution',
    async (state) => {
      const runtime = fixture(state, archives[3])
      const before = preservedRows()
      expect(await read(runtime)).toMatchObject({
        archived: true,
        source: 'transcript',
        status: { terminal: 'unknown', liveness: 'unverifiable' }
      })
      await expect(read(runtime, { dispatch: 'd1', source: 'terminal' })).rejects.toMatchObject({
        code: 'archive_unavailable'
      })
      await expect(read(runtime, { dispatch: 'missing' })).rejects.toMatchObject({
        code: 'dispatch_not_found'
      })
      expect(runtime.showTerminal).not.toHaveBeenCalled()
      expect(preservedRows()).toEqual(before)
    }
  )

  it('rejects an unsupported archive kind without PTY effects or persisted changes', async () => {
    const runtime = fixture('unknown')
    db.db.pragma('ignore_check_constraints = ON')
    db.db.exec("UPDATE worker_terminal_archives SET kind = 'invalid_kind'")
    const before = preservedRows()
    await expect(read(runtime)).rejects.toMatchObject({ code: 'archive_unavailable' })
    expect(runtime.showTerminal).not.toHaveBeenCalled()
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(runtime.readTerminal).not.toHaveBeenCalled()
    expect(preservedRows()).toEqual(before)
  })

  it.each([false, true])(
    'reads archived bytes while close is pending, then uses confirmed close=%s',
    async (ptyKilled) => {
      const runtime = fixture('requested', archives[2])
      db.db.exec('DELETE FROM worker_terminal_archives')
      let finishClose!: (value: { ptyKilled: boolean }) => void
      runtime.closeTerminal.mockReturnValue(
        new Promise((resolve) => {
          finishClose = resolve
        })
      )
      runtime.showTerminal.mockResolvedValue({ handle: 'worker', connected: true } as never)
      runtime.readTerminal.mockResolvedValue({
        tail: ['captured before close'],
        status: 'running',
        truncated: false
      })
      const releaseRuntime = Object.assign(runtime, {
        getTerminalPaneKey: () => 'tab:leaf',
        getTerminalProcessIncarnation: () => 'pty:inc',
        getOrchestrationDispatchAuthority: () => ({
          hostScope: { kind: 'local', hostId: 'local' }
        }),
        getExactWorkerProviderSession: () => null,
        notifyMessageArrived: vi.fn()
      }) as unknown as OrcaRuntimeService
      const release = completeWorkerTerminalRelease({
        runtime: releaseRuntime,
        db,
        dispatchId: 'd1',
        resource: db.getWorkerTerminalResource('resource1')!
      })
      await vi.waitFor(() => expect(runtime.closeTerminal).toHaveBeenCalledTimes(1))
      expect(db.getWorkerTerminalResource('resource1')?.release_state).toBe('releasing')
      const duringClose = await read(runtime)
      finishClose({ ptyKilled })
      const receipt = await release
      expect(duringClose).toMatchObject({
        archived: true,
        terminal: { tail: ['captured before close'], status: 'unknown' },
        status: { terminal: 'unknown', liveness: 'unverifiable' }
      })
      expect(receipt.state).toBe(ptyKilled ? 'released' : 'release_unknown')
      expect(await read(runtime)).toMatchObject({
        archived: true,
        status: {
          terminal: ptyKilled ? 'exited' : 'unknown',
          liveness: ptyKilled ? 'exited' : 'unverifiable'
        }
      })
      expect(runtime.closeTerminal).toHaveBeenCalledTimes(1)
      expect(runtime.showTerminal).toHaveBeenCalledTimes(1)
      expect(runtime.readTerminal).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['live', 'unverifiable', 'exited'] as const)(
    'uses explicit owning-host evidence %s independently of the archive',
    async (liveness) => {
      fixture('unknown', archives[2])
      const result = await readArchivedWorkerOutput({
        db,
        dispatchId: 'd1',
        workerState: 'succeeded',
        resource: db.getWorkerTerminalResource('resource1')!,
        liveness
      })
      expect(result.status).toMatchObject({
        liveness,
        terminal: liveness === 'live' ? 'running' : liveness === 'exited' ? 'exited' : 'unknown'
      })
    }
  )
})
