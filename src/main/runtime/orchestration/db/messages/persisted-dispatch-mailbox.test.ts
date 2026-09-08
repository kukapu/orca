import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from '../orchestration-db'
import { LEGACY_RUN_ID } from '../contract-constants'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../schema/persisted-schema-test-fixture'

describe('persisted Dispatch delivery methods (not application admission39)', () => {
  let directory: string
  let path: string
  let db: OrchestrationDb
  const consumer = { dispatchId: 'd1', source: 'local' as const, consumerGeneration: 7 }
  function fixture(version: 30 | 39 = 39): OrchestrationDb {
    directory = mkdtempSync(join(tmpdir(), 'orca-dispatch-mailbox-'))
    path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, version)
    db = openPersistedSchemaMethodsFixture(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec) VALUES ('t1', 'r1', 'Worker task');
      INSERT INTO dispatch_contexts (id, task_id, run_id, assignee_handle, assignee_pane_key)
        VALUES ('d1', 't1', 'r1', 'worker', 'pane-worker');
    `)
    if (version === 39) {
      db.db.exec('UPDATE dispatch_contexts SET consumer_generation = 7')
    }
    return db
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('durably replays the worker batch across reopen and ACKs idempotently', () => {
    const d = fixture()
    expect(d.getOrCreateDispatchDelivery(consumer)?.delivery.id).toBe('worker-delivery')
    d.close()
    db = openPersistedSchemaMethodsFixture(path)
    expect(db.getOrCreateDispatchDelivery(consumer)).toMatchObject({ replayed: true })
    db.db.exec(
      "UPDATE messages SET pointer_enter_pending = 3, pointer_pty_id = 'pty' WHERE id = 'worker-mail'"
    )
    expect(
      db.acknowledgeDispatchDelivery({ ...consumer, deliveryId: 'worker-delivery' }).duplicate
    ).toBe(false)
    expect(
      db.acknowledgeDispatchDelivery({ ...consumer, deliveryId: 'worker-delivery' }).duplicate
    ).toBe(true)
    expect(db.getMessageById('worker-mail')).toMatchObject({
      read: 1,
      pointer_enter_pending: 0,
      pointer_pty_id: null
    })
    expect(db.getMessageById('run-mail')?.read).toBe(0)
  })

  it('refuses Run and sibling worker ACKs even at the same generation', () => {
    const d = fixture()
    d.db.exec(`
      INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
        VALUES ('sibling', 'r1', 'sender', 'dispatch:d2', 'Another worker');
      INSERT INTO deliveries (id, run_id, mailbox_handle, consumer_generation, message_ids)
        VALUES ('sibling-delivery', 'r1', 'dispatch:d2', 7, '["sibling"]');
    `)
    for (const deliveryId of ['run-delivery', 'sibling-delivery']) {
      expect(() => d.acknowledgeDispatchDelivery({ ...consumer, deliveryId })).toThrow()
    }
    expect(d.getMessageById('sibling')?.read).toBe(0)
    expect(d.getMessageById('run-mail')?.read).toBe(0)
  })

  it('uses the persisted generation, fences old ACK/read, and fences only its mailbox', () => {
    const d = fixture()
    d.db.exec('UPDATE dispatch_contexts SET consumer_generation = 8')
    expect(() => d.getOrCreateDispatchDelivery(consumer)).toThrow()
    expect(() =>
      d.acknowledgeDispatchDelivery({ ...consumer, deliveryId: 'worker-delivery' })
    ).toThrow()
    d.fenceOutstandingDispatchDelivery(consumer)
    expect(d.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
    const next = d.getOrCreateDispatchDelivery({ ...consumer, consumerGeneration: 8 })!
    expect(next.delivery.id).not.toBe('worker-delivery')
    expect(next.delivery).toMatchObject({ mailbox_handle: 'dispatch:d1', consumer_generation: 8 })
  })

  it('uses a bounded FIFO batch; types wake it without dropping older mail', () => {
    const d = fixture()
    d.db.exec("DELETE FROM deliveries WHERE id = 'worker-delivery'")
    expect(
      d.getOrCreateDispatchDelivery({ ...consumer, wakeTypes: ['worker_done'] })
    ).toBeUndefined()
    for (let i = 0; i < 55; i++) {
      d.insertMessage({
        runId: 'r1',
        from: 'sender',
        to: 'dispatch:d1',
        subject: `mail ${i}`,
        type: 'worker_done'
      })
    }
    const batch = d.getOrCreateDispatchDelivery({
      ...consumer,
      wakeTypes: ['worker_done'],
      limit: 900
    })!
    expect(batch.messages).toHaveLength(50)
    expect(batch.messages[0].id).toBe('worker-mail')
    expect(d.getOrCreateDispatchDelivery(consumer)?.delivery.id).toBe(batch.delivery.id)
    expect(d.getMessageById('worker-mail')?.read).toBe(0)
  })

  it('never substitutes a local Dispatch for a remote attachment with the same id', () => {
    const d = fixture()
    const remote = { ...consumer, source: 'remote' as const, consumerGeneration: 11 }
    expect(() => d.getOrCreateDispatchDelivery(remote)).toThrow()
    d.db.exec(`
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, consumer_generation)
        VALUES ('d1', 'remote-task', 'remote-peer', 'epoch', 11);
      INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
        VALUES ('remote-mail', '${LEGACY_RUN_ID}', 'sender', 'dispatch:d1', 'Remote message');
      DELETE FROM deliveries WHERE id = 'worker-delivery';
    `)
    const batch = d.getOrCreateDispatchDelivery(remote)!
    expect(batch.messages.map((row) => row.id)).toEqual(['remote-mail'])
    expect(batch.delivery).toMatchObject({ run_id: LEGACY_RUN_ID, consumer_generation: 11 })
    expect(() =>
      d.acknowledgeDispatchDelivery({ ...consumer, deliveryId: batch.delivery.id })
    ).toThrow()
    d.acknowledgeDispatchDelivery({ ...remote, deliveryId: batch.delivery.id })
    expect(d.getMessageById('worker-mail')?.read).toBe(0)
    d.db.exec('UPDATE remote_dispatch_attachments SET consumer_generation = 12')
    expect(() => d.getOrCreateDispatchDelivery(remote)).toThrow()
  })

  it('does not introduce a fake durable worker protocol or generation0 on schema30', () => {
    const d = fixture(30)
    expect(() => d.getOrCreateDispatchDelivery(consumer)).toThrow()
    expect(d.getUnreadMessages('dispatch:d1')).toHaveLength(1)
    expect(d.db.pragma('user_version', { simple: true })).toBe(30)
  })
})
