import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import { buildOpenCodeSqliteCandidatePath } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import type { OrcaRuntimeService } from '../orca-runtime'
import { captureWorkerOutputArchive } from './worker-output-archive'

describe('worker output archive transcript capture', () => {
  let directory: string

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('freezes the exact Pi transcript so worker-read stays structured after release', async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-worker-archive-pi-'))
    const transcriptPath = join(directory, 'pi-session.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session',
          id: 'pi-session',
          timestamp: '2026-05-01T10:08:00.000Z'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-done',
          timestamp: '2026-05-01T10:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Pi archived result' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )
    const runtime = {
      getExactWorkerProviderSession: vi.fn(() => ({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation-1',
        agent: 'pi',
        providerSession: {
          key: 'session_id',
          id: 'pi-session',
          transcriptPath
        },
        observedAt: Date.now(),
        connectionId: null
      })),
      readTerminal: vi.fn()
    } as unknown as OrcaRuntimeService

    const captured = await captureWorkerOutputArchive({
      runtime,
      dispatchId: 'dispatch_1',
      terminalHandle: 'term_worker',
      attachedAtMs: 0
    })

    expect(captured).toMatchObject({
      kind: 'transcript_pin',
      status: 'captured',
      content: {
        version: 2,
        agent: 'pi',
        messages: [{ id: 'pi-done', blocks: [{ type: 'text', text: 'Pi archived result' }] }],
        limited: false
      }
    })
    expect(runtime.readTerminal).not.toHaveBeenCalled()
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session',
          id: 'pi-session',
          timestamp: '2026-05-01T10:08:00.000Z'
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-done',
          timestamp: '2026-05-01T10:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'mutated after release' }] }
        })
      ]
        .join('\n')
        .concat('\n')
    )
    expect(captured).toMatchObject({
      content: { messages: [{ blocks: [{ type: 'text', text: 'Pi archived result' }] }] }
    })
    expect(JSON.stringify(captured)).not.toContain('mutated after release')
  })

  it('keeps the OpenCode version-2 snapshot after the live SQLite source mutates', async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-worker-archive-oc-'))
    const dbPath = join(directory, 'opencode.db')
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
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
        VALUES ('ses_arch', 'p', 's', '/tmp/oc', 't', '1', 1, 1);
      INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES ('msg_arch', 'ses_arch', 1, 1, '{"role":"assistant"}');
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES ('prt_arch', 'msg_arch', 'ses_arch', 1, 1, '{"type":"text","text":"archived result"}');
    `)
    db.close()
    const runtime = {
      getExactWorkerProviderSession: vi.fn(() => ({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation-1',
        agent: 'opencode',
        providerSession: {
          key: 'session_id',
          id: 'ses_arch',
          transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_arch')
        },
        observedAt: Date.now(),
        connectionId: null
      })),
      readTerminal: vi.fn()
    } as unknown as OrcaRuntimeService

    const captured = await captureWorkerOutputArchive({
      runtime,
      dispatchId: 'dispatch_1',
      terminalHandle: 'term_worker',
      attachedAtMs: 0
    })
    expect(captured).toMatchObject({
      kind: 'transcript_pin',
      content: {
        version: 2,
        messages: [{ blocks: [{ type: 'text', text: 'archived result' }] }]
      }
    })

    const dbWrite = new Database(dbPath)
    dbWrite.exec(
      `UPDATE part SET data = '{"type":"text","text":"mutated after release"}', time_updated = 9
       WHERE id = 'prt_arch'`
    )
    dbWrite.close()
    expect(JSON.stringify(captured)).toContain('archived result')
    expect(JSON.stringify(captured)).not.toContain('mutated after release')
  })
})
