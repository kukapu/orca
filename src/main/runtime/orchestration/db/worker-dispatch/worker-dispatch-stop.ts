import type { DispatchContextRow, WorkerDispatchRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import {
  releaseContextOnlyDispatch,
  type ContextOnlyDispatchReleaseResult
} from '../../context-only-dispatch-release'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { isEquivalentPaneKey } from '../pane-key-match'
import type { OrchestrationDb } from '../orchestration-db'
import { reconcileTaskAfterDispatchInterruption } from '../dispatch-context/task-dispatch-reconciliation'
import {
  beginLifecycleWriteTransaction,
  commitLifecycleWriteTransaction,
  rollbackLifecycleWriteTransaction,
  transitionLifecycleWithDb
} from '../lifecycle-transition'
import {
  markWorkerStopUnknown,
  resumeFederatedWorkerForTerminalRelay
} from './worker-dispatch-stop-unknown'

/**
 * A `failed` record whose prompt bytes were written but whose effect was never observed:
 * the delivery could still have executed, so the worker may still own a live process.
 * A report-settled failure (`stage = 'settled'`) is the worker's own verdict, not this case.
 */
export function isUnobservedPromptFailure(worker: {
  state: string
  stage: string
  last_error: string | null
}): boolean {
  return (
    worker.state === 'failed' &&
    worker.stage !== 'settled' &&
    worker.last_error === AGENT_PROMPT_STALLED_ERROR
  )
}

export function isRecoverableUnobservedPromptDispatch(dispatch: {
  status: string
  last_failure: string | null
  capability_hash: string | null
  capability_revoked_at: string | null
}): boolean {
  return (
    dispatch.status === 'failed' &&
    dispatch.last_failure === AGENT_PROMPT_STALLED_ERROR &&
    dispatch.capability_revoked_at == null &&
    typeof dispatch.capability_hash === 'string' &&
    dispatch.capability_hash.length > 0
  )
}

export function isDispatchProcessCurrent(
  this: OrchestrationDb,
  params: {
    dispatchId: string
    paneKey: string | null
    processIncarnation: string | null
  }
): boolean {
  const dispatch = this.getDispatchContextById(params.dispatchId)
  return Boolean(
    dispatch?.assignee_pane_key &&
    params.paneKey &&
    isEquivalentPaneKey(dispatch.assignee_pane_key, params.paneKey) &&
    dispatch.process_incarnation &&
    params.processIncarnation === dispatch.process_incarnation
  )
}

export function beginWorkerStop(
  this: OrchestrationDb,
  dispatchId: string,
  runtimeEpoch: string
):
  | { disposition: 'stopping'; worker: WorkerDispatchRow; dispatch: DispatchContextRow }
  | { disposition: 'already_settled'; worker: WorkerDispatchRow; dispatch: DispatchContextRow }
  | ({ disposition: 'context_only' } & ContextOnlyDispatchReleaseResult) {
  this.db.exec('BEGIN IMMEDIATE')
  try {
    const dispatch = this.getDispatchContextById(dispatchId)
    const worker = this.getWorkerDispatch(dispatchId)
    if (!dispatch) {
      throw new OrchestrationError('dispatch_not_found', `Dispatch ${dispatchId} was not found.`)
    }
    if (!worker) {
      const released = releaseContextOnlyDispatch(this.db, dispatch, 'stopped')
      if (!released.alreadySettled) {
        this.closeQuestionsForDispatch(dispatchId)
      }
      this.db.exec('COMMIT')
      return { disposition: 'context_only', ...released }
    }
    if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(worker.state)) {
      // Why the exception: a failure recorded for an unobserved prompt is a delivery
      // verdict, not a process verdict — the worker may still be executing the prompt,
      // so stop must still reach its terminal instead of answering already-settled.
      if (!isUnobservedPromptFailure(worker)) {
        this.db.exec('COMMIT')
        return { disposition: 'already_settled', worker, dispatch }
      }
    }
    // Why `stopping` under a DIFFERENT epoch is accepted: a stop whose runtime died mid-flight
    // leaves the row here forever, and refusing the re-issue was the only operator escape
    // (#16904). Re-running the stop earns the honest outcome — settled, or `stop_unknown`, from
    // which the worker can be abandoned. It never asserts an exit the runtime did not observe.
    //
    // Why the epoch and not just the state: this runtime's own `stopping` row means its stop is
    // still in flight, and a second pass would record `stop_unknown` over it. The exit event that
    // follows claims a clean stop only from `stopping` under its own epoch
    // (failActiveDispatchOnExit), so it would then read the operator's stop as a crash and
    // escalate it. Same predicate as that reader, so both agree on whose stop this is.
    const stopStrandedByAnotherRuntime =
      worker.state === 'stopping' && worker.runtime_epoch !== runtimeEpoch
    if (
      !['ready', 'start_unknown'].includes(worker.state) &&
      !stopStrandedByAnotherRuntime &&
      !isUnobservedPromptFailure(worker)
    ) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Dispatch ${dispatchId} cannot stop from ${worker.state}.`
      )
    }
    transitionLifecycleWithDb(this.db, {
      entity: 'worker',
      id: dispatchId,
      from: worker.state,
      to: 'stopping',
      projection: {
        stage: 'stop_requested',
        runtime_epoch: runtimeEpoch,
        updated_at: new Date().toISOString()
      }
    })
    transitionLifecycleWithDb(this.db, {
      entity: 'dispatch',
      id: dispatchId,
      from: dispatch.status,
      to: dispatch.status,
      projection: {
        capability_revoked_at: dispatch.capability_revoked_at ?? new Date().toISOString()
      }
    })
    reconcileTaskAfterDispatchInterruption(this, dispatch.task_id, dispatchId)
    this.closeQuestionsForDispatch(dispatchId)
    this.db.exec('COMMIT')
    return {
      disposition: 'stopping',
      worker: this.getWorkerDispatch(dispatchId) as WorkerDispatchRow,
      dispatch: this.getDispatchContextById(dispatchId) as DispatchContextRow
    }
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

export function settleWorkerStop(this: OrchestrationDb, dispatchId: string): WorkerDispatchRow {
  this.db.exec('BEGIN IMMEDIATE')
  try {
    const worker = this.getWorkerDispatch(dispatchId)
    const dispatch = this.getDispatchContextById(dispatchId)
    // Why the adoption: the pty-exit handler can record the deliberate teardown
    // (failDispatch with workerProcessExited) before the stop's own settle lands —
    // that record is the very operator close this stop requested, so the receipt
    // must be `stopped`, not a false "is not stopping". Only an explicitly recorded
    // operator_close qualifies; a signal or unverified exit is never adopted.
    const exitSettledByOperatorClose =
      worker?.state === 'failed' &&
      worker.stage === 'process_exited' &&
      dispatch?.termination_reason === 'operator_close'
    if (!worker || !dispatch || (worker.state !== 'stopping' && !exitSettledByOperatorClose)) {
      throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not stopping.`)
    }
    transitionLifecycleWithDb(this.db, {
      entity: 'worker',
      id: dispatchId,
      from: worker.state,
      to: 'stopped',
      projection: { stage: 'process_stopped', updated_at: new Date().toISOString() }
    })
    if (['pending', 'dispatched'].includes(dispatch.status)) {
      transitionLifecycleWithDb(this.db, {
        entity: 'dispatch',
        id: dispatchId,
        from: dispatch.status,
        to: 'failed',
        projection: { completed_at: new Date().toISOString(), last_failure: 'stopped' }
      })
    }
    if (exitSettledByOperatorClose) {
      const task = this.getTask(dispatch.task_id)
      if (task?.status === 'ready') {
        transitionLifecycleWithDb(this.db, {
          entity: 'task',
          id: dispatch.task_id,
          from: 'ready',
          to: 'blocked'
        })
      }
    }
    reconcileTaskAfterDispatchInterruption(this, dispatch.task_id, dispatchId)
    this.db.exec('COMMIT')
    return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

