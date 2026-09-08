import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from './orchestration-db'
import type { DispatchCreator } from './dispatch-depth'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from './schema/persisted-schema-test-fixture'

describe('persisted Dispatch atomic claim interleavings', () => {
  let directory: string
  let first: OrchestrationDb
  let concurrent: OrchestrationDb
  const system = { kind: 'system' } as const
  const terminal = { kind: 'terminal', handle: 'caller', paneKey: 'caller-pane' } as const
  const oldPane = 'tab_old:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const newPane = 'tab_new:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  function fixture(version: 30 | 39) {
    directory = mkdtempSync(join(tmpdir(), 'orca-claim-interleaving-'))
    const file = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(file, version)
    first = openPersistedSchemaMethodsFixture(file)
    first.db.pragma('journal_mode = WAL')
    concurrent = openPersistedSchemaMethodsFixture(file)
    first.db.exec(`
      INSERT INTO tasks (id, run_id, spec, status) VALUES
        ('parent-task', 'r1', 'Parent', 'ready'),
        ('loser-task', 'r1', 'First claimant', 'ready'),
        ('winner-task', 'r1', 'Second claimant', 'ready');
    `)
    return first.createDispatchContext({
      taskId: 'parent-task',
      assigneeHandle: 'caller',
      assigneePaneKey: 'caller-pane',
      creator: system,
      maxDepth: 5
    })
  }

  function claim(db: OrchestrationDb, creator: DispatchCreator, winner = false) {
    return db.createDispatchContext({
      taskId: winner ? 'winner-task' : 'loser-task',
      assigneeHandle: winner ? 'reminted-worker' : 'worker',
      assigneePaneKey: winner ? newPane : oldPane,
      processIncarnation: 'worker-process',
      creator,
      maxDepth: 5
    })
  }

  // Interleave at execution, not preparation, so moving just prepare() cannot hide a pinned read.
  function beforeClaimInsert(write: () => void) {
    const prepare = first.db.prepare.bind(first.db)
    let injected = false
    let inClaim = false
    let insertStarted = false
    const readsBeforeInsert: string[] = []
    const exec = first.db.exec.bind(first.db)
    vi.spyOn(first.db, 'exec').mockImplementation((sql) => {
      if (sql === 'SAVEPOINT create_dispatch_context') {
        inClaim = true
      }
      return exec(sql)
    })
    const pragma = first.db.pragma.bind(first.db)
    vi.spyOn(first.db, 'pragma').mockImplementation((sql, options) => {
      if (inClaim && !insertStarted) {
        readsBeforeInsert.push(`PRAGMA ${sql}`)
      }
      return pragma(sql, options)
    })
    vi.spyOn(first.db, 'prepare').mockImplementation((sql) => {
      if (inClaim && !insertStarted && !sql.includes('INSERT INTO dispatch_contexts')) {
        readsBeforeInsert.push(sql)
      }
      const statement = prepare(sql)
      if (!injected && sql.includes('INSERT INTO dispatch_contexts')) {
        const run = statement.run.bind(statement)
        vi.spyOn(statement, 'run').mockImplementationOnce((...args) => {
          expect(inClaim).toBe(true)
          injected = true
          write()
          insertStarted = true
          return run(...args)
        })
      }
      return statement
    })
    return () => {
      expect(injected).toBe(true)
      expect(readsBeforeInsert).toEqual([])
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
    concurrent?.close()
    first?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  for (const version of [30, 39] as const) {
    for (const creator of [system, terminal]) {
      it(`schema${version} ${creator.kind}: concurrent failure is a domain refusal`, () => {
        fixture(version)
        const verifyInterleaving = beforeClaimInsert(() => {
          concurrent.updateTaskStatus('loser-task', 'failed', 'failure won')
        })
        expect(() => claim(first, creator)).toThrow(
          'Task loser-task is failed; only ready tasks can be dispatched'
        )
        verifyInterleaving()
        expect(first.getTask('loser-task')).toMatchObject({
          status: 'failed',
          result: 'failure won'
        })
        expect(first.getDispatchContext('loser-task')).toBeUndefined()
      })

      it(`schema${version} ${creator.kind}: the pane winner keeps its metadata and fence`, () => {
        const parent = fixture(version)
        let winnerId: string | undefined
        const verifyInterleaving = beforeClaimInsert(() => {
          winnerId = claim(concurrent, creator, true).id
          concurrent.mintDispatchCapability({
            dispatchId: winnerId,
            paneKey: newPane,
            processIncarnation: 'worker-process'
          })
        })
        expect(() => claim(first, creator)).toThrow('already has an active dispatch')
        verifyInterleaving()
        expect(first.getTask('loser-task')?.status).toBe('ready')
        expect(first.getDispatchContext('loser-task')).toBeUndefined()
        expect(first.getTask('winner-task')?.status).toBe('dispatched')
        if (version === 39) {
          expect(first.getDispatchContextById(winnerId!)).toMatchObject({
            creator_dispatch_id: creator.kind === 'terminal' ? parent.id : null,
            creator_handle: creator.kind === 'terminal' ? 'caller' : null,
            creator_pane_key: creator.kind === 'terminal' ? 'caller-pane' : null,
            consumer_generation: 1
          })
          expect(first.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
        }
      })

      it(`schema${version} ${creator.kind}: unrelated writes do not discard claim identity`, () => {
        const parent = fixture(version)
        const verifyInterleaving = beforeClaimInsert(() => {
          concurrent.db.exec("UPDATE unknown_fork_facts SET payload = 'concurrent'")
        })
        const row = claim(first, creator)
        verifyInterleaving()
        expect(row.depth).toBe(creator.kind === 'terminal' ? 2 : 1)
        if (version === 39) {
          expect(row).toMatchObject({
            creator_dispatch_id: creator.kind === 'terminal' ? parent.id : null,
            creator_handle: creator.kind === 'terminal' ? 'caller' : null,
            creator_pane_key: creator.kind === 'terminal' ? 'caller-pane' : null,
            retry_of_dispatch_id: null,
            consumer_generation: 0
          })
          first.db
            .prepare(`INSERT INTO deliveries
            (id, run_id, mailbox_handle, consumer_generation, message_ids)
            VALUES ('claim-delivery', 'r1', ?, 0, '[]')`)
            .run(`dispatch:${row.id}`)
        }
        first.mintDispatchCapability({
          dispatchId: row.id,
          paneKey: oldPane,
          processIncarnation: 'worker-process'
        })
        if (version === 39) {
          expect(first.getDispatchContextById(row.id)).toMatchObject({ consumer_generation: 1 })
          expect(first.getDeliveryRaw('claim-delivery')?.status).toBe('fenced')
          expect(first.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
        }
        expect(first.db.pragma('user_version', { simple: true })).toBe(version)
      })
    }
  }
})
