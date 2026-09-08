import Database from '../../../sqlite/sync-database'
import { attachOrchestrationDbMethods } from './attach-orchestration-db-methods'
import { hardenOrchestrationDatabaseFiles } from './database-file-permissions'
import type { OrchestrationDbMethods } from './orchestration-db-methods'
import {
  createCoordinatorMailRoutingTrigger,
  rememberCurrentRunCoordinatorHandles
} from './runs/run-coordinator-mail-routing'
import { createTables } from './schema/create-tables'
import { migrate } from './schema/migrate'
import {
  assertPersistedSchemaCompatibility,
  assertPersistedSchemaFileCompatibility
} from './schema/persisted-schema-compatibility'

class OrchestrationDbCore {
  db: Database.Database

  // Why: the orchestration DB is created lazily for ALL users, but only the
  // small minority who dispatch work ever have dispatch_contexts rows. The
  // renderer graph publish rebuilds orchestration context on every 16ms tick
  // (buildAgentOrchestrationByPaneKey), issuing 2 queries per terminal. Cache
  // emptiness so the non-orchestration majority short-circuits the whole
  // per-terminal fan-out. Only createDispatchContext flips this false→true.
  hasAnyDispatchContextsCache: boolean | undefined
  localMutationCallerFingerprint: string | undefined

  constructor(dbPath: (string & {}) | ':memory:') {
    assertPersistedSchemaFileCompatibility(dbPath)
    this.db = new Database(dbPath)
    try {
      const profile = assertPersistedSchemaCompatibility(this.db)
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('busy_timeout = 5000')
      if (profile === 'stable30') {
        this.db.pragma('journal_mode = WAL')
        createTables.call(this as unknown as OrchestrationDb)
        migrate.call(this as unknown as OrchestrationDb)
        createCoordinatorMailRoutingTrigger.call(this as unknown as OrchestrationDb)
      }
      rememberCurrentRunCoordinatorHandles.call(this as unknown as OrchestrationDb)
      hardenOrchestrationDatabaseFiles(dbPath)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}

export type OrchestrationDb = OrchestrationDbCore & OrchestrationDbMethods

attachOrchestrationDbMethods(OrchestrationDbCore)

// Why: attach adds methods on the prototype; oxlint forbids class/interface merging, so the construct type is asserted.
export const OrchestrationDb = OrchestrationDbCore as new (
  dbPath: (string & {}) | ':memory:'
) => OrchestrationDb
