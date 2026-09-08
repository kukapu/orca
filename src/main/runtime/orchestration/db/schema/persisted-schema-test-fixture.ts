import Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'

// Tests exercise real methods against39 without claiming constructor/application admission.
export function openPersistedSchemaMethodsFixture(path: string): OrchestrationDb {
  return Object.assign(Object.create(OrchestrationDb.prototype), { db: new Database(path) })
}

// Real stable30 tables/migrations, then the additive DDL from da3def1b0f (not its v35 repair).
export function createPersistedSchemaFixture(path: string, version: 30 | 39): void {
  const stable = new OrchestrationDb(path)
  stable.db.exec(`
    INSERT INTO runs (id, objective, consumer_generation) VALUES ('r1', 'Fixture Run', 7);
    INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
      VALUES ('run-mail', 'r1', 'sender', 'run:r1', 'Run mail'),
             ('worker-mail', 'r1', 'sender', 'dispatch:d1', 'Worker mail');
  `)
  stable.close()
  const db = new Database(path)
  try {
    db.pragma('journal_mode = DELETE')
    if (version === 39) {
      db.exec(FORK39_ADDITIVE_SQL)
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
    }
    db.exec(`
      CREATE TABLE unknown_fork_facts (id TEXT PRIMARY KEY, payload TEXT, extra TEXT DEFAULT 'keep');
      INSERT INTO unknown_fork_facts (id, payload) VALUES ('unknown1', 'opaque');
    `)
  } finally {
    db.close()
  }
}

// Source: F create-core-tables-sql and migrations 31/32/33/34/36/37/39; v38 has no DDL.
const FORK39_ADDITIVE_SQL = `
ALTER TABLE dispatch_contexts ADD COLUMN retry_of_dispatch_id TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN creator_dispatch_id TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN host_scope TEXT;
ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_id TEXT;
ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_incarnation TEXT;
ALTER TABLE worker_terminal_resources ADD COLUMN recovery_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_terminal_resources ADD COLUMN last_recovery_at TEXT;
ALTER TABLE messages ADD COLUMN pointer_enter_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN pointer_pty_id TEXT;
ALTER TABLE messages ADD COLUMN pointer_process_incarnation TEXT;
CREATE INDEX idx_messages_pending_pointer_enter
  ON messages(to_handle, sequence) WHERE read = 0 AND pointer_enter_pending > 0;
ALTER TABLE deliveries ADD COLUMN mailbox_handle TEXT NOT NULL DEFAULT '';
DROP INDEX idx_deliveries_one_outstanding;
CREATE UNIQUE INDEX idx_deliveries_one_outstanding
  ON deliveries(mailbox_handle) WHERE status = 'outstanding' AND mailbox_handle != '';
ALTER TABLE dispatch_contexts ADD COLUMN consumer_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE remote_dispatch_attachments ADD COLUMN consumer_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dispatch_contexts ADD COLUMN creator_handle TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN creator_pane_key TEXT;
CREATE TABLE attempt_observation_facts (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  authority_id TEXT NOT NULL,
  authority_clock TEXT NOT NULL,
  facet TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_observed_at INTEGER,
  execution_received_at INTEGER,
  home_received_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dispatch_id, sequence)
);
CREATE INDEX idx_attempt_observation_facts_projection
  ON attempt_observation_facts(dispatch_id, facet, sequence);
CREATE TRIGGER trg_tasks_delete_additive_lifecycle AFTER DELETE ON tasks
BEGIN
  DELETE FROM attempt_observation_facts WHERE task_id = OLD.id;
END;
CREATE TRIGGER trg_dispatches_delete_additive_lifecycle AFTER DELETE ON dispatch_contexts
BEGIN
  DELETE FROM attempt_observation_facts WHERE dispatch_id = OLD.id;
END;
CREATE TABLE structured_pointer_operations (
  mailbox_handle TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  batch_fingerprint TEXT NOT NULL,
  minted_at_ms INTEGER NOT NULL
);
DROP TABLE worker_terminal_archives;
CREATE TABLE worker_terminal_archives (
  dispatch_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('transcript_pin', 'terminal_tail', 'structured_journal')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`
