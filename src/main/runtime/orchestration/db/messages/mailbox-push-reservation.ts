import type Database from '../../../../sqlite/sync-database'
import { getPersistedSchemaCapabilities } from '../schema/persisted-schema-capabilities'

// Only the unmigrated fork39 profile needs the legacy fence; official40 owns its pointer phases.
export function unreservedMailboxPushSql(
  db: Database.Database,
  phase: 'selection' | 'settlement' = 'settlement'
): string {
  const capabilities = getPersistedSchemaCapabilities(db)
  if (capabilities.profile !== 'fork39') {
    return capabilities.pointerReservations && phase === 'selection'
      ? 'pointer_enter_pending = 0'
      : '1 = 1'
  }
  return `pointer_enter_pending = 0 AND NOT EXISTS (
    SELECT 1 FROM deliveries AS reserved_delivery
    WHERE reserved_delivery.run_id = messages.run_id AND reserved_delivery.status = 'outstanding'
      AND (reserved_delivery.mailbox_handle = messages.to_handle OR reserved_delivery.mailbox_handle = '')
  )`
}
