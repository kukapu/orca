import type Database from '../../../../sqlite/sync-database'
import { getPersistedSchemaCapabilities } from '../schema/persisted-schema-capabilities'

// Old PTY push code cannot settle or retry a persisted reservation, including uncertain Enter.
export function unreservedMailboxPushSql(db: Database.Database): string {
  if (!getPersistedSchemaCapabilities(db).pointerReservations) {
    return '1 = 1'
  }
  return `pointer_enter_pending = 0 AND NOT EXISTS (
    SELECT 1 FROM deliveries AS reserved_delivery
    WHERE reserved_delivery.run_id = messages.run_id AND reserved_delivery.status = 'outstanding'
      AND (reserved_delivery.mailbox_handle = messages.to_handle OR reserved_delivery.mailbox_handle = '')
  )`
}
