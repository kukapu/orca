import { describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../../../../orchestration/db'
import { failWorkerStartWithReceipt } from './worker-start-receipt'
import { failFederatedAttachmentWithReceipt } from '../federation/federation-start-receipt'
import { createWorkerLaunchReceipt } from './worker-launch-preferences'
import { isUnknownWorkerStartOutcome } from './worker-topology'

describe('worker start outcome classification', () => {
  it('treats an explicit operation_unknown code as unknown at any stage', () => {
    const error = Object.assign(new Error('relay dropped'), { code: 'operation_unknown' })

    expect(isUnknownWorkerStartOutcome(error, 'dispatch_input')).toBe(true)
    expect(isUnknownWorkerStartOutcome(error, 'worktree_create')).toBe(true)
  })

  it('treats a lost connection during worktree create as unknown', () => {
    expect(isUnknownWorkerStartOutcome(new Error('connection reset'), 'worktree_create')).toBe(true)
    expect(isUnknownWorkerStartOutcome(new Error('request timed out'), 'worktree_create')).toBe(
      true
    )
  })

  it('keeps a definite failure definite', () => {
    expect(isUnknownWorkerStartOutcome(new Error('connection reset'), 'dispatch_input')).toBe(false)
    expect(isUnknownWorkerStartOutcome(new Error('worktree exists'), 'worktree_create')).toBe(false)
  })

  // Why: a stalled prompt still reports a definite failure to the caller — the correction path is
  // the worker's own report, which keeps its capability and can re-settle the dispatch (see
  // worker-start-unobserved-prompt-settlement.test.ts), not an outcome_unknown receipt.
  it('does not class a stalled dispatch prompt as unknown', () => {
    expect(isUnknownWorkerStartOutcome(new Error('agent_prompt_stalled'), 'dispatch_input')).toBe(
      false
    )
  })

  it.each([
    { mode: 'local', failStart: failWorkerStartWithReceipt },
    { mode: 'federated', failStart: failFederatedAttachmentWithReceipt }
  ])('preserves a relayed stalled error code in $mode receipts', ({ mode, failStart }) => {
    const recordFailure = vi.fn(() => ({
      state: 'failed',
      stage: 'dispatch_input',
      effects: '[]',
      residual_resources: '[]'
    }))
    const receipt = failStart({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This fixture exercises only receipt creation with no retained terminal resource.
      db: {
        failWorkerStart: recordFailure,
        getWorkerTerminalResourceByOwner: vi.fn(),
        failRemoteAttachment: recordFailure
      } as unknown as OrchestrationDb,
      runId: 'run_test',
      taskId: 'task_test',
      dispatchId: 'ctx_test',
      runtimeEpoch: 'epoch_test',
      failedStage: 'dispatch_input',
      error: { code: 'agent_prompt_stalled', message: 'Remote prompt effect was not observed' },
      setup: {
        requested: 'not_applicable',
        effective: 'not_applicable',
        source: 'test',
        hookFound: false,
        startupPolicy: 'start-immediately',
        state: 'not_applicable'
      },
      launch: createWorkerLaunchReceipt({ agent: 'pi' }),
      mode: {
        mode: 'terminal',
        preferred: 'terminal',
        reason: 'user_default',
        detail: 'test'
      }
    })

    expect(recordFailure).toHaveBeenCalledWith(
      'ctx_test',
      'dispatch_input',
      'agent_prompt_stalled',
      expect.anything(),
      // Federated receipts additionally retain the capability so the worker's own
      // late report can correct the unobserved-prompt record.
      ...(mode === 'federated' ? [{ retainCapability: true }] : [])
    )
    expect(receipt).toMatchObject({ state: 'failed', lastError: 'agent_prompt_stalled' })
  })
})
