import type { MessageType, OrchestrationDb } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { routeAllMailboxPages } from '../schemas'
import { callerHoldsDispatchPane, dispatchFenced } from './dispatch-mailbox-fence'

export type ActiveDispatch = NonNullable<
  ReturnType<OrchestrationDb['getActiveDispatchForIdentity']>
>
export type RemoteAttachment = NonNullable<
  ReturnType<OrchestrationDb['findActiveRemoteAttachmentForPane']>
>
export type WorkerMailbox = {
  dispatchId: string
  runId: string
  generation: number
}

export async function revalidateWorkerMailbox(args: {
  db: OrchestrationDb
  runtime: OrcaRuntimeService
  handle: string
  paneKey: string | undefined
  signal: AbortSignal | undefined
  activeDispatch: ActiveDispatch | undefined
  remoteAttachment: RemoteAttachment | undefined
  workerMailbox: WorkerMailbox
}): Promise<void> {
  const { db, runtime, handle, paneKey, signal, activeDispatch, remoteAttachment, workerMailbox } =
    args
  const address = `dispatch:${workerMailbox.dispatchId}`
  if (activeDispatch) {
    const current = db.getActiveDispatchForIdentity(handle, paneKey)
    if (current?.id === activeDispatch.id) {
      // Why: a re-attach landing on the awaits above keeps the id but re-points the pane.
      if (callerHoldsDispatchPane(current, paneKey)) {
        return
      }
      throw dispatchFenced()
    }
  } else if (remoteAttachment && paneKey) {
    const current = db.findActiveRemoteAttachmentForPane(paneKey)
    if (
      current?.dispatch_id === remoteAttachment.dispatch_id &&
      db.isRemoteAttachmentProcessCurrent({
        dispatchId: current.dispatch_id,
        paneKey,
        processIncarnation: runtime.getTerminalProcessIncarnation(handle)
      })
    ) {
      return
    }
  }
  const latestDispatch = activeDispatch
    ? db.getDispatchContextById(workerMailbox.dispatchId)
    : undefined
  const owningRunId = latestDispatch?.run_id ?? activeDispatch?.run_id ?? workerMailbox.runId
  if (
    owningRunId &&
    (!latestDispatch ||
      (latestDispatch.status !== 'pending' && latestDispatch.status !== 'dispatched'))
  ) {
    const throughSequence = db.getLatestUnreadMessageSequence(address)
    if (throughSequence !== undefined) {
      const routedTypes = new Set<MessageType>()
      const routePage = (): { routedCount: number; hasMore: boolean } => {
        const routed = db.routeUnreadDispatchMailboxToRunMailbox(
          workerMailbox.dispatchId,
          owningRunId,
          throughSequence
        )
        for (const routedType of routed.types) {
          routedTypes.add(routedType)
        }
        return routed
      }
      const notifyRoutedTypes = (): void => {
        for (const routedType of routedTypes) {
          runtime.notifyMessageArrived(`run:${owningRunId}`, routedType)
        }
        routedTypes.clear()
      }
      try {
        await routeAllMailboxPages(routePage, signal)
      } catch (error) {
        notifyRoutedTypes()
        if (error instanceof OrchestrationError && error.code === 'request_aborted') {
          setImmediate(() => {
            void routeAllMailboxPages(routePage)
              .catch(() => undefined)
              .finally(notifyRoutedTypes)
          })
        }
        throw error
      }
      notifyRoutedTypes()
    }
  }
  throw new OrchestrationError(
    'dispatch_inactive',
    `Dispatch ${workerMailbox.dispatchId} is no longer assigned to this worker.`
  )
}
