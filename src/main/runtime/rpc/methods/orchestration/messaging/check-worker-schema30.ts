import type { MessageType, OrchestrationDb } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { formatMessageBanner } from '../../../../orchestration/formatter'
import { exposeMessages } from './mailbox-message-receipt'
import type { CheckParams } from '../schemas'
import type { z } from 'zod'
import type { WorkerMailbox } from './check-worker-revalidate'

type CheckParamsInput = z.infer<typeof CheckParams>

export async function checkWorkerMailboxSchema30(args: {
  params: CheckParamsInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  typeFilter: MessageType[] | undefined
  signal: AbortSignal | undefined
  workerMailbox: WorkerMailbox
  address: string
  revalidateWorkerMailbox: () => Promise<void>
}): Promise<unknown> {
  const {
    params,
    runtime,
    db,
    typeFilter,
    signal,
    workerMailbox,
    address,
    revalidateWorkerMailbox
  } = args
  const showAll = params.all === true || (params.unread === false && params.peek !== true)
  const readMailbox = () => {
    const messages = showAll
      ? db.getAllMessagesForHandle(address, 100, typeFilter)
      : db.getUnreadMessages(address, typeFilter)
    if (!showAll && !params.peek && messages.length > 0) {
      db.markAsRead(messages.map((message) => message.id))
    }
    return {
      ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
      dispatchId: workerMailbox.dispatchId,
      messages: exposeMessages(messages),
      count: messages.length,
      ...(params.format || params.inject
        ? { formatted: messages.map(formatMessageBanner).join('\n\n') }
        : {})
    }
  }
  const first = readMailbox()
  if (first.count > 0 || !params.wait || showAll) {
    return first
  }
  const waitResult = await runtime.waitForMessage(address, {
    typeFilter: typeFilter as string[] | undefined,
    timeoutMs: params.timeoutMs ?? undefined,
    signal
  })
  await revalidateWorkerMailbox()
  if (waitResult === 'timed_out' || waitResult === 'cancelled') {
    return {
      ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
      dispatchId: workerMailbox.dispatchId,
      messages: [],
      count: 0,
      timedOut: waitResult === 'timed_out',
      cancelled: waitResult === 'cancelled',
      connectionLost: waitResult === 'cancelled' && signal?.aborted === true
    }
  }
  return readMailbox()
}
