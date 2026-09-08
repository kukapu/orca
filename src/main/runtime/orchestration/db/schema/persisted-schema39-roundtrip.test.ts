import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { reconcileLifecycleMessage } from '../../lifecycle-reconciliation'
import { createPersistedSchemaFixture } from './persisted-schema-test-fixture'

// Exact source from da3def1b0f; no Git checkout/toolchain extraction is required in CI.
const projectorSource = readFileSync(
  new URL('./fixtures/f39-attempt-outcome-projection.ts.txt', import.meta.url)
)
const projectorBlob = createHash('sha1')
  .update(`blob ${projectorSource.length}\0`)
  .update(projectorSource)
  .digest('hex')
if (projectorBlob !== '787c616dd927217b67338c279ff1609a9d50c643') {
  throw new Error('The published F projector fixture was modified')
}
const projectorExports: { projectAttemptOutcome?: (args: unknown) => unknown } = {}
const projectorScript = stripTypeScriptTypes(projectorSource.toString()).replace(
  'export function projectAttemptOutcome',
  'function projectAttemptOutcome'
)
runInNewContext(`${projectorScript}\nexports.projectAttemptOutcome = projectAttemptOutcome`, {
  exports: projectorExports
})

describe('real39 constructor / candidate writes / exact F projector roundtrip', () => {
  let directory: string
  let path: string
  let db: OrchestrationDb
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  function fixture(): void {
    directory = mkdtempSync(join(tmpdir(), 'orca-roundtrip39-'))
    path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = new OrchestrationDb(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec, status) VALUES ('t1', 'r1', 'Work', 'dispatched');
      INSERT INTO dispatch_contexts (id, run_id, task_id, assignee_handle, status, consumer_generation)
        VALUES ('d1', 'r1', 't1', 'worker', 'dispatched', 7);
      INSERT INTO worker_dispatches (dispatch_id, state, runtime_epoch)
        VALUES ('d1', 'ready', 'epoch1');
      UPDATE attempt_observation_facts SET facet = 'outcome', authority_clock = 'home',
        payload = '{"outcome":"outcome_unknown","reason":"old transport uncertainty"}' WHERE id = 'fact1';
    `)
  }

  it('pins the unmodified published projector blob', () => {
    expect(projectorBlob).toBe('787c616dd927217b67338c279ff1609a9d50c643')
  })

  it.each(['succeeded', 'failed'] as const)('F projects %s over stale facts', (outcome) => {
    fixture()
    const opaque = db.db.prepare('SELECT * FROM unknown_fork_facts').all()
    const journals = db.db.prepare('SELECT * FROM worker_terminal_archives').all()
    const operations = db.db.prepare('SELECT * FROM structured_pointer_operations').all()
    const message = db.insertMessage({
      id: 'report1',
      runId: 'r1',
      from: 'worker',
      to: 'run:r1',
      subject: 'Report',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: 't1', dispatchId: 'd1', outcome })
    })
    expect(reconcileLifecycleMessage(db, message).action).toBe(
      outcome === 'succeeded' ? 'completed' : 'failed'
    )
    db.close()
    db = new OrchestrationDb(path)
    const rows = db.db.prepare('SELECT * FROM attempt_observation_facts ORDER BY sequence').all()
    // F exposeAttemptObservationFact's storage-to-domain mapping; the projector itself is exact.
    const facts = rows.map((row) => ({
      id: row.id,
      dispatchId: row.dispatch_id,
      taskId: row.task_id,
      sequence: row.sequence,
      authorityId: row.authority_id,
      authorityClock: row.authority_clock,
      facet: row.facet,
      payload: JSON.parse(row.payload as string),
      sourceObservedAt: row.source_observed_at,
      executionReceivedAt: row.execution_received_at,
      homeReceivedAt: row.home_received_at,
      createdAt: row.created_at
    }))
    expect(
      projectorExports.projectAttemptOutcome!({
        dispatchId: 'd1',
        taskId: 't1',
        facts,
        authorityNow: { home: Date.now() + 7 * 86_400_000 }
      })
    ).toMatchObject({
      outcome,
      taskOutcome: outcome,
      outcomeSource: 'worker_report',
      workerReport: { status: 'accepted', outcome, reportId: 'worker_report:report1' }
    })
    expect(rows).toHaveLength(2)
    expect(db.db.prepare('SELECT * FROM unknown_fork_facts').all()).toEqual(opaque)
    expect(db.db.prepare('SELECT * FROM worker_terminal_archives').all()).toEqual(journals)
    expect(db.db.prepare('SELECT * FROM structured_pointer_operations').all()).toEqual(operations)
    expect(db.db.pragma('user_version', { simple: true })).toBe(39)
  })

  it.each([1, 2, 3])('rotates authority/resources and ACKs only its phase%s mailbox', (phase) => {
    fixture()
    const beforeJournal = db.db.prepare('SELECT * FROM worker_terminal_archives').all()
    db.db.exec(
      "UPDATE dispatch_contexts SET status = 'pending'; UPDATE worker_dispatches SET state = 'starting'"
    )
    db.db
      .prepare("UPDATE messages SET pointer_enter_pending = ?, pointer_pty_id = 'old-pty'")
      .run(phase)
    db.prepareStartingWorkerAuthority({
      dispatchId: 'd1',
      handle: 'worker-new',
      paneKey: 'pane-new',
      processIncarnation: 'pty:new',
      worktreeId: 'folder-workspace',
      hostScope: 'ssh:offline',
      setupState: 'ready',
      effects: [],
      terminalOwnership: 'created'
    })
    const consumer = { dispatchId: 'd1', source: 'local' as const, consumerGeneration: 8 }
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('fenced')
    expect(db.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
    expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
      endpoint_id: 'epoch1',
      endpoint_incarnation: 'pty:new'
    })
    expect(db.getUndeliveredUnreadMessages('dispatch:d1')).toEqual([])
    const delivery = db.getOrCreateDispatchDelivery(consumer)!
    db.acknowledgeDispatchDelivery({ ...consumer, deliveryId: delivery.delivery.id })
    expect(db.getMessageById('run-mail')).toMatchObject({ read: 0, pointer_enter_pending: phase })
    expect(db.getMessageById('worker-mail')).toMatchObject({ read: 1, pointer_enter_pending: 0 })
    db.close()
    db = new OrchestrationDb(path)
    expect(db.getDeliveryRaw(delivery.delivery.id)?.status).toBe('acknowledged')
    expect(db.db.prepare('SELECT * FROM worker_terminal_archives').all()).toEqual(beforeJournal)
  })
})
