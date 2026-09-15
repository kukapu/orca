import type { OrchestrationDb } from '../../../../orchestration/db'
import type {
  WorkerTerminalResourceRow,
  WorkerTerminalRetainedReason
} from '../../../../orchestration/worker-terminal-ownership'
import { isPersistedStructuredWorkerResource } from '../../../../orchestration/worker-terminal-ownership'
import { getPersistedSchemaCapabilities } from '../../../../orchestration/db/schema/persisted-schema-capabilities'
import { archiveSummary } from './worker-terminal-resource-presentation'

export type WorkerReleaseReceipt = {
  dispatchId: string
  state: 'released' | 'already_released' | 'retained' | 'release_pending' | 'release_unknown'
  reason?: WorkerTerminalRetainedReason
  processAction: 'closed_agent_terminal' | 'closed_exited_terminal' | 'none'
  archive: { source: string | null; status: string | null } | null
  recovery?: string
  lastError?: string
}

export function releaseUnknownRecovery(dispatchId: string): string {
  return `Inspect with: orca orchestration worker-show --dispatch ${dispatchId} --json — then retry worker-release with a fresh request ID (omit --retry-request to let the CLI generate one). Reusing the prior request ID only replays this release_unknown receipt. Never substitute a broad terminal close.`
}

export function retainUnprovenRelease(
  db: OrchestrationDb,
  dispatchId: string,
  resourceId: string
): WorkerReleaseReceipt {
  const retained = db.revertWorkerTerminalReleaseToRetained(resourceId, 'identity_unproven')
  return {
    dispatchId,
    state: 'retained',
    reason: 'identity_unproven',
    processAction: 'none',
    archive: archiveSummary(retained)
  }
}

export function fork39StructuredReleaseReceipt(
  db: OrchestrationDb,
  dispatchId: string,
  resource: WorkerTerminalResourceRow
): WorkerReleaseReceipt | null {
  if (
    !isPersistedStructuredWorkerResource(resource, db.getWorkerTerminalArchive(dispatchId)) ||
    getPersistedSchemaCapabilities(db.db).profile !== 'fork39'
  ) {
    return null
  }
  return {
    dispatchId,
    state: 'retained',
    reason: 'identity_unproven',
    processAction: 'none',
    archive: archiveSummary(resource)
  }
}
