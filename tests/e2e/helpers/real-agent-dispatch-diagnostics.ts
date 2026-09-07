/**
 * Sanitized Gate B diagnostics when a real-agent dispatch does not reach
 * `dispatched`. Only machine tokens leave this module: enum states, presence
 * booleans, and a coarse error CLASS — never raw error text (which can embed
 * paths, URLs, or provider responses), env values, or TUI tails.
 */
/** Machine tokens the runtime itself throws on the worker-start prompt path.
 *  Matched by FULL-STRING equality only — anything else is 'unrecognized'. */
export const KNOWN_WORKER_ERROR_TOKENS: readonly string[] = [
  'agent_prompt_stalled',
  'agent_prompt_blocked',
  'terminal_not_writable',
  'terminal_handle_stale'
]

/** Returns the error text's exact known token, or 'unrecognized'/'none'.
 *  Raw text is never embedded in the result. */
export function exactWorkerErrorToken(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'none'
  }
  return KNOWN_WORKER_ERROR_TOKENS.includes(raw) ? raw : 'unrecognized'
}

export type WorkerStartReceiptDiagnostics = {
  receiptState: string | null
  failedStage: string | null
  lastErrorToken: string
  refusalCode: string | null
  refusalOwnerRuntimeKind: string | null
  refusalHandoffStage: string | null
  refusalOwnerPidPresent: boolean
}

/** Whitelist-maps a workerStart receipt. The refusal is reported ONLY through
 *  its machine enums (code/owner/handoff) and a pid-presence flag — never the
 *  structured human copy, session ids, or raw error text. */
export function extractWorkerStartReceiptDiagnostics(
  receipt: unknown
): WorkerStartReceiptDiagnostics {
  const record =
    receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      ? (receipt as Record<string, unknown>)
      : {}
  const refusal =
    record.agentSessionRefusal && typeof record.agentSessionRefusal === 'object'
      ? (record.agentSessionRefusal as Record<string, unknown>)
      : null
  return {
    receiptState: typeof record.state === 'string' ? record.state : null,
    failedStage: typeof record.failedStage === 'string' ? record.failedStage : null,
    lastErrorToken: exactWorkerErrorToken(
      typeof record.lastError === 'string' ? record.lastError : null
    ),
    refusalCode: typeof refusal?.code === 'string' ? refusal.code : null,
    refusalOwnerRuntimeKind:
      typeof refusal?.ownerRuntimeKind === 'string' ? refusal.ownerRuntimeKind : null,
    refusalHandoffStage: typeof refusal?.handoffStage === 'string' ? refusal.handoffStage : null,
    refusalOwnerPidPresent: typeof refusal?.ownerPid === 'number'
  }
}

export type WorkerDispatchDiagnostics = {
  dispatchStatus: string | null
  workerState: string | null
  workerStage: string | null
  workerSetupState: string | null
  errorClass: string
  observationStatus: string | null
  runtimeEpochPresent: boolean
  worktreeIdPresent: boolean
  terminalHandlePresent: boolean
  capabilityRevoked: boolean
  observedOptionsPresent: boolean
}

const WORKER_ERROR_CLASSES: readonly (readonly [string, RegExp])[] = [
  [
    'model-not-found',
    /model[^.]{0,80}(not found|notfound|unknown|unavailable)|ModelNotFoundError/i
  ],
  ['auth', /auth|unauthorized|401|403|api[_ -]?key|credential/i],
  ['quota', /quota|429|rate[_ -]?limit/i],
  ['hook', /hook/i],
  ['spawn', /spawn|enoent|eacces|not[_ -]?executable|shebang/i],
  ['timeout', /timeout|timed[_ -]?out|deadline/i],
  // Machine tokens thrown by the runtime's own prompt path
  // (orca-runtime-write-terminal-agent-prompt.ts / orca-runtime-core.ts).
  ['prompt-blocked', /agent_prompt_blocked|permission/i],
  ['terminal-not-writable', /terminal_not_writable/i],
  ['handle-stale', /terminal_handle_stale/i],
  ['prompt-stalled', /agent_prompt_stalled/i]
]

/** Maps raw worker error text to one coarse class token. Input is never
 *  returned or embedded in the result. */
export function classifyWorkerErrorToken(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'none'
  }
  for (const [token, pattern] of WORKER_ERROR_CLASSES) {
    if (pattern.test(raw)) {
      return token
    }
  }
  return 'other-nonempty'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Whitelist-maps a workerShow/dispatchShow payload to reportable tokens. */
export function extractWorkerDispatchDiagnostics(payload: unknown): WorkerDispatchDiagnostics {
  const root = asRecord(payload)
  const dispatch = asRecord(root.dispatch)
  const worker = asRecord(root.worker)
  const observation = asRecord(root.observation)
  return {
    dispatchStatus: asString(dispatch.status),
    workerState: asString(worker.state),
    workerStage: asString(worker.stage),
    workerSetupState: asString(worker.setup_state),
    errorClass: classifyWorkerErrorToken(
      typeof worker.last_error === 'string' ? worker.last_error : null
    ),
    observationStatus: asString(observation.status),
    runtimeEpochPresent:
      typeof worker.runtime_epoch === 'string' && worker.runtime_epoch.length > 0,
    worktreeIdPresent: typeof worker.worktree_id === 'string' && worker.worktree_id.length > 0,
    terminalHandlePresent:
      typeof worker.agent_terminal_handle === 'string' && worker.agent_terminal_handle.length > 0,
    capabilityRevoked:
      typeof dispatch.capability_revoked_at === 'string' &&
      dispatch.capability_revoked_at.length > 0,
    observedOptionsPresent: 'observedOptions' in observation && observation.observedOptions != null
  }
}

export function formatWorkerDispatchDiagnostics(diagnostics: WorkerDispatchDiagnostics): string {
  return `[GATE-B-DIAG] ${JSON.stringify(diagnostics)}`
}

export function formatWorkerStartReceiptDiagnostics(
  diagnostics: WorkerStartReceiptDiagnostics
): string {
  return `[GATE-B-RECEIPT] ${JSON.stringify(diagnostics)}`
}
