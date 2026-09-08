import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from './orchestration-db'
import { LEGACY_RUN_ID } from './contract-constants'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from './schema/persisted-schema-test-fixture'

describe('persisted authority identity bridge (not admission39)', () => {
  let directory: string
  let db: OrchestrationDb
  function fixture(version: 30 | 39, remote = false): OrchestrationDb {
    directory = mkdtempSync(join(tmpdir(), 'orca-authority-identity39-'))
    const path = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(path, version)
    db = openPersistedSchemaMethodsFixture(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec) VALUES ('t1', 'r1', 'Task');
      INSERT INTO dispatch_contexts (id, task_id, run_id, status)
        VALUES ('d1', 't1', 'r1', 'pending');
      INSERT INTO worker_dispatches (dispatch_id, runtime_epoch, start_options)
        VALUES ('d1', 'local-epoch', '{}');
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch)
        VALUES ('d1', 'remote-task', 'peer', 'remote-epoch');
    `)
    if (version === 39) {
      db.db.exec(`
        UPDATE dispatch_contexts SET consumer_generation = 7;
        UPDATE remote_dispatch_attachments SET consumer_generation = 11;
        INSERT INTO deliveries (id, run_id, mailbox_handle, consumer_generation, message_ids)
          VALUES ('sibling-delivery', 'r1', 'dispatch:sibling', 7, '[]');
      `)
      if (remote) {
        db.db
          .prepare('UPDATE deliveries SET run_id = ?, consumer_generation = 11 WHERE id = ?')
          .run(LEGACY_RUN_ID, 'worker-delivery')
        db.db
          .prepare('UPDATE messages SET run_id = ? WHERE id = ?')
          .run(LEGACY_RUN_ID, 'worker-mail')
      }
    }
    return db
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  const identity = {
    dispatchId: 'd1',
    handle: 'worker',
    terminalHandle: 'worker',
    paneKey: 'pane-worker',
    processIncarnation: 'process-new',
    worktreeId: 'folder-workspace',
    setupState: 'ready',
    effects: [],
    hostScope: 'ssh:execution-host',
    terminalOwnership: 'created' as const
  }
  const paths = ['starting', 'mint', 'remote'] as const
  const starts = ['starting', 'remote'] as const
  function attach(path: (typeof paths)[number]): string {
    if (path === 'starting') {
      return db.prepareStartingWorkerAuthority(identity)
    }
    if (path === 'remote') {
      return db.prepareRemoteAttachmentAuthority(identity)
    }
    return db.mintDispatchCapability(identity)
  }

  for (const version of [30, 39] as const) {
    it.each(paths)(`schema${version}: %s rotates only with authority`, (path) => {
      fixture(version, path === 'remote')
      const capability = attach(path)
      const remote = path === 'remote'
      if (remote) {
        expect(db.verifyRemoteAttachmentAuthority({ ...identity, capability })).toBe(true)
      } else {
        expect(db.verifyDispatchCapability({ ...identity, capability })).toEqual({ valid: true })
      }
      if (version === 39) {
        expect(db.getDispatchContextById('d1')).toMatchObject({
          consumer_generation: remote ? 7 : 8
        })
        expect(db.getRemoteDispatchAttachment('d1')).toMatchObject({
          consumer_generation: remote ? 12 : 11
        })
        expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('fenced')
        expect(db.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
        expect(db.getDeliveryRaw('sibling-delivery')?.status).toBe('outstanding')
        expect(() =>
          db.acknowledgeDispatchDelivery({
            dispatchId: 'd1',
            source: remote ? 'remote' : 'local',
            consumerGeneration: remote ? 11 : 7,
            deliveryId: 'worker-delivery'
          })
        ).toThrow()
        expect(db.getMessageById('worker-mail')?.read).toBe(0)
        if (path !== 'mint') {
          expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
            endpoint_id: remote ? 'remote-epoch' : 'local-epoch',
            endpoint_incarnation: 'process-new',
            process_incarnation: 'process-new',
            host_scope: 'ssh:execution-host',
            ownership_state: 'owned'
          })
        }
        if (path === 'starting') {
          expect(db.getDispatchContextById('d1')).toMatchObject({
            host_scope: 'ssh:execution-host'
          })
        }
      } else {
        expect(db.getDispatchContextById('d1')).not.toHaveProperty('consumer_generation')
        if (path !== 'mint') {
          expect(db.getWorkerTerminalResourceByOwner('d1')).not.toHaveProperty('endpoint_id')
        }
      }
      if (remote) {
        db.markRemoteAttachmentReady('d1')
      } else {
        db.markWorkerDispatchReady('d1')
        db.recordHeartbeat('d1', '2026-09-08T05:00:00Z')
      }
      if (version === 39) {
        expect(
          db.getDispatchMailboxConsumer({ dispatchId: 'd1', source: remote ? 'remote' : 'local' })
        ).toMatchObject({ consumerGeneration: remote ? 12 : 8 })
      }
      expect(db.db.pragma('user_version', { simple: true })).toBe(version)
    })
  }

  it.each(paths)('%s rolls back capability/generation/delivery on fence failure', (path) => {
    fixture(39, path === 'remote')
    const before = [
      db.getDispatchContextById('d1'),
      db.getRemoteDispatchAttachment('d1'),
      db.getWorkerDispatch('d1')
    ]
    db.db.exec(`CREATE TRIGGER reject_fence BEFORE UPDATE ON deliveries
      WHEN NEW.status = 'fenced' BEGIN SELECT RAISE(ABORT, 'fence refused'); END`)
    expect(() => attach(path)).toThrow('fence refused')
    expect([
      db.getDispatchContextById('d1'),
      db.getRemoteDispatchAttachment('d1'),
      db.getWorkerDispatch('d1')
    ]).toEqual(before)
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
    expect(db.getWorkerTerminalResourceByOwner('d1')).toBeUndefined()
  })

  it.each(starts)('%s rolls back authority and fence on resource insert failure', (path) => {
    fixture(39, path === 'remote')
    const before = [
      db.getDispatchContextById('d1'),
      db.getRemoteDispatchAttachment('d1'),
      db.getWorkerDispatch('d1')
    ]
    db.db.exec(`CREATE TRIGGER reject_resource BEFORE INSERT ON worker_terminal_resources
      BEGIN SELECT RAISE(ABORT, 'resource refused'); END`)
    expect(() => attach(path)).toThrow('resource refused')
    expect([
      db.getDispatchContextById('d1'),
      db.getRemoteDispatchAttachment('d1'),
      db.getWorkerDispatch('d1')
    ]).toEqual(before)
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
  })

  it('remint replaces the prior capability and fences the newly replayed batch again', () => {
    fixture(39)
    const old = attach('mint')
    const batch = db.getOrCreateDispatchDelivery({
      dispatchId: 'd1',
      source: 'local',
      consumerGeneration: 8
    })!
    const capability = db.mintDispatchCapability({
      ...identity,
      processIncarnation: 'process-next'
    })
    expect(db.getDispatchContextById('d1')).toMatchObject({
      consumer_generation: 9,
      process_incarnation: 'process-next'
    })
    expect(db.getDeliveryRaw(batch.delivery.id)?.status).toBe('fenced')
    expect(db.verifyDispatchCapability({ ...identity, capability: old }).valid).toBe(false)
    expect(
      db.verifyDispatchCapability({ ...identity, processIncarnation: 'process-next', capability })
        .valid
    ).toBe(true)
  })

  it('remote authority needs no local Dispatch or worker row on its execution host', () => {
    fixture(39, true)
    db.db.exec("DELETE FROM worker_dispatches; DELETE FROM dispatch_contexts WHERE id = 'd1'")
    const capability = attach('remote')
    expect(db.verifyRemoteAttachmentAuthority({ ...identity, capability })).toBe(true)
    expect(db.getRemoteDispatchAttachment('d1')).toMatchObject({ consumer_generation: 12 })
    expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
      endpoint_id: 'remote-epoch',
      endpoint_incarnation: 'process-new'
    })
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('fenced')
  })

  it.each(paths)('%s refuses inactive authority without changing generation', (path) => {
    fixture(39, path === 'remote')
    db.db.exec(`
      UPDATE dispatch_contexts SET status = 'failed';
      UPDATE remote_dispatch_attachments SET state = 'ready';
    `)
    expect(() => attach(path)).toThrow()
    expect(db.getDispatchContextById('d1')).toMatchObject({ consumer_generation: 7 })
    expect(db.getRemoteDispatchAttachment('d1')).toMatchObject({ consumer_generation: 11 })
    expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
  })

  it.each([undefined, null, 'supplied-epoch'])('COALESCE endpoint: %s', (endpointId) => {
    fixture(39)
    db.db.exec("DELETE FROM worker_terminal_archives WHERE dispatch_id = 'd1'")
    const resource = db.createWorkerTerminalResourceStatement({
      ...identity,
      ownership: 'owned',
      endpointId: 'old-epoch',
      endpointIncarnation: 'old-process'
    })
    expect(resource).toMatchObject({ endpoint_incarnation: 'old-process' })
    const transferred = db.transferWorkerTerminalResourceStatement({
      ...identity,
      resourceId: resource.id,
      toDispatchId: 'd2',
      endpointId,
      processIncarnation: 'current-process'
    })
    expect(transferred).toMatchObject({
      owner_dispatch_id: 'd2',
      prior_owner_dispatch_ids: '["d1"]',
      endpoint_id: endpointId ?? 'old-epoch',
      endpoint_incarnation: 'current-process',
      process_incarnation: 'current-process',
      host_scope: 'ssh:execution-host'
    })
  })

  for (const version of [30, 39] as const) {
    it.each(starts)(`schema${version}: %s transfers an exact resource atomically`, (path) => {
      fixture(version, path === 'remote')
      db.db.exec(`INSERT INTO worker_dispatches (dispatch_id, state, start_options)
        VALUES ('former-owner', 'succeeded', '{}')`)
      const resource = db.createWorkerTerminalResourceStatement({
        ...identity,
        dispatchId: 'former-owner',
        ownership: 'owned',
        endpointId: 'old-epoch',
        endpointIncarnation: 'stale-endpoint-process'
      })
      const transfer = () =>
        path === 'remote'
          ? db.prepareRemoteAttachmentAuthority({ ...identity, terminalOwnership: 'external' })
          : db.prepareStartingWorkerAuthority({ ...identity, terminalOwnership: 'external' })
      const before = [db.getDispatchContextById('d1'), db.getRemoteDispatchAttachment('d1')]
      db.db.exec(`CREATE TRIGGER reject_transfer BEFORE UPDATE ON worker_terminal_resources
        BEGIN SELECT RAISE(ABORT, 'transfer refused'); END`)
      expect(transfer).toThrow('transfer refused')
      expect(db.getWorkerTerminalResource(resource.id)).toEqual(resource)
      expect([db.getDispatchContextById('d1'), db.getRemoteDispatchAttachment('d1')]).toEqual(
        before
      )
      if (version === 39) {
        expect(db.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
      }
      db.db.exec('DROP TRIGGER reject_transfer')
      transfer()
      expect(db.getWorkerTerminalResourceByOwner('d1')).toMatchObject({
        id: resource.id,
        ownership_state: 'owned',
        prior_owner_dispatch_ids: '["former-owner"]'
      })
      if (version === 39) {
        expect(db.getWorkerTerminalResource(resource.id)).toMatchObject({
          endpoint_id: path === 'remote' ? 'remote-epoch' : 'local-epoch',
          endpoint_incarnation: 'process-new',
          process_incarnation: 'process-new'
        })
      }
    })
  }
})
