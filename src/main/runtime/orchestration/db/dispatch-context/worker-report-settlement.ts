import type { WorkerReportOutcome, WorkerReportSettlement } from '../../types'
import type { OrchestrationDb } from '../orchestration-db'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'
import { settleActiveDispatchesForTask } from './dispatch-completion'
import { getActiveDispatchForTask } from './task-dispatch-reconciliation'
import type { WorkerReportObservation } from '../../worker-report-observation'
import { recordAcceptedWorkerReportFact } from '../accepted-worker-report-fact'
import { transitionLifecycleWithDb } from '../lifecycle-transition'
import { runLifecycleWriteTransaction } from '../lifecycle-write-transaction-runner'

const WORKER_REPORT_TRANSACTION_SAVEPOINT = 'worker_report_transaction'

export function settleWorkerReport(
  this: OrchestrationDb,
  params: {
    taskId: string
    dispatchId: string
    outcome: WorkerReportOutcome
    result: string
    observation?: WorkerReportObservation
  }
): WorkerReportSettlement {
  return runLifecycleWriteTransaction(this.db, WORKER_REPORT_TRANSACTION_SAVEPOINT, () =>
    this.settleWorkerReportInTransaction(params)
  )
}

export function settleWorkerReportInTransaction(
  this: OrchestrationDb,
  params: {
    taskId: string
    dispatchId: string
    outcome: WorkerReportOutcome
    result: string
    observation?: WorkerReportObservation
  }
): WorkerReportSettlement {
  const task = this.getTask(params.taskId)
  if (!task) {
    return { action: 'rejected', code: 'unknown_task', reason: `Unknown task ${params.taskId}.` }
  }
  const dispatch = this.getDispatchContextById(params.dispatchId)
  if (!dispatch) {
    return {
      action: 'rejected',
      code: 'unknown_dispatch',
      reason: `Unknown dispatch ${params.dispatchId}.`
    }
  }
  if (dispatch.task_id !== params.taskId) {
    return {
      action: 'rejected',
      code: 'task_dispatch_mismatch',
      reason: `Dispatch ${params.dispatchId} belongs to task ${dispatch.task_id}, not ${params.taskId}.`
    }
  }

  const expectedDispatchStatus = params.outcome === 'succeeded' ? 'completed' : 'failed'
  const expectedTaskStatus = params.outcome === 'succeeded' ? 'completed' : 'failed'
  // Why (#16095): worker-start records a stalled prompt as failed, but the preamble was written
  // before verification ran — the worker may have been executing it the whole time. Its own report
  // is first-hand evidence and must be able to correct that record instead of being thrown away.
  // Checked before the duplicate short-circuit: a `failed` report lands on the very statuses that
  // short-circuit reads as already settled, dropping the worker's real cause and result body.
  const settledByUnobservedPrompt =
    dispatch.status === 'failed' &&
    dispatch.last_failure === AGENT_PROMPT_STALLED_ERROR &&
    task.status === 'failed'
  const reportingWorker = this.getWorkerDispatch(params.dispatchId)
  if (
    !settledByUnobservedPrompt &&
    dispatch.status === expectedDispatchStatus &&
    task.status === expectedTaskStatus
  ) {
    recordAcceptedWorkerReportFact(this, params)
    return { action: 'settled', outcome: params.outcome, duplicate: true }
  }
  const reconnectingStart =
    (dispatch.status === 'pending' || dispatch.status === 'dispatched') &&
    task.status === 'blocked' &&
    reportingWorker?.state === 'start_unknown'
  const reportingStart =
    dispatch.status === 'pending' &&
    task.status === 'dispatched' &&
    reportingWorker?.state === 'starting'
  const previousDispatchStatus = settledByUnobservedPrompt
    ? 'failed'
    : reconnectingStart || reportingStart
      ? dispatch.status
      : 'dispatched'
  const previousTaskStatus = settledByUnobservedPrompt
    ? 'failed'
    : reconnectingStart
      ? 'blocked'
      : 'dispatched'
  if (dispatch.status !== previousDispatchStatus || task.status !== previousTaskStatus) {
    return {
      action: 'rejected',
      code: 'inactive_dispatch',
      reason: `inactive dispatch ${params.dispatchId}: it or task ${params.taskId} is already settled.`
    }
  }
  const conflictingWorker = this.db
    .prepare(
      `SELECT active.id
       FROM dispatch_contexts active
       JOIN worker_dispatches worker ON worker.dispatch_id = active.id
       WHERE active.task_id = ? AND active.id != ?
         AND active.status IN ('pending', 'dispatched')
         AND worker.state NOT IN ('failed', 'succeeded', 'stopped', 'abandoned')
       ORDER BY active.rowid DESC LIMIT 1`
    )
    .get(params.taskId, params.dispatchId) as { id: string } | undefined
  if (conflictingWorker) {
    return {
      action: 'rejected',
      code: 'inactive_dispatch',
      reason: `Task ${params.taskId} still has active supervised Dispatch ${conflictingWorker.id}; stop or settle it before completing ${params.dispatchId}.`
    }
  }
  const latest = getActiveDispatchForTask(this, params.taskId)
  if (!reportingWorker && latest?.id !== params.dispatchId) {
    return {
      action: 'rejected',
      code: 'stale_dispatch',
      reason: `Dispatch ${params.dispatchId} is not the current dispatch for task ${params.taskId}.`
    }
  }
  const siblingDispatchIds = this.db
    .prepare(
      `SELECT id FROM dispatch_contexts
       WHERE task_id = ? AND id != ? AND status IN ('pending', 'dispatched')`
    )
    .all(params.taskId, params.dispatchId) as { id: string }[]

  this.db.exec('SAVEPOINT settle_worker_report')
  try {
    if (settledByUnobservedPrompt) {
      const now = new Date().toISOString()
      transitionLifecycleWithDb(this.db, {
        entity: 'dispatch',
        id: params.dispatchId,
        from: 'failed',
        to: expectedDispatchStatus,
        projection: {
          completed_at: now,
          last_failure: params.outcome === 'failed' ? params.result : dispatch.last_failure,
          capability_revoked_at: dispatch.capability_revoked_at ?? now
        },
        correction: 'unobserved_prompt_report'
      })
      transitionLifecycleWithDb(this.db, {
        entity: 'task',
        id: params.taskId,
        from: 'failed',
        to: expectedTaskStatus,
        projection: { result: params.result, completed_at: now },
        correction: 'unobserved_prompt_report'
      })
    } else {
      if (reconnectingStart) {
        transitionLifecycleWithDb(this.db, {
          entity: 'task',
          id: params.taskId,
          from: 'blocked',
          to: 'dispatched'
        })
      }
      transitionLifecycleWithDb(this.db, {
        entity: 'dispatch',
        id: params.dispatchId,
        from: reconnectingStart || reportingStart ? ['pending', 'dispatched'] : 'dispatched',
        to: expectedDispatchStatus,
        projection: {
          completed_at: new Date().toISOString(),
          last_failure: params.outcome === 'failed' ? params.result : dispatch.last_failure,
          capability_revoked_at: dispatch.capability_revoked_at ?? new Date().toISOString()
        }
      })
      transitionLifecycleWithDb(this.db, {
        entity: 'task',
        id: params.taskId,
        from: 'dispatched',
        to: expectedTaskStatus,
        projection: { result: params.result, completed_at: new Date().toISOString() }
      })
    }
    if (settledByUnobservedPrompt) {
      if (
        reportingWorker &&
        (reportingWorker.state === 'stopping' || reportingWorker.state === 'stop_unknown')
      ) {
        transitionLifecycleWithDb(this.db, {
          entity: 'worker',
          id: params.dispatchId,
          from: reportingWorker.state,
          to: 'failed',
          projection: { stage: 'settled', updated_at: new Date().toISOString() }
        })
      }
      if (reportingWorker) {
        transitionLifecycleWithDb(this.db, {
          entity: 'worker',
          id: params.dispatchId,
          from: 'failed',
          to: params.outcome === 'succeeded' ? 'succeeded' : 'failed',
          projection: { stage: 'settled', updated_at: new Date().toISOString() },
          correction: 'unobserved_prompt_report'
        })
      }
    } else if ((reconnectingStart || reportingStart) && params.outcome === 'succeeded') {
      transitionLifecycleWithDb(this.db, {
        entity: 'worker',
        id: params.dispatchId,
        from: reportingStart ? 'starting' : 'start_unknown',
        to: 'ready'
      })
      transitionLifecycleWithDb(this.db, {
        entity: 'worker',
        id: params.dispatchId,
        from: 'ready',
        to: 'succeeded',
        projection: { stage: 'settled', updated_at: new Date().toISOString() }
      })
    } else if (reportingWorker) {
      transitionLifecycleWithDb(this.db, {
        entity: 'worker',
        id: params.dispatchId,
        // A start_unknown success report reconnects through 'ready' above; only failure settles here.
        from: params.outcome === 'succeeded' ? 'ready' : ['ready', 'start_unknown', 'starting'],
        to: params.outcome === 'succeeded' ? 'succeeded' : 'failed',
        projection: { stage: 'settled', updated_at: new Date().toISOString() }
      })
    }
    settleActiveDispatchesForTask(
      this,
      params.taskId,
      expectedDispatchStatus,
      params.outcome === 'failed' ? params.result : undefined
    )
    this.closeQuestionsForDispatch(params.dispatchId)
    for (const sibling of siblingDispatchIds) {
      this.closeQuestionsForDispatch(sibling.id)
    }
    if (params.outcome === 'succeeded') {
      this.promoteReadyTasks(params.taskId)
    }
    recordAcceptedWorkerReportFact(this, params)
    this.db.exec('RELEASE settle_worker_report')
    return { action: 'settled', outcome: params.outcome, duplicate: false }
  } catch (error) {
    this.db.exec('ROLLBACK TO settle_worker_report')
    this.db.exec('RELEASE settle_worker_report')
    throw error
  }
}

export type WorkerReportSettlementMethods = {
  settleWorkerReport: typeof settleWorkerReport
  settleWorkerReportInTransaction: typeof settleWorkerReportInTransaction
}

export function attachWorkerReportSettlement(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    settleWorkerReport,
    settleWorkerReportInTransaction
  })
}
