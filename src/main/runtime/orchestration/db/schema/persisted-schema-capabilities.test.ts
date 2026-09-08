import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../orchestration-db'
import { getPersistedSchemaCapabilities } from './persisted-schema-capabilities'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from './persisted-schema-test-fixture'

describe('connection-scoped persisted mailbox capabilities', () => {
  const directories: string[] = []
  const connections: OrchestrationDb[] = []
  function fixture(version: 30 | 39): OrchestrationDb {
    const directory = mkdtempSync(join(tmpdir(), 'orca-schema-capabilities-'))
    directories.push(directory)
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, version)
    const db = openPersistedSchemaMethodsFixture(path)
    connections.push(db)
    return db
  }
  afterEach(() => {
    vi.restoreAllMocks()
    for (const db of connections.splice(0)) {
      db.close()
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('caches immutable capabilities per connection, never across hosts/databases', () => {
    const stable = fixture(30)
    const fork = fixture(39)
    const a = getPersistedSchemaCapabilities(stable.db)
    const b = getPersistedSchemaCapabilities(fork.db)
    expect(a.profile).toBe('stable30')
    expect(a.mailboxScopedDeliveries).toBe(false)
    expect(b.profile).toBe('fork39')
    expect(b.mailboxScopedDeliveries).toBe(true)
    expect(Object.isFrozen(b)).toBe(true)
    expect(getPersistedSchemaCapabilities(stable.db)).toBe(a)
    expect(getPersistedSchemaCapabilities(fork.db)).toBe(b)
    const reads = vi.spyOn(fork.db, 'pragma')
    getPersistedSchemaCapabilities(fork.db)
    expect(reads.mock.calls.map(([sql]) => sql)).toEqual(['user_version', 'schema_version'])
  })

  it.each([
    'PRAGMA user_version = 40',
    'PRAGMA user_version = 30',
    'ALTER TABLE messages DROP COLUMN pointer_pty_id',
    'ALTER TABLE remote_dispatch_attachments DROP COLUMN consumer_generation',
    'DROP INDEX idx_deliveries_one_outstanding'
  ])('invalidates the cached profile and refuses writes after %s', (sql) => {
    const fork = fixture(39)
    getPersistedSchemaCapabilities(fork.db)
    fork.db.exec(sql)
    const writes = vi.spyOn(fork.db, 'exec')
    expect(() => fork.getOrCreateRunDelivery({ runId: 'r1', consumerGeneration: 7 })).toThrow()
    expect(writes).not.toHaveBeenCalled()
  })
})
