import { describe, expect, it } from 'vitest'
import {
  classifyWorkerErrorToken,
  exactWorkerErrorToken,
  extractWorkerDispatchDiagnostics,
  extractWorkerStartReceiptDiagnostics,
  formatWorkerDispatchDiagnostics,
  formatWorkerStartReceiptDiagnostics
} from './real-agent-dispatch-diagnostics'

describe('classifyWorkerErrorToken', () => {
  it('classifies concrete failure families without echoing raw text', () => {
    expect(classifyWorkerErrorToken('ModelNotFoundError: zai-coding-plan/glm-5.3')).toBe(
      'model-not-found'
    )
    expect(classifyWorkerErrorToken('spawn opencode ENOENT at /home/dev/bin')).toBe('spawn')
    expect(classifyWorkerErrorToken('401 unauthorized for provider https://zai.example/path')).toBe(
      'auth'
    )
    expect(classifyWorkerErrorToken('quota exceeded (429)')).toBe('quota')
    expect(classifyWorkerErrorToken('hook listener refused token')).toBe('hook')
    expect(classifyWorkerErrorToken('deadline exceeded after 30000ms')).toBe('timeout')
    expect(classifyWorkerErrorToken('agent_prompt_blocked')).toBe('prompt-blocked')
    expect(classifyWorkerErrorToken('terminal_not_writable')).toBe('terminal-not-writable')
    expect(classifyWorkerErrorToken('terminal_handle_stale')).toBe('handle-stale')
    expect(classifyWorkerErrorToken('agent_prompt_stalled')).toBe('prompt-stalled')
    expect(classifyWorkerErrorToken('something completely different /home/secret')).toBe(
      'other-nonempty'
    )
  })

  it('treats null, undefined, and empty as no error', () => {
    expect(classifyWorkerErrorToken(null)).toBe('none')
    expect(classifyWorkerErrorToken(undefined)).toBe('none')
    expect(classifyWorkerErrorToken('')).toBe('none')
  })
})

describe('extractWorkerDispatchDiagnostics', () => {
  it('whitelists machine tokens and drops raw error text and ids', () => {
    const formatted = formatWorkerDispatchDiagnostics(
      extractWorkerDispatchDiagnostics({
        dispatch: { id: 'd-1', status: 'failed' },
        worker: {
          state: 'failed',
          stage: 'worker_start',
          setup_state: 'not_run',
          last_error: 'ModelNotFoundError: model zai-coding-plan/glm-5.3 not in catalog /home/x',
          runtime_epoch: 'epoch-1',
          worktree_id: 'wt-1',
          agent_terminal_handle: 'term-1',
          start_options: '{"model":"zai-coding-plan/glm-5.3"}'
        },
        observation: { status: 'unverifiable' }
      })
    )
    expect(formatted).toContain('"dispatchStatus":"failed"')
    expect(formatted).toContain('"workerState":"failed"')
    expect(formatted).toContain('"workerStage":"worker_start"')
    expect(formatted).toContain('"errorClass":"model-not-found"')
    expect(formatted).toContain('"observationStatus":"unverifiable"')
    expect(formatted).toContain('"terminalHandlePresent":true')
    // Raw text, ids, and options never reach the report line.
    expect(formatted).not.toContain('glm-5.3')
    expect(formatted).not.toContain('/home/x')
    expect(formatted).not.toContain('d-1')
    expect(formatted).not.toContain('wt-1')
    expect(formatted).not.toContain('term-1')
  })

  it('tolerates missing worker and observation sections', () => {
    const diagnostics = extractWorkerDispatchDiagnostics({ dispatch: { status: 'dispatched' } })
    expect(diagnostics.workerState).toBeNull()
    expect(diagnostics.errorClass).toBe('none')
    expect(diagnostics.runtimeEpochPresent).toBe(false)
    expect(diagnostics.worktreeIdPresent).toBe(false)
    expect(diagnostics.terminalHandlePresent).toBe(false)
    expect(diagnostics.capabilityRevoked).toBe(false)
    expect(diagnostics.observedOptionsPresent).toBe(false)
  })
})

describe('exactWorkerErrorToken / extractWorkerStartReceiptDiagnostics', () => {
  it('matches known runtime tokens by full-string equality only', () => {
    expect(exactWorkerErrorToken('agent_prompt_stalled')).toBe('agent_prompt_stalled')
    expect(exactWorkerErrorToken('terminal_not_writable')).toBe('terminal_not_writable')
    expect(exactWorkerErrorToken('agent_prompt_stalled: extra context /home/x')).toBe(
      'unrecognized'
    )
    expect(exactWorkerErrorToken('The target terminal is in Structured Chat. Switch it.')).toBe(
      'unrecognized'
    )
    expect(exactWorkerErrorToken(null)).toBe('none')
  })

  it('reports refusal enums and pid presence without ids or human copy', () => {
    const formatted = formatWorkerStartReceiptDiagnostics(
      extractWorkerStartReceiptDiagnostics({
        state: 'failed',
        failedStage: 'dispatch_input',
        lastError:
          'The target terminal is in Structured Chat. Switch it to Terminal, then retry `orca orchestration worker-start`.',
        agentSessionRefusal: {
          code: 'agent_session_conflict',
          sessionId: 'sess-secret-1',
          ownerRuntimeKind: 'native',
          handoffStage: 'structured_chat',
          ownerPid: 4242
        }
      })
    )
    expect(formatted).toContain('"lastErrorToken":"unrecognized"')
    expect(formatted).toContain('"refusalCode":"agent_session_conflict"')
    expect(formatted).toContain('"refusalOwnerRuntimeKind":"native"')
    expect(formatted).toContain('"refusalHandoffStage":"structured_chat"')
    expect(formatted).toContain('"refusalOwnerPidPresent":true')
    expect(formatted).not.toContain('sess-secret-1')
    expect(formatted).not.toContain('Structured Chat')
    expect(formatted).not.toContain('4242')
  })

  it('maps stalled receipts and absent refusals cleanly', () => {
    const diagnostics = extractWorkerStartReceiptDiagnostics({
      state: 'failed',
      failedStage: 'dispatch_input',
      lastError: 'agent_prompt_stalled'
    })
    expect(diagnostics.lastErrorToken).toBe('agent_prompt_stalled')
    expect(diagnostics.refusalCode).toBeNull()
    expect(diagnostics.refusalOwnerPidPresent).toBe(false)
    expect(extractWorkerStartReceiptDiagnostics(null).receiptState).toBeNull()
  })

  it('carries capability revocation from the dispatch context', () => {
    const diagnostics = extractWorkerDispatchDiagnostics({
      dispatch: { status: 'failed', capability_revoked_at: '2026-09-06T00:00:00Z' },
      worker: { state: 'failed' }
    })
    expect(diagnostics.capabilityRevoked).toBe(true)
    const clean = extractWorkerDispatchDiagnostics({
      dispatch: { status: 'failed', capability_revoked_at: null },
      worker: { state: 'failed' }
    })
    expect(clean.capabilityRevoked).toBe(false)
  })
})
