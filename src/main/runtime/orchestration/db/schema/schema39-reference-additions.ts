// da3def1b0f DDL: reference-only, never an upgrade recipe for a persisted database.
export const SCHEMA39_REFERENCE_ADDITIONS = `
ALTER TABLE dispatch_contexts ADD COLUMN retry_of_dispatch_id TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN creator_dispatch_id TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN host_scope TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN consumer_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dispatch_contexts ADD COLUMN creator_handle TEXT;
ALTER TABLE dispatch_contexts ADD COLUMN creator_pane_key TEXT;
ALTER TABLE remote_dispatch_attachments ADD COLUMN consumer_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_id TEXT;
ALTER TABLE worker_terminal_resources ADD COLUMN endpoint_incarnation TEXT;
ALTER TABLE worker_terminal_resources ADD COLUMN recovery_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_terminal_resources ADD COLUMN last_recovery_at TEXT;
ALTER TABLE messages ADD COLUMN pointer_enter_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN pointer_pty_id TEXT;
ALTER TABLE messages ADD COLUMN pointer_process_incarnation TEXT;
ALTER TABLE deliveries ADD COLUMN mailbox_handle TEXT NOT NULL DEFAULT '';
DROP INDEX idx_deliveries_one_outstanding;
CREATE UNIQUE INDEX idx_deliveries_one_outstanding
  ON deliveries(mailbox_handle) WHERE status = 'outstanding' AND mailbox_handle != '';
CREATE INDEX idx_messages_pending_pointer_enter
  ON messages(to_handle, sequence) WHERE read = 0 AND pointer_enter_pending > 0;
CREATE TABLE attempt_observation_facts (
  id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL, task_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, authority_id TEXT NOT NULL, authority_clock TEXT NOT NULL,
  facet TEXT NOT NULL, payload TEXT NOT NULL, source_observed_at INTEGER,
  execution_received_at INTEGER, home_received_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(dispatch_id, sequence)
);
CREATE INDEX idx_attempt_observation_facts_projection
  ON attempt_observation_facts(dispatch_id, facet, sequence);
CREATE TRIGGER trg_tasks_delete_additive_lifecycle AFTER DELETE ON tasks
BEGIN DELETE FROM attempt_observation_facts WHERE task_id = OLD.id; END;
CREATE TRIGGER trg_dispatches_delete_additive_lifecycle AFTER DELETE ON dispatch_contexts
BEGIN DELETE FROM attempt_observation_facts WHERE dispatch_id = OLD.id; END;
CREATE TABLE structured_pointer_operations (
  mailbox_handle TEXT PRIMARY KEY, session_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  batch_fingerprint TEXT NOT NULL, minted_at_ms INTEGER NOT NULL
);
DROP TABLE worker_terminal_archives;
CREATE TABLE worker_terminal_archives (
  dispatch_id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('transcript_pin', 'terminal_tail', 'structured_journal')),
  content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// F and T use this same trigger; validating it lets39 keep it rather than DROP/CREATE it on open.
export const SCHEMA39_ROUTING_TRIGGER = `
CREATE TRIGGER trg_messages_route_coordinator_mail
AFTER INSERT ON messages
WHEN NEW.read = 0 AND NEW.delivery_contract = 'current_delivery'
  AND EXISTS (SELECT 1 FROM runs WHERE runs.id = NEW.run_id AND runs.legacy = 0)
  AND EXISTS (SELECT 1 FROM run_coordinator_handles
              WHERE run_id = NEW.run_id AND terminal_handle = NEW.to_handle)
  AND NOT EXISTS (SELECT 1 FROM dispatch_contexts
                  WHERE run_id = NEW.run_id AND assignee_handle = NEW.to_handle
                    AND status IN ('pending', 'dispatched'))
BEGIN
  UPDATE messages SET to_handle = 'run:' || NEW.run_id WHERE sequence = NEW.sequence;
END;
`
