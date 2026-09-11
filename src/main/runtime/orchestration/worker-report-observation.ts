import type { MessageRow } from './types'
import { hasLifecycleRejectionMarker } from './db/lifecycle-rejection-marker'

export type WorkerReportObservation = {
  id: string
  authorityId: string
  homeReceivedAt: number
}

export function workerReportObservation(msg: MessageRow): WorkerReportObservation | undefined {
  if (msg.type !== 'worker_done' || hasLifecycleRejectionMarker(msg.payload)) {
    return undefined
  }
  return {
    id: `worker_report:${msg.id}`,
    authorityId: `run_home:${msg.run_id}`,
    homeReceivedAt: Date.parse(msg.created_at)
  }
}
