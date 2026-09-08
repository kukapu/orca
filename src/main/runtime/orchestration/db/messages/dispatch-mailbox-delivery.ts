import type { MessageRow, MessageType, RemoteDispatchAttachmentRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { LEGACY_RUN_ID } from '../contract-constants'
import type { OrchestrationDb } from '../orchestration-db'
import { exposeMessageListTimestamps } from '../utc-timestamp'
import { getPersistedSchemaCapabilities } from '../schema/persisted-schema-capabilities'
import {
  acknowledgeDelivery,
  getOrCreateDelivery,
  type DeliveryBatchOptions,
  type MailboxConsumer
} from './mailbox-delivery'
import { fenceMailboxDelivery } from './mailbox-delivery-scope'

export type DispatchMailboxSource = { dispatchId: string; source: 'local' | 'remote' }
export type DispatchMailboxConsumer = DispatchMailboxSource & { consumerGeneration: number }

export function getDispatchMailboxConsumer(
  this: OrchestrationDb,
  params: DispatchMailboxSource
): MailboxConsumer {
  return readDispatchMailboxConsumer(this, params, true)
}

function readDispatchMailboxConsumer(
  db: OrchestrationDb,
  params: DispatchMailboxSource,
  requireActive: boolean
): MailboxConsumer {
  if (!getPersistedSchemaCapabilities(db.db).dispatchConsumerGeneration) {
    throw new OrchestrationError(
      'unsupported_persisted_schema',
      'Durable worker mailboxes require the fork39 schema.'
    )
  }
  // A federated worker host owns only its attachment counter; never borrow a local Dispatch.
  const local = params.source === 'local'
  const row = db.db
    .prepare(
      local
        ? 'SELECT run_id, consumer_generation, status AS state FROM dispatch_contexts WHERE id = ?'
        : 'SELECT consumer_generation, state, stage, last_error, capability_hash FROM remote_dispatch_attachments WHERE dispatch_id = ?'
    )
    .get(params.dispatchId) as
    | ({ run_id?: string; consumer_generation: number } & Pick<
        RemoteDispatchAttachmentRow,
        'state' | 'stage' | 'last_error' | 'capability_hash'
      >)
    | undefined
  const activeStates = local
    ? ['pending', 'dispatched']
    : ['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown']
  const retainedRemote =
    !local && row && db.isUnobservedPromptAttachment(row, { requireRetainedCapability: true })
  if (!row || (requireActive && !activeStates.includes(row.state) && !retainedRemote)) {
    throw new OrchestrationError(
      'dispatch_inactive',
      `Dispatch mailbox ${params.dispatchId} is not active on this execution host.`
    )
  }
  if (!Number.isSafeInteger(row.consumer_generation) || row.consumer_generation < 0) {
    throw new OrchestrationError(
      'consumer_fenced',
      'The worker mailbox generation is unverifiable.'
    )
  }
  return {
    runId: local ? row.run_id! : LEGACY_RUN_ID,
    mailboxHandle: `dispatch:${params.dispatchId}`,
    consumerGeneration: row.consumer_generation
  }
}

function requireDispatchGeneration(
  db: OrchestrationDb,
  params: DispatchMailboxConsumer,
  expected: MailboxConsumer
): void {
  const current = db.getDispatchMailboxConsumer(params)
  if (
    current.consumerGeneration !== params.consumerGeneration ||
    current.runId !== expected.runId
  ) {
    throw new OrchestrationError(
      'consumer_fenced',
      'This worker mailbox consumer has been replaced.'
    )
  }
}

export function getOrCreateDispatchDelivery(
  this: OrchestrationDb,
  params: DispatchMailboxConsumer & DeliveryBatchOptions
) {
  const consumer = this.getDispatchMailboxConsumer(params)
  return getOrCreateDelivery(this, consumer, params, () =>
    requireDispatchGeneration(this, params, consumer)
  )
}

export function acknowledgeDispatchDelivery(
  this: OrchestrationDb,
  params: DispatchMailboxConsumer & { deliveryId: string }
) {
  const consumer = this.getDispatchMailboxConsumer(params)
  return acknowledgeDelivery(this, consumer, params.deliveryId, () =>
    requireDispatchGeneration(this, params, consumer)
  )
}

export function fenceOutstandingDispatchDelivery(
  this: OrchestrationDb,
  params: DispatchMailboxSource
): void {
  fenceMailboxDelivery(this, readDispatchMailboxConsumer(this, params, false))
}

export function getDispatchMailboxMessages(
  this: OrchestrationDb,
  params: DispatchMailboxConsumer & { all?: boolean; types?: MessageType[]; limit?: number }
): MessageRow[] {
  const consumer = this.getDispatchMailboxConsumer(params)
  requireDispatchGeneration(this, params, consumer)
  const types = params.types ?? []
  return exposeMessageListTimestamps(
    this.db
      .prepare(
        `SELECT * FROM messages WHERE run_id = ? AND to_handle = ?
     ${params.all ? '' : "AND read = 0 AND delivery_contract = 'current_delivery'"}
     ${types.length ? `AND type IN (${types.map(() => '?').join(',')})` : ''}
     ORDER BY sequence ${params.all ? 'DESC' : 'ASC'} LIMIT ?`
      )
      .all(
        consumer.runId,
        consumer.mailboxHandle,
        ...types,
        Math.min(100, Math.max(1, Math.floor(params.limit ?? 100)))
      ) as MessageRow[]
  )
}

export type DispatchMailboxDeliveryMethods = {
  getDispatchMailboxConsumer: typeof getDispatchMailboxConsumer
  getOrCreateDispatchDelivery: typeof getOrCreateDispatchDelivery
  acknowledgeDispatchDelivery: typeof acknowledgeDispatchDelivery
  fenceOutstandingDispatchDelivery: typeof fenceOutstandingDispatchDelivery
  getDispatchMailboxMessages: typeof getDispatchMailboxMessages
}

export function attachDispatchMailboxDelivery(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    getDispatchMailboxConsumer,
    getOrCreateDispatchDelivery,
    acknowledgeDispatchDelivery,
    fenceOutstandingDispatchDelivery,
    getDispatchMailboxMessages
  })
}
