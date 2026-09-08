import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from '../orchestration-db'
import { shouldReleaseOrchestrationPointer } from '../../mailbox-pointer-eligibility'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../schema/persisted-schema-test-fixture'

describe('Run mailbox methods on persisted39 (constructor admission remains blocked)', () => {
  let db: OrchestrationDb
  let directory: string
  function fixture(): OrchestrationDb {
    directory = mkdtempSync(join(tmpdir(), 'orca-run-mailbox39-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = openPersistedSchemaMethodsFixture(path)
    return db
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  const consumer = { runId: 'r1', consumerGeneration: 7 }

  it('replays only the Run delivery, not an earlier worker delivery at the same generation', () => {
    const d = fixture()
    const replay = d.getOrCreateRunDelivery(consumer)!
    expect(replay.delivery.id).toBe('run-delivery')
    expect(replay.messages.map((message) => message.id)).toEqual(['run-mail'])
    expect(replay.replayed).toBe(true)
  })

  it('refuses a worker ACK through the Run API', () => {
    const d = fixture()
    expect(() => d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'worker-delivery' })).toThrow()
    expect(d.getMessageById('worker-mail')?.read).toBe(0)
  })

  it('fences only Run deliveries', () => {
    const d = fixture()
    d.fenceOutstandingDelivery('r1')
    expect(d.getDeliveryRaw('run-delivery')?.status).toBe('fenced')
    expect(d.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
    expect(d.hasOutstandingRunDelivery('r1')).toBe(false)
  })

  it('inserts an explicit run:<id> mailbox without changing schema39 or unrelated facts', () => {
    const d = fixture()
    d.db.exec("DELETE FROM deliveries WHERE id = 'run-delivery'")
    const delivery = d.getOrCreateRunDelivery(consumer)!.delivery
    expect(delivery).toMatchObject({ mailbox_handle: 'run:r1', run_id: 'r1' })
    expect(d.db.pragma('user_version', { simple: true })).toBe(39)
    expect(d.db.prepare('SELECT extra FROM unknown_fork_facts').get()).toEqual({ extra: 'keep' })
  })

  it('validates a blank legacy Run delivery without filling in its default field', () => {
    const d = fixture()
    d.db.exec("UPDATE deliveries SET mailbox_handle = '' WHERE id = 'run-delivery'")
    expect(d.getOrCreateRunDelivery(consumer)?.delivery.id).toBe('run-delivery')
    expect(d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' }).duplicate).toBe(
      false
    )
    expect(d.getDeliveryRaw('run-delivery')).toMatchObject({ mailbox_handle: '' })
    expect(d.getMessageById('worker-mail')?.read).toBe(0)
  })

  it.each(['[]', '["missing"]', '["run-mail","worker-mail"]', 'null', 'not-json'])(
    'refuses ambiguous blank-handle evidence %s without selecting LIMIT1',
    (ids) => {
      const d = fixture()
      d.db
        .prepare("UPDATE deliveries SET mailbox_handle = '', message_ids = ? WHERE id = ?")
        .run(ids, 'run-delivery')
      expect(() => d.getOrCreateRunDelivery(consumer)).toThrow()
      expect(() => d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' })).toThrow()
      expect(d.getMessageById('run-mail')?.read).toBe(0)
    }
  )

  it('refuses two plausible blank deliveries, including an ACK by explicit id', () => {
    const d = fixture()
    d.db.exec(`
      UPDATE deliveries SET mailbox_handle = '' WHERE id = 'run-delivery';
      INSERT INTO deliveries (id, run_id, consumer_generation, message_ids)
        VALUES ('duplicate', 'r1', 7, '["run-mail"]');
    `)
    expect(() => d.getOrCreateRunDelivery(consumer)).toThrow()
    expect(() => d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' })).toThrow()
  })

  it('never reads or ACKs foreign ids included in an explicitly addressed delivery', () => {
    const d = fixture()
    d.db.exec(`
      INSERT INTO runs (id, objective) VALUES ('r2', 'Another Run');
      INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
        VALUES ('foreign-run', 'r2', 'sender', 'run:r1', 'Wrong Run');
      UPDATE deliveries SET message_ids = '["run-mail","worker-mail","foreign-run"]'
        WHERE id = 'run-delivery';
      UPDATE messages SET pointer_enter_pending = 3, pointer_pty_id = 'pty',
        pointer_process_incarnation = 'incarnation';
    `)
    expect(d.getDeliveryMessages(d.getDeliveryRaw('run-delivery')!).map((row) => row.id)).toEqual([
      'run-mail'
    ])
    d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' })
    expect(d.getMessageById('run-mail')).toMatchObject({ read: 1, pointer_enter_pending: 0 })
    for (const id of ['worker-mail', 'foreign-run']) {
      expect(d.getMessageById(id)).toMatchObject({
        read: 0,
        pointer_enter_pending: 3,
        pointer_pty_id: 'pty',
        pointer_process_incarnation: 'incarnation'
      })
    }
  })

  it.each([1, 2, 3])('excludes persisted Enter phase %s from all old push paths', (phase) => {
    const d = fixture()
    d.db.exec('DELETE FROM deliveries')
    d.db.prepare('UPDATE messages SET pointer_enter_pending = ?').run(phase)
    expect(d.getUndeliveredUnreadMessages('dispatch:d1')).toEqual([])
    expect(d.getUndeliveredUnreadMailboxHandles()).toEqual([])
    expect(d.areUnreadMessages('dispatch:d1', ['worker-mail'])).toBe(false)
    expect(
      shouldReleaseOrchestrationPointer(
        d,
        'dispatch:d1',
        [{ id: 'worker-mail', type: 'status' }],
        undefined
      )
    ).toBe(true)
    d.db.exec("UPDATE messages SET delivered_at = '2026-09-08 05:00:00'")
    d.markAsUndelivered(['worker-mail'])
    d.markAsDelivered(['worker-mail'])
    expect(d.getMessageById('worker-mail')).toMatchObject({
      pointer_enter_pending: phase,
      delivered_at: '2026-09-08T05:00:00Z'
    })
  })

  it('suppresses old worker pushes while a durable batch is outstanding', () => {
    const d = fixture()
    expect(d.getUndeliveredUnreadMessages('dispatch:d1')).toEqual([])
    expect(d.areUnreadMessages('dispatch:d1', ['worker-mail'])).toBe(false)
  })

  it('rolls back ACK and pointer clearing if the delivery receipt cannot commit', () => {
    const d = fixture()
    d.db.exec(`
      UPDATE messages SET pointer_enter_pending = 3, pointer_pty_id = 'pty';
      CREATE TRIGGER fail_delivery_ack BEFORE UPDATE ON deliveries
      BEGIN SELECT RAISE(ABORT, 'fixture commit failure'); END;
    `)
    expect(() => d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' })).toThrow(
      'fixture commit failure'
    )
    expect(d.getMessageById('run-mail')).toMatchObject({
      read: 0,
      pointer_enter_pending: 3,
      pointer_pty_id: 'pty'
    })
    expect(d.getDeliveryRaw('run-delivery')?.status).toBe('outstanding')
  })

  it('rebinds a Run using the existing engine without fencing its workers', () => {
    const d = fixture()
    const rebound = d.bindRun({
      runId: 'r1',
      coordinatorHandle: 'coordinator',
      coordinatorPaneKey: 'pane-coordinator'
    })!
    expect(rebound.consumer_generation).toBe(8)
    expect(d.getDeliveryRaw('worker-delivery')?.status).toBe('outstanding')
    expect(() => d.acknowledgeRunDelivery({ ...consumer, deliveryId: 'run-delivery' })).toThrow()
    expect(
      d
        .getOrCreateRunDelivery({ ...consumer, consumerGeneration: 8 })
        ?.messages.map((row) => row.id)
    ).toEqual(['run-mail'])
  })
})
