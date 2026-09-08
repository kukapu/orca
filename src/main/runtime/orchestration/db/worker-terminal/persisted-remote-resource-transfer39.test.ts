import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrchestrationDb } from '../orchestration-db'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../schema/persisted-schema-test-fixture'
import { AGENT_PROMPT_STALLED_ERROR } from '../../../agent-prompt-submission-verification'

describe('pure remote resource ownership transfer, methods only', () => {
  let directory: string
  let db: OrchestrationDb
  const identity = {
    terminalHandle: 'worker',
    paneKey: 'pane',
    processIncarnation: 'process',
    hostScope: 'ssh:host'
  }
  function fixture(version: 30 | 39 = 39) {
    directory = mkdtempSync(join(tmpdir(), 'orca-remote-resource-transfer-'))
    const file = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(file, version)
    db = openPersistedSchemaMethodsFixture(file)
    db.db.exec(`INSERT INTO remote_dispatch_attachments
      (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch, state, pane_key, process_incarnation)
      VALUES ('old', 'task', 'peer', 'epoch', 'succeeded', 'pane', 'process');`)
    return db.createWorkerTerminalResourceStatement({
      ...identity,
      dispatchId: 'old',
      worktreeId: 'folder',
      ownership: 'owned',
      endpointId: 'epoch'
    })
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([30, 39] as const)('schema%s selects and transfers a pure remote owner', (version) => {
    const resource = fixture(version)
    expect(db.getWorkerDispatch('old')).toBeUndefined()
    expect(db.findTransferableWorkerTerminalResource(identity)?.id).toBe(resource.id)
    db.db.exec(`INSERT INTO remote_dispatch_attachments
      (dispatch_id, task_id, home_peer_fingerprint, runtime_epoch) VALUES ('new', 'task2', 'peer', 'new-epoch')`)
    db.prepareRemoteAttachmentAuthority({
      ...identity,
      dispatchId: 'new',
      worktreeId: 'folder',
      setupState: 'ready',
      effects: [],
      terminalOwnership: 'external'
    })
    expect(db.getWorkerTerminalResourceByOwner('new')).toMatchObject({
      id: resource.id,
      ownership_state: 'owned',
      prior_owner_dispatch_ids: '["old"]'
    })
    expect(db.getRemoteDispatchAttachment('old')?.state).toBe('succeeded')
  })

  it.each(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'])(
    'does not borrow ownership from a %s remote worker',
    (state) => {
      fixture()
      db.db.prepare('UPDATE remote_dispatch_attachments SET state = ?').run(state)
      expect(db.findTransferableWorkerTerminalResource(identity)).toBeUndefined()
    }
  )

  it.each(['requested', 'releasing', 'unknown'])('remote release %s remains a lock', (state) => {
    fixture()
    db.db.prepare('UPDATE worker_terminal_resources SET release_state = ?').run(state)
    expect(() => db.findTransferableWorkerTerminalResource(identity)).toThrow('release in progress')
  })

  it('does not treat an unobserved failed prompt as a settled remote owner', () => {
    fixture()
    db.db
      .prepare("UPDATE remote_dispatch_attachments SET state = 'failed', last_error = ?")
      .run(AGENT_PROMPT_STALLED_ERROR)
    expect(db.findTransferableWorkerTerminalResource(identity)).toBeUndefined()
  })

  it('does not let a settled twin hide an active local owner or a different host', () => {
    fixture()
    expect(
      db.findTransferableWorkerTerminalResource({ ...identity, hostScope: 'ssh:other' })
    ).toBeUndefined()
    db.db.exec("INSERT INTO worker_dispatches (dispatch_id, state) VALUES ('old', 'ready')")
    expect(db.findTransferableWorkerTerminalResource(identity)).toBeUndefined()
  })

  it('neither selects nor directly transfers a structured resource journal', () => {
    const resource = fixture()
    db.db
      .prepare(`INSERT INTO worker_terminal_archives (dispatch_id, resource_id, kind, content)
      VALUES ('old', ?, 'structured_journal', 'keep')`)
      .run(resource.id)
    expect(db.findTransferableWorkerTerminalResource(identity)).toBeUndefined()
    expect(() =>
      db.transferWorkerTerminalResourceStatement({
        ...identity,
        resourceId: resource.id,
        toDispatchId: 'new'
      })
    ).toThrow('structured resource')
    expect(db.getWorkerTerminalResource(resource.id)).toEqual(resource)
    expect(db.getWorkerTerminalArchive('old')?.content).toBe('keep')
  })
})
