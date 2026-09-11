import type { WorkerDispatchRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { transitionLifecycleWithDb } from '../lifecycle-transition'

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
