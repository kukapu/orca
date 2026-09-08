import type { DeliveryRow, MessageRow, MessageType } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { generateId } from '../generated-id'
import { exposeDeliveryTimestamps, exposeMessageListTimestamps } from '../utc-timestamp'
import { getPersistedSchemaCapabilities } from '../schema/persisted-schema-capabilities'
import { ORCHESTRATION_DELIVERY_BATCH_LIMIT } from './mailbox-routing-page'
import {
  deliveryMailboxHandle,
  deliveryMessageIds,
  outstandingMailboxDelivery,
  type DeliveryMailbox
} from './mailbox-delivery-scope'

export type MailboxConsumer = DeliveryMailbox & { consumerGeneration: number }
export type DeliveryBatchOptions = { limit?: number; wakeTypes?: MessageType[] }
export type MailboxDeliveryBatch = {
  delivery: DeliveryRow
  messages: MessageRow[]
  replayed: boolean
}

export function readDeliveryMessages(db: OrchestrationDb, delivery: DeliveryRow): MessageRow[] {
  const address = deliveryMailboxHandle(db, delivery)
  const ids = deliveryMessageIds(delivery)
  if (!ids.length) {
    return []
  }
  const rows = db.db
    .prepare(
      `SELECT * FROM messages WHERE run_id = ? AND to_handle = ?
     AND delivery_contract = 'current_delivery' AND id IN (${ids.map(() => '?').join(',')})`
    )
    .all(delivery.run_id, address, ...ids) as MessageRow[]
  const byId = new Map(rows.map((row) => [row.id, row]))
  return exposeMessageListTimestamps(
    ids.map((id) => byId.get(id)).filter((row): row is MessageRow => row !== undefined)
  )
}

// The Run engine also serves Dispatches; every caller must validate its consumer inside the txn.
export function getOrCreateDelivery(
  db: OrchestrationDb,
  consumer: MailboxConsumer,
  options: DeliveryBatchOptions,
  requireCurrent: () => void
): MailboxDeliveryBatch | undefined {
  const scoped = getPersistedSchemaCapabilities(db.db).mailboxScopedDeliveries
  const limit = Math.min(
    Math.max(Math.floor(options.limit ?? ORCHESTRATION_DELIVERY_BATCH_LIMIT), 1),
    ORCHESTRATION_DELIVERY_BATCH_LIMIT
  )
  db.db.exec('BEGIN IMMEDIATE')
  try {
    requireCurrent()
    const existing = outstandingMailboxDelivery(db, consumer)
    if (existing) {
      requireDeliveryGeneration(existing, consumer.consumerGeneration)
      const messages = readDeliveryMessages(db, existing)
      db.db.exec('COMMIT')
      return { delivery: exposeDeliveryTimestamps(existing), messages, replayed: true }
    }
    if (options.wakeTypes?.length) {
      const matching = db.db
        .prepare(
          `SELECT 1 FROM messages WHERE run_id = ? AND to_handle = ? AND read = 0
         AND delivery_contract = 'current_delivery'
         AND type IN (${options.wakeTypes.map(() => '?').join(',')}) LIMIT 1`
        )
        .get(consumer.runId, consumer.mailboxHandle, ...options.wakeTypes)
      if (!matching) {
        db.db.exec('COMMIT')
        return undefined
      }
    }
    const messages = exposeMessageListTimestamps(
      db.db
        .prepare(
          `SELECT * FROM messages WHERE run_id = ? AND to_handle = ? AND read = 0
       AND delivery_contract = 'current_delivery' ORDER BY sequence ASC LIMIT ?`
        )
        .all(consumer.runId, consumer.mailboxHandle, limit) as MessageRow[]
    )
    if (!messages.length) {
      db.db.exec('COMMIT')
      return undefined
    }
    const id = generateId('delivery')
    db.db
      .prepare(
        `INSERT INTO deliveries (id, run_id, consumer_generation, message_ids${scoped ? ', mailbox_handle' : ''})
       VALUES (?, ?, ?, ?${scoped ? ', ?' : ''})`
      )
      .run(
        id,
        consumer.runId,
        consumer.consumerGeneration,
        JSON.stringify(messages.map((message) => message.id)),
        ...(scoped ? [consumer.mailboxHandle] : [])
      )
    const delivery = db.getDeliveryRaw(id) as DeliveryRow
    db.db.exec('COMMIT')
    return { delivery: exposeDeliveryTimestamps(delivery), messages, replayed: false }
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
}

export function acknowledgeDelivery(
  db: OrchestrationDb,
  consumer: MailboxConsumer,
  deliveryId: string,
  requireCurrent: () => void
): { delivery: DeliveryRow; duplicate: boolean } {
  const capabilities = getPersistedSchemaCapabilities(db.db)
  db.db.exec('BEGIN IMMEDIATE')
  try {
    requireCurrent()
    const delivery = db.getDeliveryRaw(deliveryId)
    if (
      !delivery ||
      delivery.run_id !== consumer.runId ||
      deliveryMailboxHandle(db, delivery) !== consumer.mailboxHandle
    ) {
      throw new OrchestrationError(
        'stale_delivery',
        `Delivery ${deliveryId} does not belong to this mailbox.`
      )
    }
    requireDeliveryGeneration(delivery, consumer.consumerGeneration)
    if (delivery.status === 'acknowledged') {
      db.db.exec('COMMIT')
      return { delivery: exposeDeliveryTimestamps(delivery), duplicate: true }
    }
    // An explicit id does not make multiple plausible blank-handle batches unambiguous.
    if (outstandingMailboxDelivery(db, consumer)?.id !== delivery.id) {
      throw new OrchestrationError('stale_delivery', `Delivery ${deliveryId} is not outstanding.`)
    }
    const ids = deliveryMessageIds(delivery)
    const clearPointer = capabilities.pointerReservations
      ? ', pointer_enter_pending = 0, pointer_pty_id = NULL, pointer_process_incarnation = NULL'
      : ''
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500)
      db.db
        .prepare(
          `UPDATE messages SET read = 1${clearPointer}
         WHERE run_id = ? AND to_handle = ? AND delivery_contract = 'current_delivery'
           AND id IN (${batch.map(() => '?').join(',')})`
        )
        .run(consumer.runId, consumer.mailboxHandle, ...batch)
    }
    db.db
      .prepare(
        "UPDATE deliveries SET status = 'acknowledged', acknowledged_at = datetime('now') WHERE id = ?"
      )
      .run(delivery.id)
    const acknowledged = db.getDeliveryRaw(delivery.id) as DeliveryRow
    db.db.exec('COMMIT')
    return { delivery: exposeDeliveryTimestamps(acknowledged), duplicate: false }
  } catch (error) {
    db.db.exec('ROLLBACK')
    throw error
  }
}

function requireDeliveryGeneration(delivery: DeliveryRow, generation: number): void {
  if (delivery.consumer_generation !== generation || delivery.status === 'fenced') {
    throw new OrchestrationError(
      'consumer_fenced',
      'This mailbox Delivery belongs to a fenced consumer generation.'
    )
  }
}
