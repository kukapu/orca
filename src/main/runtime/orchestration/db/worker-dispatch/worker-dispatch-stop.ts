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
import { transitionLifecycleWithDb } from '../lifecycle-transition'

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
    } else if (!['ready', 'start_unknown'].includes(worker.state)) {
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
      // The operator-close adoption: the exit handler recorded the deliberate
      // teardown as failed/process_exited — that IS this stop's settlement.
      from: exitSettledByOperatorClose ? ['stopping', 'failed'] : 'stopping',
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
      // failDispatch-first leaves the Task re-dispatchable (ready); a settled stop
      // blocks it. beginStop-first already blocked it — do not demand ready again.
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

export function markWorkerStopUnknown(
  this: OrchestrationDb,
  dispatchId: string,
  reason: string
): WorkerDispatchRow {
  const worker = this.getWorkerDispatch(dispatchId)
  if (!worker || worker.state !== 'stopping') {
    throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not stopping.`)
  }
  this.db.exec('SAVEPOINT mark_worker_stop_unknown')
  try {
    transitionLifecycleWithDb(this.db, {
      entity: 'worker',
      id: dispatchId,
      from: 'stopping',
      to: 'stop_unknown',
      projection: {
        stage: 'stop_outcome_unknown',
        last_error: reason,
        updated_at: new Date().toISOString()
      }
    })
    this.db.exec('RELEASE mark_worker_stop_unknown')
    return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
  } catch (error) {
    this.db.exec('ROLLBACK TO mark_worker_stop_unknown')
    this.db.exec('RELEASE mark_worker_stop_unknown')
    throw error
  }
}

export type WorkerDispatchStopMethods = {
  isDispatchProcessCurrent: typeof isDispatchProcessCurrent
  beginWorkerStop: typeof beginWorkerStop
  settleWorkerStop: typeof settleWorkerStop
  markWorkerStopUnknown: typeof markWorkerStopUnknown
}

export function attachWorkerDispatchStop(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    isDispatchProcessCurrent,
    beginWorkerStop,
    settleWorkerStop,
    markWorkerStopUnknown
  })
}
