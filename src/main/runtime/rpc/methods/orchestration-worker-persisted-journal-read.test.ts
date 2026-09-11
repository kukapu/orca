import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../orchestration/db'
import { createPersistedSchemaFixture } from '../../orchestration/db/schema/persisted-schema-test-fixture'
import type { WorkerTerminalResourceRow } from '../../orchestration/worker-terminal-ownership'
import { readArchivedWorkerOutput } from './orchestration/worker/worker-archive-read'

const journal = {
  version: 1,
  agent: 'codex',
  processIncarnation: 'structured:session:inc',
  messages: ['first', 'second', 'last'].map((text, index) => ({
    id: String(index),
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  })),
  limited: true,
  warnings: ['Older journal items were omitted from the bounded archive.']
}

describe('persisted39 journal archive read', () => {
  let directory: string
  let db: OrchestrationDb
  const resource = {
    id: 'resource1',
    terminal_handle: 'endpoint/structworker_s1'
  } as WorkerTerminalResourceRow
  function fixture(content = JSON.stringify(journal)) {
    directory = mkdtempSync(join(tmpdir(), 'orca-persisted-journal-'))
    const path = join(directory, 'orchestration.db')
    createPersistedSchemaFixture(path, 39)
    db = new OrchestrationDb(path)
    db.db
      .prepare("UPDATE worker_terminal_archives SET content = ? WHERE dispatch_id = 'd1'")
      .run(content)
    return { db, dispatchId: 'd1', workerState: 'succeeded', resource }
  }
  afterEach(() => {
    db?.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([true, false])(
    'pages actual F v1 messages without losing stored limited=%s',
    async (limited) => {
      const args = fixture(JSON.stringify({ ...journal, limited }))
      const before = db.getWorkerTerminalArchive('d1')
      const first = await readArchivedWorkerOutput({ ...args, source: 'transcript', limit: 2 })
      expect(first).toMatchObject({
        source: 'transcript',
        provider: 'codex',
        archived: true,
        transcript: {
          messages: journal.messages.slice(0, 2),
          returnedMessageCount: 2,
          limited: true
        },
        status: { terminal: 'unknown', liveness: 'unverifiable' },
        warnings: expect.arrayContaining(journal.warnings)
      })
      const next = await readArchivedWorkerOutput({ ...args, cursor: first.cursor!, limit: 2 })
      expect(next).toMatchObject({
        sourceIdentity: first.sourceIdentity,
        transcript: { messages: journal.messages.slice(2), returnedMessageCount: 1, limited }
      })
      const end = await readArchivedWorkerOutput({ ...args, cursor: next.cursor! })
      expect(end).toMatchObject({ transcript: { messages: [], returnedMessageCount: 0, limited } })
      expect(db.getWorkerTerminalArchive('d1')).toEqual(before)
      await expect(readArchivedWorkerOutput({ ...args, source: 'terminal' })).rejects.toMatchObject(
        {
          code: 'archive_unavailable'
        }
      )
      await expect(
        readArchivedWorkerOutput({
          ...args,
          resource: { ...resource, id: 'replacement' },
          cursor: first.cursor!
        })
      ).rejects.toMatchObject({ code: 'source_changed' })
      db.db.exec("UPDATE worker_terminal_archives SET dispatch_id = 'd2'")
      await expect(
        readArchivedWorkerOutput({ ...args, dispatchId: 'd2', cursor: first.cursor! })
      ).rejects.toThrow()
    }
  )

  it.each([
    '{',
    'null',
    '{}',
    JSON.stringify({ ...journal, version: 2 }),
    JSON.stringify({ ...journal, messages: null }),
    JSON.stringify({ ...journal, warnings: [null] })
  ])(
    'rejects malformed journals with an archive error, never a terminal-lines crash: %s',
    async (content) => {
      const args = fixture(content)
      await expect(readArchivedWorkerOutput(args)).rejects.toMatchObject({
        code: 'archive_unavailable'
      })
      expect(db.getWorkerTerminalArchive('d1')?.content).toBe(content)
    }
  )

  it('does not treat an unknown archive kind as terminal lines', async () => {
    const args = fixture()
    db.db.pragma('ignore_check_constraints = ON')
    db.db.exec("UPDATE worker_terminal_archives SET kind = 'malformed_kind'")
    await expect(readArchivedWorkerOutput(args)).rejects.toMatchObject({
      code: 'archive_unavailable'
    })
  })

  it('keeps terminal-tail and frozen transcript reads unchanged', async () => {
    const args = fixture()
    db.db
      .prepare('UPDATE worker_terminal_archives SET kind = ?, content = ?')
      .run(
        'terminal_tail',
        JSON.stringify({ lines: ['one', 'two'], truncated: false, warnings: [] })
      )
    const tail = await readArchivedWorkerOutput({ ...args, limit: 1 })
    expect(tail).toMatchObject({
      source: 'terminal',
      terminal: { tail: ['one'], returnedLineCount: 1 }
    })
    expect(await readArchivedWorkerOutput({ ...args, cursor: tail.cursor! })).toMatchObject({
      terminal: { tail: ['two'], nextCursor: null }
    })
    db.db
      .prepare('UPDATE worker_terminal_archives SET kind = ?, content = ?')
      .run('transcript_pin', JSON.stringify({ ...journal, version: 2 }))
    expect(await readArchivedWorkerOutput(args)).toMatchObject({
      source: 'transcript',
      transcript: { messages: journal.messages },
      status: { terminal: 'unknown', liveness: 'unverifiable' }
    })
  })
})
