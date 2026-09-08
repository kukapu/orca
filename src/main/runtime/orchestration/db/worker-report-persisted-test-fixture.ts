import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { MessageRow, WorkerReportOutcome } from '../types'
import { LEGACY_CONTRACT_VERSION } from './contract-constants'
import { createPersistedSchemaFixture } from './schema/persisted-schema-test-fixture'
import { OrchestrationDb } from './orchestration-db'

export function workerReportPersistedFixture(version: 30 | 39 = 39) {
  const directory = mkdtempSync(join(tmpdir(), 'orca-report-bridge-'))
  const path = join(directory, 'orchestration.db')
  createPersistedSchemaFixture(path, version)
  let db = new OrchestrationDb(path)
  db.db.exec(`
    INSERT INTO tasks (id, run_id, spec, status) VALUES ('t1', 'r1', 'Work', 'dispatched');
    INSERT INTO dispatch_contexts (id, run_id, task_id, assignee_handle, status)
      VALUES ('d1', 'r1', 't1', 'worker', 'dispatched');
    INSERT INTO worker_dispatches (dispatch_id, state, stage) VALUES ('d1', 'ready', 'ready');
    INSERT INTO federated_dispatches (dispatch_id, environment_id, environment_name, peer_fingerprint)
      VALUES ('d1', 'ssh:fixture', 'Remote fixture', 'fixture-peer');
  `)
  if (version === 39) {
    // Valid F liveness input (da3def1b0f attempt-observation-types/store), not a projector mock.
    db.db.exec(`UPDATE attempt_observation_facts SET sequence = 7, authority_clock = 'execution',
      facet = 'liveness', payload = '{"status":"unverifiable","reason":"disconnected"}'
      WHERE id = 'fact1'`)
  }
  return {
    get db() {
      return db
    },
    reopen() {
      db.close()
      db = new OrchestrationDb(path)
      return db
    },
    path,
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

export function seedLegacyReportPrincipal(
  db: ReturnType<typeof workerReportPersistedFixture>['db']
) {
  db.db
    .prepare('UPDATE dispatch_contexts SET contract_version = ? WHERE id = ?')
    .run(LEGACY_CONTRACT_VERSION, 'd1')
  db.db.exec(`INSERT INTO legacy_compatibility_principals
    (id, run_id, dispatch_id, role, host_scope, terminal_handle, pane_key, launch_token_hash, status)
    VALUES ('principal1', 'r1', 'd1', 'worker', 'ssh:fixture', 'worker', 'pane1', 'hash1', 'committed')`)
}

export function reportMessage(outcome: WorkerReportOutcome = 'succeeded') {
  return {
    id: 'report1',
    runId: 'r1',
    from: 'worker',
    to: 'run:r1',
    subject: 'Report',
    body: 'Done',
    type: 'worker_done' as const,
    priority: 'normal' as const,
    payload: JSON.stringify({ taskId: 't1', dispatchId: 'd1', outcome })
  }
}

export function assertReportFact(
  db: ReturnType<typeof workerReportPersistedFixture>['db'],
  message: MessageRow,
  outcome: WorkerReportOutcome
) {
  // Exact storage contract consumed by F exposeAttemptObservationFact/projectAttemptOutcome.
  const id = `worker_report:${message.id}`
  expect(db.db.prepare('SELECT * FROM attempt_observation_facts WHERE id = ?').get(id)).toEqual({
    id,
    dispatch_id: 'd1',
    task_id: 't1',
    sequence: 8,
    authority_id: 'run_home:r1',
    authority_clock: 'home',
    facet: 'worker_report',
    payload: JSON.stringify({ outcome, reportId: id, status: 'accepted' }),
    source_observed_at: null,
    execution_received_at: null,
    home_received_at: Date.parse(message.created_at),
    created_at: expect.any(String)
  })
}
