import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import {
  SCHEMA39_REFERENCE_ADDITIONS,
  SCHEMA39_ROUTING_TRIGGER
} from './schema39-reference-additions'
import { SCHEMA39_REFERENCE_LEGACY } from './schema39-reference-legacy'
import { createSchema30TablesSql } from './schema30-reference-tables'

// Tests exercise real methods against39 without claiming constructor/application admission.
export function openPersistedSchemaMethodsFixture(path: string): OrchestrationDb {
  return Object.assign(Object.create(OrchestrationDb.prototype), { db: new Database(path) })
}

// Frozen stable30 DDL, then the additive DDL from da3def1b0f (not its v35 repair).
export function createPersistedSchemaFixture(path: string, version: 30 | 39): void {
  const db = new Database(path)
  try {
    db.exec(createSchema30TablesSql())
    db.exec(SCHEMA39_REFERENCE_LEGACY)
    db.exec('INSERT INTO mutation_receipt_ledger (singleton, receipt_count) VALUES (1, 0)')
    db.exec(`
      INSERT INTO runs (id, objective, consumer_generation) VALUES ('r1', 'Fixture Run', 7);
      INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
        VALUES ('run-mail', 'r1', 'sender', 'run:r1', 'Run mail'),
               ('worker-mail', 'r1', 'sender', 'dispatch:d1', 'Worker mail');
    `)
    db.pragma('journal_mode = DELETE')
    if (version === 39) {
      db.exec(SCHEMA39_REFERENCE_ADDITIONS)
      db.exec(`
        INSERT INTO deliveries (id, run_id, mailbox_handle, consumer_generation, message_ids)
          VALUES ('worker-delivery', 'r1', 'dispatch:d1', 7, '["worker-mail"]'),
                 ('run-delivery', 'r1', 'run:r1', 7, '["run-mail"]');
        INSERT INTO attempt_observation_facts
          (id, dispatch_id, task_id, sequence, authority_id, authority_clock, facet, payload,
           home_received_at)
          VALUES ('fact1', 'd1', 't1', 1, 'ssh:fixture', 'clock1', 'process',
                  '{"verdict":"unverifiable"}', 123);
        INSERT INTO structured_pointer_operations
          (mailbox_handle, session_id, operation_id, batch_fingerprint, minted_at_ms)
          VALUES ('dispatch:d1', 's1', 'op1', 'batch1', 123);
        INSERT INTO worker_terminal_archives (dispatch_id, resource_id, kind, content)
          VALUES ('d1', 'resource1', 'structured_journal', '{"entries":["preserve"]}');
      `)
      db.pragma('user_version = 39')
    } else {
      db.pragma('user_version = 30')
    }
    db.exec(SCHEMA39_ROUTING_TRIGGER)
    db.exec(`
      CREATE TABLE unknown_fork_facts (id TEXT PRIMARY KEY, payload TEXT, extra TEXT DEFAULT 'keep');
      INSERT INTO unknown_fork_facts (id, payload) VALUES ('unknown1', 'opaque');
    `)
  } finally {
    db.close()
  }
}