export function reconcileFederatedWorkerStop(
  this: OrchestrationDb,
  dispatchId: string
): WorkerDispatchRow {
  const transaction = beginLifecycleWriteTransaction(this.db, 'federated_worker_stop_reconcile')
  try {
    const worker = this.getWorkerDispatch(dispatchId)
    const dispatch = this.getDispatchContextById(dispatchId)
    if (!worker || !dispatch || !this.getFederatedDispatch(dispatchId)) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Federated Dispatch ${dispatchId} was not found.`
      )
    }
    if (worker.state === 'stopped') {
      commitLifecycleWriteTransaction(this.db, transaction)
      return worker
    }
    // Why: the worker's own report can settle the row while a stop is in flight; the
    // report is first-hand evidence and must not be clobbered by the stop receipt.
    if (worker.state === 'succeeded' || worker.state === 'failed') {
      commitLifecycleWriteTransaction(this.db, transaction)
      return worker
    }
    if (!['stopping', 'stop_unknown'].includes(worker.state)) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Federated Dispatch ${dispatchId} cannot reconcile stop from ${worker.state}.`
      )
    }
    transitionLifecycleWithDb(this.db, {
      entity: 'worker',
      id: dispatchId,
      from: worker.state,
      to: 'stopped',
      projection: {
        stage: 'process_stopped',
        last_error: null,
        updated_at: new Date().toISOString()
      }
    })
    if (['pending', 'dispatched'].includes(dispatch.status)) {
      transitionLifecycleWithDb(this.db, {
        entity: 'dispatch',
        id: dispatchId,
        from: dispatch.status,
        to: 'failed',
        projection: {
          completed_at: dispatch.completed_at ?? new Date().toISOString(),
          last_failure: 'stopped'
        }
      })
    }
    reconcileTaskAfterDispatchInterruption(this, dispatch.task_id, dispatchId)
    commitLifecycleWriteTransaction(this.db, transaction)
    return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
  } catch (error) {
    rollbackLifecycleWriteTransaction(this.db, transaction)
    throw error
  }
}

export type WorkerDispatchStopMethods = {
  isDispatchProcessCurrent: typeof isDispatchProcessCurrent
  beginWorkerStop: typeof beginWorkerStop
  settleWorkerStop: typeof settleWorkerStop
  reconcileFederatedWorkerStop: typeof reconcileFederatedWorkerStop
  resumeFederatedWorkerForTerminalRelay: typeof resumeFederatedWorkerForTerminalRelay
  markWorkerStopUnknown: typeof markWorkerStopUnknown
}

export function attachWorkerDispatchStop(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    isDispatchProcessCurrent,
    beginWorkerStop,
    settleWorkerStop,
    reconcileFederatedWorkerStop,
    resumeFederatedWorkerForTerminalRelay,
    markWorkerStopUnknown
  })
}
