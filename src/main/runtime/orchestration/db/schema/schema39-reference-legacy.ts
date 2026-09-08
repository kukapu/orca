import { DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL } from '../pane-key-match'

// DDL retained by F from migrations7/8/19/25/26 and the mailbox index probes.
export const SCHEMA39_REFERENCE_LEGACY = `
CREATE TABLE question_threads (
  message_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, dispatch_id TEXT NOT NULL,
  asker_handle TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'answered', 'closed')),
  answer_message_id TEXT, answer_body TEXT, answered_by_generation INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT, closed_at TEXT
);
CREATE TABLE legacy_adoptions (
  source_run_id TEXT PRIMARY KEY, adopted_run_id TEXT UNIQUE NOT NULL,
  scheduler_state_lost INTEGER NOT NULL, adopted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE legacy_compatibility_principals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, dispatch_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('worker', 'coordinator')), host_scope TEXT NOT NULL,
  terminal_handle TEXT NOT NULL, pane_key TEXT NOT NULL, launch_token_hash TEXT NOT NULL,
  process_incarnation TEXT, status TEXT NOT NULL CHECK(status IN ('committed', 'settled', 'revoked')),
  CHECK((role = 'worker' AND dispatch_id IS NOT NULL) OR (role = 'coordinator' AND dispatch_id IS NULL)),
  UNIQUE(role, run_id, dispatch_id)
);
CREATE TABLE legacy_operation_receipts (
  principal_id TEXT NOT NULL, operation_key TEXT NOT NULL, method TEXT NOT NULL,
  payload_hash TEXT NOT NULL, effect_id TEXT NOT NULL, response_json TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(principal_id, operation_key)
);
CREATE TABLE legacy_mail_receipts (
  principal_id TEXT NOT NULL, message_id TEXT NOT NULL, acknowledged_at TEXT,
  PRIMARY KEY(principal_id, message_id)
);
CREATE TABLE mutation_receipt_ledger (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  receipt_count INTEGER NOT NULL CHECK(receipt_count >= 0)
);
CREATE TRIGGER mutation_receipts_count_insert AFTER INSERT ON mutation_receipts
BEGIN UPDATE mutation_receipt_ledger SET receipt_count = receipt_count + 1 WHERE singleton = 1; END;
CREATE TRIGGER mutation_receipts_count_delete AFTER DELETE ON mutation_receipts
BEGIN UPDATE mutation_receipt_ledger SET receipt_count = receipt_count - 1 WHERE singleton = 1; END;
CREATE INDEX idx_mutation_receipts_completed_updated
  ON mutation_receipts(updated_at) WHERE state = 'completed';
CREATE UNIQUE INDEX idx_legacy_principal_coordinator
  ON legacy_compatibility_principals(run_id) WHERE role = 'coordinator';
CREATE UNIQUE INDEX idx_legacy_principal_dispatch
  ON legacy_compatibility_principals(dispatch_id) WHERE role = 'worker';
CREATE INDEX idx_questions_dispatch_status ON question_threads(dispatch_id, status);
CREATE INDEX idx_messages_run_sequence ON messages(run_id, sequence);
CREATE INDEX idx_tasks_run_status ON tasks(run_id, status);
CREATE INDEX idx_dispatch_run_status ON dispatch_contexts(run_id, status);
CREATE INDEX idx_gates_run_status ON decision_gates(run_id, status);
CREATE INDEX idx_runs_coordinator_pane ON runs(coordinator_pane_key);
CREATE INDEX idx_messages_delivery_contract ON messages(run_id, delivery_contract, to_handle, read, sequence);
CREATE INDEX idx_messages_undelivered_inbox ON messages(to_handle, read, delivered_at, sequence);
CREATE INDEX idx_messages_undelivered_direct_run ON messages(run_id, to_handle, sequence)
  WHERE read = 0 AND delivered_at IS NULL AND delivery_contract = 'current_delivery';
CREATE INDEX idx_messages_unread_current_inbox ON messages(to_handle, sequence)
  WHERE read = 0 AND delivery_contract = 'current_delivery';
CREATE INDEX idx_messages_unread_current_inbox_type ON messages(to_handle, type, sequence)
  WHERE read = 0 AND delivery_contract = 'current_delivery';
CREATE INDEX idx_messages_unread_current_run_type ON messages(run_id, to_handle, type, sequence)
  WHERE read = 0 AND delivery_contract = 'current_delivery';
CREATE INDEX idx_dispatch_active_assignee_handle ON dispatch_contexts(assignee_handle)
  WHERE assignee_handle IS NOT NULL AND status IN ('pending', 'dispatched');
CREATE INDEX idx_dispatch_assignee_pane_leaf ON dispatch_contexts(${DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL})
  WHERE assignee_pane_key IS NOT NULL AND status IN ('pending', 'dispatched');
CREATE INDEX idx_dispatch_active_run_assignee_handle ON dispatch_contexts(run_id, assignee_handle)
  WHERE assignee_handle IS NOT NULL AND status IN ('pending', 'dispatched');
CREATE INDEX idx_dispatch_active_run_pane_leaf ON dispatch_contexts(run_id, ${DISPATCH_PANE_KEY_MATCH_SUFFIX_SQL})
  WHERE assignee_pane_key IS NOT NULL AND status IN ('pending', 'dispatched');
CREATE INDEX idx_dispatch_active_assignee_pane_key ON dispatch_contexts(assignee_pane_key)
  WHERE assignee_pane_key IS NOT NULL AND status IN ('pending', 'dispatched');
`
