import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type SyncDatabase from '../../../../../sqlite/sync-database'
import * as sshFilesystemDispatch from '../../../../../providers/ssh-filesystem-dispatch'
import { readExactWorkerOutput } from './worker-output'

function codexMessage(id: string, text: string): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: { id, type: 'agent_message', message: text }
  })
}

function applyOpenCodeSqliteSchema(db: SyncDatabase): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
      directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
  `)
}

describe('exact orchestration worker output', () => {
  let directory: string
  let transcriptA: string
  let transcriptB: string
  let providerSession: ReturnType<OrcaRuntimeService['getExactWorkerProviderSession']>
  let runtime: OrcaRuntimeService
  const readTerminal = vi.fn()
  let sshProviderLookup: { mockRestore: () => void }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-worker-output-'))
    transcriptA = join(directory, 'session-a.jsonl')
    transcriptB = join(directory, 'session-b.jsonl')
    await writeFile(transcriptA, `${codexMessage('a', 'worker A only')}\n`)
    await writeFile(transcriptB, `${codexMessage('b', 'worker B only')}\n`)
    providerSession = {
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation-1',
      agent: 'codex',
      providerSession: {
        key: 'session_id',
        id: 'session-a',
        transcriptPath: transcriptA
      },
      observedAt: Date.now()
    }
    readTerminal.mockReset()
    readTerminal.mockResolvedValue({
      handle: 'term_worker',
      status: 'running',
      tail: ['terminal output'],
      truncated: false,
      nextCursor: '9'
    })
    sshProviderLookup = vi.spyOn(sshFilesystemDispatch, 'getSshFilesystemProvider')
    runtime = {
      getExactWorkerProviderSession: vi.fn(() => providerSession),
      getTerminalProcessIncarnation: vi.fn(() => 'pty:incarnation-1'),
      getTerminalPaneKey: vi.fn(() => 'tab:worker'),
      readTerminal
    } as unknown as OrcaRuntimeService
  })

  afterEach(async () => {
    sshProviderLookup.mockRestore()
    await rm(directory, { recursive: true, force: true })
  })

  const read = (overrides: Partial<Parameters<typeof readExactWorkerOutput>[0]> = {}) =>
    readExactWorkerOutput({
      runtime,
      dispatchId: 'dispatch_1',
      terminalHandle: 'term_worker',
      workerState: 'ready',
      terminalStatus: 'running',
      attachedAt: '2026-07-24 00:00:00',
      ...overrides
    })

  it('reads only the exact pane session and keeps its local path private', async () => {
    const result = await read()

    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'codex',
      transcript: {
        messages: [{ id: 'a', blocks: [{ type: 'text', text: 'worker A only' }] }]
      }
    })
    expect(JSON.stringify(result)).not.toContain(transcriptA)
    expect(JSON.stringify(result)).not.toContain('worker B only')
    expect(readTerminal).not.toHaveBeenCalled()
  })

  it('keeps a successful empty auto read exact and cursor-fenced without terminal evidence', async () => {
    await writeFile(transcriptA, '')

    const result = await read()

    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'codex',
      transcript: { messages: [], limited: false, returnedMessageCount: 0 },
      fallbackReason: null,
      sourceExact: true,
      contentComplete: true,
      warnings: []
    })
    expect(result.cursor).toMatch(/^owr1_/)
    expect(readTerminal).not.toHaveBeenCalled()
  })

  it('reports unverifiable liveness without claiming the terminal is running', async () => {
    const result = await read({
      terminalStatus: 'unknown',
      terminalLiveness: 'unverifiable'
    })

    expect(result.status).toEqual({
      worker: 'ready',
      terminal: 'unknown',
      liveness: 'unverifiable'
    })
  })

  it('keeps WSL relay provenance on the guarded local transcript path', async () => {
    providerSession = {
      ...providerSession!,
      connectionId: 'wsl:Ubuntu',
      wslDistro: 'Ubuntu'
    }

    const result = await read()

    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'codex',
      transcript: {
        messages: [{ id: 'a', blocks: [{ type: 'text', text: 'worker A only' }] }]
      }
    })
    expect(sshProviderLookup).not.toHaveBeenCalled()
  })

  it('falls back safely when a WSL session lacks an attested distro', async () => {
    providerSession = {
      ...providerSession!,
      connectionId: 'wsl:Ubuntu'
    }

    await expect(read()).resolves.toMatchObject({
      source: 'terminal',
      fallbackReason: 'remote_capability_unavailable',
      sourceExact: false,
      contentComplete: false
    })
  })

  it('marks clipped transcript content incomplete without dropping its cursor', async () => {
    await writeFile(transcriptA, `${codexMessage('a', 'x'.repeat(5_000))}\n`)

    const result = await read()

    expect(result).toMatchObject({
      source: 'transcript',
      transcript: { limited: true, returnedMessageCount: 1 },
      sourceExact: true,
      contentComplete: false,
      clipping: ['transcript_payload'],
      warnings: ['Oversized transcript text was clipped.']
    })
    expect(result.cursor).toMatch(/^owr1_/)
  })

  it('keeps SSH transcript reads behind the remote filesystem capability', async () => {
    providerSession = {
      ...providerSession!,
      connectionId: 'ssh-target'
    }

    const result = await read()

    expect(result).toMatchObject({
      source: 'terminal',
      fallbackReason: 'remote_capability_unavailable'
    })
    expect(sshProviderLookup).toHaveBeenCalledWith('ssh-target')
  })

  it('reads Grok through the shared Native Chat transcript decoder', async () => {
    await writeFile(
      transcriptA,
      `${JSON.stringify({
        id: 'grok-a',
        type: 'assistant',
        content: 'Grok worker only'
      })}\n`
    )
    providerSession = {
      ...providerSession!,
      agent: 'grok',
      providerSession: {
        key: 'session_id',
        id: 'session-grok',
        transcriptPath: transcriptA
      }
    }

    const result = await read()

    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'grok',
      transcript: {
        messages: [{ role: 'assistant', blocks: [{ type: 'text', text: 'Grok worker only' }] }]
      }
    })
    expect(readTerminal).not.toHaveBeenCalled()
  })

  it('reads structured OpenCode output from the exact SQLite session', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const db = new Database(join(directory, 'opencode.db'))
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
        directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
    `)
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES ('ses_oc', 'p', 's', '/tmp/oc', 't', '1', 1, 1)`
    ).run()
    db.prepare(
      `INSERT INTO message (id, session_id, time_created, time_updated, data)
       VALUES ('msg_oc', 'ses_oc', 1, 1, '{"role":"assistant"}')`
    ).run()
    db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
       VALUES ('prt_oc', 'msg_oc', 'ses_oc', 1, 1, '{"type":"text","text":"OpenCode structured output"}')`
    ).run()
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_oc',
        transcriptPath: buildOpenCodeSqliteCandidatePath(join(directory, 'opencode.db'), 'ses_oc')
      }
    }

    const result = await read()
    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'opencode',
      transcript: {
        messages: [{ blocks: [{ type: 'text', text: 'OpenCode structured output' }] }]
      }
    })
    expect(readTerminal).not.toHaveBeenCalled()
  })

  it('rejects a stale cursor after a same-length part edit and serves the final content fresh', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const dbPath = join(directory, 'opencode-stream.db')
    const db = new Database(dbPath)
    applyOpenCodeSqliteSchema(db)
    db.exec(`
      BEGIN;
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_stream', 'p', 's', '/tmp/oc', 't', '1', 1, 1);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_stream', 'ses_stream', 10, 10, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_stream', 'msg_stream', 'ses_stream', 10, 10, '{"type":"text","text":"partial"}');
      COMMIT;
    `)
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_stream',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_stream')
      }
    }

    const initial = await read({ limit: 10 })
    expect(initial).toMatchObject({
      source: 'transcript',
      transcript: { messages: [{ blocks: [{ type: 'text', text: 'partial' }] }] }
    })
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const dbWrite = new Database(dbPath)
    dbWrite.exec(`
      UPDATE part SET data = '{"type":"text","text":"final!!"}' WHERE id = 'prt_stream';
    `)
    dbWrite.close()

    await expect(read({ cursor: initial.cursor, limit: 10 })).rejects.toMatchObject({
      code: 'source_changed'
    })

    const fresh = await read({ limit: 10 })
    expect(fresh).toMatchObject({
      source: 'transcript',
      transcript: { messages: [{ blocks: [{ type: 'text', text: 'final!!' }] }] }
    })
    expect(JSON.stringify(fresh)).not.toContain('"partial"')
  })

  it('pages a stable OpenCode snapshot through the opaque cursor', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const dbPath = join(directory, 'opencode-page.db')
    const db = new Database(dbPath)
    applyOpenCodeSqliteSchema(db)
    db.exec(`
      BEGIN;
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_page', 'p', 's', '/tmp/oc', 't', '1', 1, 1);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_p1', 'ses_page', 10, 10, '{"role":"user"}'),
               ('msg_p2', 'ses_page', 20, 20, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_p1', 'msg_p1', 'ses_page', 10, 10, '{"type":"text","text":"first page"}'),
               ('prt_p2', 'msg_p2', 'ses_page', 20, 20, '{"type":"text","text":"second page"}');
      COMMIT;
    `)
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_page',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_page')
      }
    }

    const first = await read({ limit: 1 })
    expect(first).toMatchObject({
      source: 'transcript',
      transcript: {
        messages: [{ id: 'msg_p1', blocks: [{ type: 'text', text: 'first page' }] }],
        limited: true
      }
    })
    if (first.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const second = await read({ cursor: first.cursor, limit: 1 })
    expect(second).toMatchObject({
      source: 'transcript',
      transcript: {
        messages: [{ id: 'msg_p2', blocks: [{ type: 'text', text: 'second page' }] }],
        limited: false
      }
    })
    if (second.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const done = await read({ cursor: second.cursor, limit: 1 })
    expect(done).toMatchObject({
      source: 'transcript',
      transcript: { messages: [], limited: false }
    })
  })

  it('rejects the stale cursor when a message is appended', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const dbPath = join(directory, 'opencode-append.db')
    const db = new Database(dbPath)
    applyOpenCodeSqliteSchema(db)
    db.exec(`
      BEGIN;
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_app', 'p', 's', '/tmp/oc', 't', '1', 1, 1);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_a1', 'ses_app', 10, 10, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_a1', 'msg_a1', 'ses_app', 10, 10, '{"type":"text","text":"before append"}');
      COMMIT;
    `)
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_app',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_app')
      }
    }

    const initial = await read({ limit: 10 })
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const dbWrite = new Database(dbPath)
    dbWrite.exec(`
      BEGIN;
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_a2', 'ses_app', 20, 20, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_a2', 'msg_a2', 'ses_app', 20, 20, '{"type":"text","text":"appended"}');
      COMMIT;
    `)
    dbWrite.close()

    await expect(read({ cursor: initial.cursor, limit: 10 })).rejects.toMatchObject({
      code: 'source_changed'
    })
  })

  it('rejects the stale cursor after a delete-and-reinsert keeps the message count', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const dbPath = join(directory, 'opencode-reorder.db')
    const db = new Database(dbPath)
    applyOpenCodeSqliteSchema(db)
    db.exec(`
      BEGIN;
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_reorder', 'p', 's', '/tmp/oc', 't', '1', 1, 1);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_r1', 'ses_reorder', 10, 10, '{"role":"user"}'),
               ('msg_r2', 'ses_reorder', 20, 20, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_r1', 'msg_r1', 'ses_reorder', 10, 10, '{"type":"text","text":"kept"}'),
               ('prt_r2', 'msg_r2', 'ses_reorder', 20, 20, '{"type":"text","text":"replaced"}');
      COMMIT;
    `)
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_reorder',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_reorder')
      }
    }

    const initial = await read({ limit: 10 })
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const dbWrite = new Database(dbPath)
    dbWrite.exec(`
      BEGIN;
      DELETE FROM part WHERE id = 'prt_r2';
      DELETE FROM message WHERE id = 'msg_r2';
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_r3', 'ses_reorder', 20, 20, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_r3', 'msg_r3', 'ses_reorder', 20, 20, '{"type":"text","text":"new body"}');
      COMMIT;
    `)
    dbWrite.close()

    await expect(read({ cursor: initial.cursor, limit: 10 })).rejects.toMatchObject({
      code: 'source_changed'
    })
  })

  it('signals source_changed when the last OpenCode message is deleted', async () => {
    const { default: Database } = await import('../../../sqlite/sync-database')
    const { buildOpenCodeSqliteCandidatePath } =
      await import('../../../ai-vault/session-scanner-opencode-sqlite-paths')
    const dbPath = join(directory, 'opencode-delete.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
        directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );
    `)
    db.exec(`
      BEGIN;
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_del', 'p', 's', '/tmp/oc', 't', '1', 1, 30);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_keep', 'ses_del', 10, 10, '{"role":"user"}'),
               ('msg_gone', 'ses_del', 20, 30, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_keep', 'msg_keep', 'ses_del', 10, 10, '{"type":"text","text":"keep"}'),
               ('prt_gone', 'msg_gone', 'ses_del', 20, 30, '{"type":"text","text":"gone"}');
      COMMIT;
    `)
    db.close()
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'ses_del',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_del')
      }
    }

    const initial = await read({ limit: 10 })
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }

    const dbWrite = new Database(dbPath)
    dbWrite.exec(`
      BEGIN;
      DELETE FROM part WHERE id = 'prt_gone';
      DELETE FROM message WHERE id = 'msg_gone';
      UPDATE session SET time_updated = 10 WHERE id = 'ses_del';
      COMMIT;
    `)
    dbWrite.close()

    await expect(read({ cursor: initial.cursor, limit: 10 })).rejects.toMatchObject({
      code: 'source_changed'
    })
  })

  it('reads structured Pi output from the hook session file', async () => {
    await writeFile(
      transcriptA,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-pi',
          timestamp: '2026-05-01T10:08:00.000Z'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-a',
          timestamp: '2026-05-01T10:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Pi worker only' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )
    providerSession = {
      ...providerSession!,
      agent: 'pi',
      providerSession: {
        key: 'session_id',
        id: 'session-pi',
        transcriptPath: transcriptA
      }
    }

    const result = await read()
    expect(result).toMatchObject({
      source: 'transcript',
      provider: 'pi',
      transcript: {
        messages: [{ role: 'assistant', blocks: [{ type: 'text', text: 'Pi worker only' }] }]
      }
    })
    expect(readTerminal).not.toHaveBeenCalled()
  })

  it('does not return another Pi session when the JSONL header id disagrees', async () => {
    await writeFile(
      transcriptA,
      [
        JSON.stringify({
          type: 'session',
          id: 'other-pi',
          timestamp: '2026-05-01T10:08:00.000Z'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-wrong',
          timestamp: '2026-05-01T10:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'wrong session body' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )
    providerSession = {
      ...providerSession!,
      agent: 'pi',
      providerSession: {
        key: 'session_id',
        id: 'session-pi',
        transcriptPath: transcriptA
      }
    }

    const result = await read()
    expect(result.source).toBe('terminal')
    expect(JSON.stringify(result)).not.toContain('wrong session body')
  })

  it('does not read a local transcript for an SSH worker', async () => {
    providerSession = {
      ...providerSession!,
      connectionId: 'ssh-remote',
      agent: 'pi',
      providerSession: {
        key: 'session_id',
        id: 'session-pi',
        transcriptPath: transcriptA
      }
    }
    await writeFile(
      transcriptA,
      `${JSON.stringify({
        type: 'message',
        id: 'pi-local',
        message: { role: 'assistant', content: [{ type: 'text', text: 'local machine only' }] }
      })}\n`
    )

    const result = await read()
    expect(result).toMatchObject({
      source: 'terminal',
      fallbackReason: 'remote_capability_unavailable'
    })
    expect(JSON.stringify(result)).not.toContain('local machine only')
  })

  it('labels OpenCode as a terminal fallback when the exact session is missing', async () => {
    const capability = `dcap_${'A'.repeat(43)}`
    readTerminal.mockResolvedValue({
      handle: 'term_worker',
      status: 'running',
      tail: [`opencode --dispatch-capability ${capability}`],
      truncated: false,
      nextCursor: '9'
    })
    providerSession = {
      ...providerSession!,
      agent: 'opencode',
      providerSession: {
        key: 'session_id',
        id: 'session-opencode',
        transcriptPath: transcriptA
      }
    }

    const result = await read()

    expect(result).toMatchObject({
      source: 'terminal',
      fallbackReason: 'transcript_missing',
      terminal: { tail: ['opencode --dispatch-capability [dispatch capability redacted]'] },
      warnings: ['Dispatch capability tokens were redacted from terminal output.']
    })
    expect(JSON.stringify(result)).not.toContain(capability)
  })

  it('redacts dispatch capabilities from terminal composer drafts', async () => {
    const capability = `dcap_${'A'.repeat(43)}`
    readTerminal.mockResolvedValue({
      handle: 'term_worker',
      status: 'running',
      tail: ['safe output'],
      draft: `send --dispatch-capability ${capability}`,
      truncated: false,
      nextCursor: '9'
    })
    providerSession = null

    const result = await read()

    expect(result).toMatchObject({
      source: 'terminal',
      terminal: {
        tail: ['safe output'],
        draft: 'send --dispatch-capability [dispatch capability redacted]'
      },
      warnings: ['Dispatch capability tokens were redacted from terminal output.']
    })
    expect(JSON.stringify(result)).not.toContain(capability)
  })

  it('rejects an old cursor after the exact provider session changes', async () => {
    const initial = await read()
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }
    providerSession = {
      ...providerSession!,
      providerSession: {
        key: 'session_id',
        id: 'session-b',
        transcriptPath: transcriptB
      }
    }

    await expect(read({ cursor: initial.cursor })).rejects.toMatchObject({
      code: 'source_changed'
    })
  })

  it('rejects an old cursor after a same-inode truncate/regrow', async () => {
    const initial = await read()
    if (initial.source !== 'transcript') {
      throw new Error('Expected transcript output')
    }
    const before = await stat(transcriptA, { bigint: true })
    await writeFile(
      transcriptA,
      `${codexMessage('replacement', 'unrelated transcript')}\n${' '.repeat(512)}`
    )
    const after = await stat(transcriptA, { bigint: true })
    expect(after.ino).toBe(before.ino)
    expect(after.dev).toBe(before.dev)
    const fresh = await read()
    if (fresh.source !== 'transcript') {
      throw new Error('Expected replacement transcript output')
    }
    expect(fresh.sourceIdentity).toBe(initial.sourceIdentity)

    await expect(read({ cursor: initial.cursor })).rejects.toMatchObject({
      code: 'source_changed'
    })
  })

  it('uses a labeled terminal fallback and keeps its cursor pinned', async () => {
    providerSession = null
    const fallback = await read()

    expect(fallback).toMatchObject({
      source: 'terminal',
      fallbackReason: 'session_not_reported',
      terminal: { tail: ['terminal output'] }
    })
    expect(fallback.cursor).toMatch(/^owr1_/)

    providerSession = {
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation-1',
      agent: 'codex',
      providerSession: {
        key: 'session_id',
        id: 'session-a',
        transcriptPath: transcriptA
      },
      observedAt: Date.now()
    }
    await read({ cursor: fallback.cursor ?? undefined })

    expect(readTerminal).toHaveBeenLastCalledWith('term_worker', {
      cursor: 9,
      limit: undefined
    })
  })

  it('fails instead of falling back when transcript output is required', async () => {
    providerSession = null

    await expect(read({ source: 'transcript' })).rejects.toMatchObject({
      code: 'transcript_required',
      data: { reason: 'session_not_reported' }
    })
    expect(readTerminal).not.toHaveBeenCalled()
  })
})
