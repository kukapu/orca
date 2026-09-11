import type { MessageType, OrchestrationDb } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { formatMessageBanner } from '../../../../orchestration/formatter'
import { exposeMessages } from './mailbox-message-receipt'
import { routeAllMailboxPages } from '../schemas'
import { asDispatchFence, dispatchFenced } from './dispatch-mailbox-fence'
import type { CheckParams } from '../schemas'
import type { z } from 'zod'
import { getPersistedSchemaCapabilities } from '../../../../orchestration/db/schema/persisted-schema-capabilities'
import { resolveFederatedHomeRunId } from '../../../../orchestration/db/contract-constants'
import {
  revalidateWorkerMailbox,
  type ActiveDispatch,
  type RemoteAttachment
} from './check-worker-revalidate'
import { checkWorkerMailboxSchema30 } from './check-worker-schema30'

type CheckParamsInput = z.infer<typeof CheckParams>

export async function checkWorkerMailbox(args: {
  params: CheckParamsInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  handle: string
  paneKey: string | undefined
  typeFilter: MessageType[] | undefined
  signal: AbortSignal | undefined
  activeDispatch: ActiveDispatch | undefined
  remoteAttachment: RemoteAttachment | undefined
}): Promise<unknown> {
  const {
    params,
    runtime,
    db,
    handle,
    paneKey,
    typeFilter,
    signal,
    activeDispatch,
    remoteAttachment
  } = args
  const workerMailbox = activeDispatch
    ? {
        dispatchId: activeDispatch.id,
        runId: activeDispatch.run_id,
        generation: activeDispatch.consumer_generation
      }
    : remoteAttachment
      ? {
          dispatchId: remoteAttachment.dispatch_id,
          runId: resolveFederatedHomeRunId(remoteAttachment, db),
          generation: remoteAttachment.consumer_generation
        }
      : undefined
  if (!workerMailbox) {
    return undefined
  }
  const deliveryRunId = workerMailbox.runId
  db.requireRun(deliveryRunId)
  const address = `dispatch:${workerMailbox.dispatchId}`
  const durable = getPersistedSchemaCapabilities(db.db).mailboxScopedDeliveries
  const revalidate = () =>
    revalidateWorkerMailbox({
      db,
      runtime,
      handle,
      paneKey,
      signal,
      activeDispatch,
      remoteAttachment,
      workerMailbox
    })
  // Why: a federated worker host has no dispatch_contexts row, so its generation lives on the
  // remote_dispatch_attachments row instead.
  const readCurrentGeneration = (): number | undefined =>
    activeDispatch
      ? db.getDispatchContextById(workerMailbox.dispatchId)?.consumer_generation
      : db.getRemoteDispatchAttachment(workerMailbox.dispatchId)?.consumer_generation
  const routeDirectSnapshot = async (
    runId: string,
    directHandle: string,
    routePage: (throughSequence: number) => { routedCount: number; hasMore: boolean }
  ): Promise<void> => {
    const throughSequence = db.getLatestUnreadDirectMessageSequenceForRun(runId, directHandle)
    if (throughSequence !== undefined) {
      await routeAllMailboxPages(() => routePage(throughSequence), signal)
    }
  }

  if (durable) {
    await revalidate()
  }
  if (activeDispatch) {
    await routeDirectSnapshot(activeDispatch.run_id, handle, (throughSequence) =>
      db.routeUnreadDirectMessagesToDispatchMailbox(
        activeDispatch.id,
        activeDispatch.run_id,
        handle,
        throughSequence
      )
    )
    const assigneeHandle = activeDispatch.assignee_handle
    if (assigneeHandle && assigneeHandle !== handle) {
      await routeDirectSnapshot(activeDispatch.run_id, assigneeHandle, (throughSequence) =>
        db.routeUnreadDirectMessagesToDispatchMailbox(
          activeDispatch.id,
          activeDispatch.run_id,
          assigneeHandle,
          throughSequence
        )
      )
    }
  }
  await revalidate()
  if (!durable) {
    return checkWorkerMailboxSchema30({
      params,
      runtime,
      db,
      typeFilter,
      signal,
      workerMailbox,
      address,
      revalidateWorkerMailbox: revalidate
    })
  }
  let acknowledged
  try {
    acknowledged = params.ack
      ? db.acknowledgeMailboxDelivery({
          runId: deliveryRunId,
          mailboxHandle: address,
          consumerGeneration: workerMailbox.generation,
          deliveryId: params.ack
        })
      : undefined
  } catch (error) {
    throw asDispatchFence(error)
  }
  const showAll = params.all === true || (params.unread === false && params.peek !== true)
  const readPeek = () => db.getUnreadMessages(address, typeFilter)
  const readDelivery = (wakeTypes?: MessageType[]) => {
    // Why: re-read live, or a re-attach landing on an await above mints a Delivery at a generation
    // the row has already left, which then fences the legitimate worker on every later check.
    if (readCurrentGeneration() !== workerMailbox.generation) {
      throw dispatchFenced()
    }
    try {
      return db.getOrCreateMailboxDelivery({
        runId: deliveryRunId,
        mailboxHandle: address,
        consumerGeneration: workerMailbox.generation,
        wakeTypes
      })
    } catch (error) {
      throw asDispatchFence(error)
    }
  }
  if (showAll) {
    const messages = db.getAllMessagesForHandle(address, 100, typeFilter)
    return {
      ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
      dispatchId: workerMailbox.dispatchId,
      messages: exposeMessages(messages),
      count: messages.length,
      acknowledged: acknowledged?.delivery.id ?? null,
      ...(params.format || params.inject
        ? { formatted: messages.map(formatMessageBanner).join('\n\n') }
        : {})
    }
  }
  if (params.peek) {
    const messages = readPeek()
    if (messages.length > 0 || !params.wait) {
      return {
        ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
        dispatchId: workerMailbox.dispatchId,
        messages: exposeMessages(messages),
        count: messages.length,
        acknowledged: acknowledged?.delivery.id ?? null,
        ...(params.format || params.inject
          ? { formatted: messages.map(formatMessageBanner).join('\n\n') }
          : {})
      }
    }
  } else {
    const current = readDelivery(params.wait ? typeFilter : undefined)
    if (current || !params.wait) {
      return {
        ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
        dispatchId: workerMailbox.dispatchId,
        deliveryId: current?.delivery.id ?? null,
        messages: exposeMessages(current?.messages ?? []),
        count: current?.messages.length ?? 0,
        replayed: current?.replayed ?? false,
        acknowledged: acknowledged?.delivery.id ?? null,
        timedOut: false,
        cancelled: false,
        connectionLost: false,
        ...(params.format || params.inject
          ? { formatted: current?.messages.map(formatMessageBanner).join('\n\n') ?? '' }
          : {})
      }
    }
  }
  const waitResult = await runtime.waitForMessage(address, {
    typeFilter: typeFilter as string[] | undefined,
    timeoutMs: params.timeoutMs ?? undefined,
    signal
  })
  await revalidate()
  if (readCurrentGeneration() !== workerMailbox.generation) {
    throw dispatchFenced()
  }
  if (waitResult === 'timed_out' || waitResult === 'cancelled') {
    return {
      ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
      dispatchId: workerMailbox.dispatchId,
      messages: [],
      count: 0,
      acknowledged: acknowledged?.delivery.id ?? null,
      timedOut: waitResult === 'timed_out',
      cancelled: waitResult === 'cancelled',
      connectionLost: waitResult === 'cancelled' && signal?.aborted === true
    }
  }
  if (params.peek) {
    const arrived = readPeek()
    return {
      ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
      dispatchId: workerMailbox.dispatchId,
      messages: exposeMessages(arrived),
      count: arrived.length,
      acknowledged: acknowledged?.delivery.id ?? null,
      ...(params.format || params.inject
        ? { formatted: arrived.map(formatMessageBanner).join('\n\n') }
        : {})
    }
  }
  const arrived = readDelivery(typeFilter)
  return {
    ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
    dispatchId: workerMailbox.dispatchId,
    deliveryId: arrived?.delivery.id ?? null,
    messages: exposeMessages(arrived?.messages ?? []),
    count: arrived?.messages.length ?? 0,
    replayed: arrived?.replayed ?? false,
    acknowledged: acknowledged?.delivery.id ?? null,
    ...(params.format || params.inject
      ? { formatted: arrived?.messages.map(formatMessageBanner).join('\n\n') ?? '' }
      : {})
  }
}
