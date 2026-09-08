import type { DeliveryRow, MessageRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import type { OrchestrationDb } from '../orchestration-db'
import { getPersistedSchemaCapabilities } from '../schema/persisted-schema-capabilities'

export type DeliveryMailbox = { runId: string; mailboxHandle: string }

export function deliveryMessageIds(delivery: DeliveryRow): string[] {
  let ids: unknown
  try {
    ids = JSON.parse(delivery.message_ids)
  } catch {
    throw invalidDelivery(delivery.id)
  }
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw invalidDelivery(delivery.id)
  }
  return ids
}

function invalidDelivery(id: string): OrchestrationError {
  return new OrchestrationError('stale_delivery', `Delivery ${id} has ambiguous mailbox evidence.`)
}

export function deliveryMailboxHandle(db: OrchestrationDb, delivery: DeliveryRow): string {
  if (!getPersistedSchemaCapabilities(db.db).mailboxScopedDeliveries) {
    return `run:${delivery.run_id}`
  }
  if (delivery.mailbox_handle) {
    return delivery.mailbox_handle
  }
  const ids = deliveryMessageIds(delivery)
  if (!ids.length) {
    throw invalidDelivery(delivery.id)
  }
  const rows = db.db
    .prepare(
      `SELECT run_id, to_handle, delivery_contract FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`
    )
    .all(...ids) as Pick<MessageRow, 'run_id' | 'to_handle' | 'delivery_contract'>[]
  const address = rows[0]?.to_handle
  if (
    rows.length !== ids.length ||
    !address ||
    (address !== `run:${delivery.run_id}` && !/^dispatch:.+/.test(address)) ||
    rows.some(
      (row) =>
        row.run_id !== delivery.run_id ||
        row.to_handle !== address ||
        row.delivery_contract !== 'current_delivery'
    )
  ) {
    throw invalidDelivery(delivery.id)
  }
  return address
}

export function outstandingMailboxDelivery(
  db: OrchestrationDb,
  mailbox: DeliveryMailbox
): DeliveryRow | undefined {
  const scoped = getPersistedSchemaCapabilities(db.db).mailboxScopedDeliveries
  const candidates = db.db
    .prepare(
      `SELECT * FROM deliveries WHERE run_id = ? AND status = 'outstanding'
     ${scoped ? "AND (mailbox_handle = ? OR mailbox_handle = '')" : ''}`
    )
    .all(mailbox.runId, ...(scoped ? [mailbox.mailboxHandle] : [])) as DeliveryRow[]
  const matching = candidates.filter(
    (row) => deliveryMailboxHandle(db, row) === mailbox.mailboxHandle
  )
  if (matching.length > 1) {
    throw invalidDelivery(matching[0].id)
  }
  return matching[0]
}

export function fenceMailboxDelivery(db: OrchestrationDb, mailbox: DeliveryMailbox): void {
  getPersistedSchemaCapabilities(db.db)
  db.db.exec('SAVEPOINT fence_mailbox_delivery')
  try {
    const delivery = outstandingMailboxDelivery(db, mailbox)
    if (delivery) {
      db.db.prepare("UPDATE deliveries SET status = 'fenced' WHERE id = ?").run(delivery.id)
    }
    db.db.exec('RELEASE fence_mailbox_delivery')
  } catch (error) {
    db.db.exec('ROLLBACK TO fence_mailbox_delivery')
    db.db.exec('RELEASE fence_mailbox_delivery')
    throw error
  }
}
