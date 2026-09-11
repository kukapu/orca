import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationDb } from '../../orchestration/db'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { LEGACY_RUN_ID } from '../../orchestration/db/contract-constants'
import { checkWorkerMailbox } from './orchestration/messaging/check-worker'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../../orchestration/db/schema/persisted-schema-test-fixture'

describe('worker check with physical schema30/39 methods, admission39 still blocked', () => {
  let directory: string
  let db: OrchestrationDb
  function fixture(version: 30 | 39 = 39): void {
    directory = mkdtempSync(join(tmpdir(), 'orca-worker-check-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, version)
    db = openPersistedSchemaMethodsFixture(path)
    db.db.exec(`
      INSERT INTO tasks (id, run_id, spec) VALUES ('t1', 'r1', 'Work');
      INSERT INTO dispatch_contexts (id, task_id, run_id, assignee_handle, assignee_pane_key)
        VALUES ('d1', 't1', 'r1', 'worker', 'pane-worker');
    `)
    if (version === 39) {
      db.db.exec('UPDATE dispatch_contexts SET consumer_generation = 7')
    }
  }
  afterEach(() => {
    vi.restoreAllMocks()
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function check(
    params: Parameters<typeof checkWorkerMailbox>[0]['params'] = {},
    waitForMessage = vi.fn().mockResolvedValue('arrived'),
    paneKey = 'pane-worker'
  ) {
    return checkWorkerMailbox({
      params,
      db,
      handle: 'worker',
      paneKey,
      typeFilter: params.types ? ['worker_done'] : undefined,
      signal: undefined,
      activeDispatch: db.getActiveDispatchForIdentity('worker', paneKey),
      remoteAttachment: undefined,
      runtime: { waitForMessage, notifyMessageArrived: vi.fn() } as unknown as OrcaRuntimeService
    })
  }

  it('returns a durable worker delivery on39; read alone must not acknowledge it', async () => {
    fixture()
    await expect(check()).resolves.toMatchObject({
      deliveryId: 'worker-delivery',
      replayed: true,
      count: 1
    })
    expect(db.getMessageById('worker-mail')?.read).toBe(0)
    await expect(check({ ack: 'worker-delivery' })).resolves.toMatchObject({
      acknowledged: 'worker-delivery',
      deliveryId: null,
      count: 0
    })
    expect(db.getMessageById('worker-mail')?.read).toBe(1)
    expect(db.getMessageById('run-mail')?.read).toBe(0)
  })

  it('refuses somebody else’s ACK and does not consume worker mail on the failure', async () => {
    fixture()
    await expect(check({ ack: 'run-delivery' })).rejects.toMatchObject({ code: 'stale_delivery' })
    expect(db.getMessageById('worker-mail')?.read).toBe(0)
  })

  it('keeps schema30 immediate reads and schema version unchanged', async () => {
    fixture(30)
    const result = await check()
    expect(result).toMatchObject({ dispatchId: 'd1', count: 1 })
    expect(result).not.toHaveProperty('deliveryId')
    expect(db.getMessageById('worker-mail')?.read).toBe(1)
    expect(db.db.pragma('user_version', { simple: true })).toBe(30)
  })

  it('fences a stale pane even when its terminal handle still matches', async () => {
    fixture()
    await expect(check({}, undefined, 'stale-pane')).rejects.toMatchObject({
      code: 'consumer_fenced'
    })
    expect(db.getMessageById('worker-mail')?.read).toBe(0)
  })

  it('fences a generation replacement during a wait without minting an old batch', async () => {
    fixture()
    db.db.exec(
      "DELETE FROM deliveries WHERE id = 'worker-delivery'; DELETE FROM messages WHERE id = 'worker-mail'"
    )
    const wait = vi.fn().mockImplementation(async () => {
      db.db.exec('UPDATE dispatch_contexts SET consumer_generation = 8')
      db.insertMessage({ runId: 'r1', from: 'sender', to: 'dispatch:d1', subject: 'arrived' })
      return 'arrived'
    })
    await expect(check({ wait: true }, wait)).rejects.toMatchObject({ code: 'consumer_fenced' })
    expect(
      db.db.prepare("SELECT 1 FROM deliveries WHERE mailbox_handle = 'dispatch:d1'").get()
    ).toBeUndefined()
  })

  it.each([30, 39] as const)(
    'does not consume a peek that wakes from a wait on%s',
    async (version) => {
      fixture(version)
      db.db.exec(
        "DELETE FROM deliveries WHERE id = 'worker-delivery'; DELETE FROM messages WHERE id = 'worker-mail'"
      )
      const wait = vi.fn().mockImplementation(async () => {
        db.insertMessage({
          id: 'arrived',
          runId: 'r1',
          from: 'sender',
          to: 'dispatch:d1',
          subject: 'arrived'
        })
        return 'arrived'
      })
      await expect(check({ wait: true, peek: true }, wait)).resolves.toMatchObject({ count: 1 })
      expect(db.getMessageById('arrived')?.read).toBe(0)
    }
  )

  it('serves a remote worker from the attachment generation and legacy host mailbox only', async () => {
    fixture()
    db.db.exec(`
      DELETE FROM deliveries WHERE id = 'worker-delivery';
      INSERT INTO remote_dispatch_attachments
        (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, consumer_generation,
         state, terminal_handle, pane_key, process_incarnation, capability_hash)
        VALUES ('d1', 'remote-task', 'remote-peer', 'epoch', 11, 'ready', 'remote-worker',
                'remote-pane', 'remote-process', 'fixture-capability-hash');
      INSERT OR IGNORE INTO runs (id, objective, consumer_generation, legacy)
        VALUES ('${LEGACY_RUN_ID}', 'Legacy', 0, 1);
      INSERT INTO messages (id, run_id, from_handle, to_handle, subject)
        VALUES ('remote-mail', '${LEGACY_RUN_ID}', 'sender', 'dispatch:d1', 'Remote message');
    `)
    const remoteCheck = (params: Parameters<typeof checkWorkerMailbox>[0]['params']) =>
      checkWorkerMailbox({
        params,
        db,
        handle: 'remote-worker',
        paneKey: 'remote-pane',
        typeFilter: undefined,
        signal: undefined,
        activeDispatch: undefined,
        remoteAttachment: db.getRemoteDispatchAttachment('d1'),
        runtime: {
          getTerminalProcessIncarnation: () => 'remote-process'
        } as unknown as OrcaRuntimeService
      })
    const batch = (await remoteCheck({})) as { deliveryId: string; messages: { id: string }[] }
    expect(batch.messages.map((row) => row.id)).toEqual(['remote-mail'])
    await remoteCheck({ ack: batch.deliveryId })
    expect(db.getMessageById('remote-mail')?.read).toBe(1)
    expect(db.getMessageById('worker-mail')?.read).toBe(0)
    expect(db.getMessageById('run-mail')?.read).toBe(0)
  })
})
