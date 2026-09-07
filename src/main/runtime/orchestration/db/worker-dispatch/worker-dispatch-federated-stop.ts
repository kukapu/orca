import type { WorkerDispatchRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { reconcileTaskAfterDispatchInterruption } from '../dispatch-context/task-dispatch-reconciliation'
import {
  beginLifecycleWriteTransaction,
  commitLifecycleWriteTransaction,
  rollbackLifecycleWriteTransaction,
  transitionLifecycleWithDb
} from '../lifecycle-transition'

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
      this.db.exec('COMMIT')
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

export function resumeFederatedWorkerForTerminalRelay(
  this: OrchestrationDb,
  dispatchId: string
): WorkerDispatchRow {
  this.db.exec('BEGIN IMMEDIATE')
  try {
    const worker = this.getWorkerDispatch(dispatchId)
    const dispatch = this.getDispatchContextById(dispatchId)
    if (!worker || !dispatch || worker.state !== 'stopping') {
      throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not stopping.`)
    }
    transitionLifecycleWithDb(this.db, {
      entity: 'worker',
      id: dispatchId,
      from: 'stopping',
      to: 'ready',
      projection: { stage: 'remote_report_pending', updated_at: new Date().toISOString() }
    })
    const task = this.getTask(dispatch.task_id)
    if (task?.status === 'blocked') {
      transitionLifecycleWithDb(this.db, {
        entity: 'task',
        id: dispatch.task_id,
        from: 'blocked',
        to: 'dispatched'
      })
    }
    this.db.exec('COMMIT')
    return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}

export type WorkerDispatchFederatedStopMethods = {
  reconcileFederatedWorkerStop: typeof reconcileFederatedWorkerStop
  resumeFederatedWorkerForTerminalRelay: typeof resumeFederatedWorkerForTerminalRelay
}

export function attachWorkerDispatchFederatedStop(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    reconcileFederatedWorkerStop,
    resumeFederatedWorkerForTerminalRelay
  })
}
