import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { buildOpenCodeSqliteCandidatePath } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import { readWorkerTranscript } from './worker-transcript-read'

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

function createTempDb(): { db: Database.Database; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-worker-opencode-'))
  tempDirs.push(dir)
  const path = join(dir, 'opencode.db')
  return { db: new Database(path), path, dir }
}

function applyOpenCodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      model TEXT,
      agent TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)
}

function insertSession(db: Database.Database, id: string, timeCreated: number): void {
  db.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, 'proj-1', ?, '/tmp/opencode', ?, '1.0.0', ?, ?)`
  ).run(id, `slug-${id}`, `Title ${id}`, timeCreated, timeCreated + 1)
}

function insertMessage(
  db: Database.Database,
  args: {
    id: string
    sessionId: string
    role: 'user' | 'assistant'
    timeCreated: number
    timeUpdated?: number
  }
): void {
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.sessionId,
    args.timeCreated,
    args.timeUpdated ?? args.timeCreated,
    JSON.stringify({ role: args.role, time: { created: args.timeCreated } })
  )
}

function insertPart(
  db: Database.Database,
  args: {
    id: string
    messageId: string
    sessionId: string
    timeCreated: number
    timeUpdated?: number
    data: unknown
  }
): void {
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.messageId,
    args.sessionId,
    args.timeCreated,
    args.timeUpdated ?? args.timeCreated,
    JSON.stringify(args.data)
  )
}

function insertTextMessage(
  db: Database.Database,
  args: {
    id: string
    sessionId: string
    role: 'user' | 'assistant'
    timeCreated: number
    text: string
  }
): void {
  insertMessage(db, args)
  insertPart(db, {
    id: `prt-${args.id}`,
    messageId: args.id,
    sessionId: args.sessionId,
    timeCreated: args.timeCreated,
    data: { type: 'text', text: args.text }
  })
}

describe('OpenCode worker transcript reads', () => {
  it('reads only the exact SQLite session and pages the bounded snapshot from the first index', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_exact', 1_777_634_000_000)
    insertSession(db, 'ses_other', 1_777_634_000_100)
    insertTextMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_exact',
      role: 'user',
      timeCreated: 1_777_634_000_500,
      text: 'Exact OpenCode prompt'
    })
    insertMessage(db, {
      id: 'msg_2',
      sessionId: 'ses_exact',
      role: 'assistant',
      timeCreated: 1_777_634_000_900
    })
    insertPart(db, {
      id: 'prt-msg_2',
      messageId: 'msg_2',
      sessionId: 'ses_exact',
      timeCreated: 1_777_634_000_900,
      data: { type: 'text', text: 'Exact OpenCode reply' }
    })
    insertPart(db, {
      id: 'prt-tool',
      messageId: 'msg_2',
      sessionId: 'ses_exact',
      timeCreated: 1_777_634_000_901,
      data: {
        type: 'tool',
        tool: 'bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'ok' }
      }
    })
    insertTextMessage(db, {
      id: 'msg_other',
      sessionId: 'ses_other',
      role: 'assistant',
      timeCreated: 1_777_634_001_000,
      text: 'Other OpenCode session'
    })
    db.close()

    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_exact')
    const initial = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_exact',
      transcriptPath,
      limit: 1
    })
    expect(initial).toMatchObject({
      ok: true,
      limited: true,
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          blocks: [{ type: 'text', text: 'Exact OpenCode prompt' }]
        }
      ]
    })
    if (!initial.ok) {
      throw new Error('Expected the OpenCode transcript page')
    }
    expect(initial.nextOffset).toBe(1)
    expect(JSON.stringify(initial.messages)).not.toContain('Other OpenCode session')

    const dbWrite = new Database(path)
    insertTextMessage(dbWrite, {
      id: 'msg_3',
      sessionId: 'ses_exact',
      role: 'assistant',
      timeCreated: 1_777_634_002_000,
      text: 'After cursor'
    })
    dbWrite.close()

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_exact',
        transcriptPath,
        offset: initial.nextOffset,
        limit: 2
      })
    ).resolves.toMatchObject({
      ok: true,
      limited: false,
      messages: [
        {
          id: 'msg_2',
          blocks: expect.arrayContaining([
            { type: 'text', text: 'Exact OpenCode reply' },
            { type: 'tool-call', name: 'bash', input: { command: 'ls' } }
          ])
        },
        { id: 'msg_3', blocks: [{ type: 'text', text: 'After cursor' }] }
      ]
    })
  })

  it('delivers same-timestamp messages across limit-1 pages without skipping', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_tie', 1)
    insertTextMessage(db, {
      id: 'msg_a',
      sessionId: 'ses_tie',
      role: 'assistant',
      timeCreated: 100,
      text: 'tie first'
    })
    insertTextMessage(db, {
      id: 'msg_b',
      sessionId: 'ses_tie',
      role: 'assistant',
      timeCreated: 100,
      text: 'tie second'
    })
    db.close()
    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_tie')

    const first = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_tie',
      transcriptPath,
      limit: 1
    })
    expect(first).toMatchObject({
      ok: true,
      messages: [{ id: 'msg_a', blocks: [{ type: 'text', text: 'tie first' }] }],
      limited: true
    })
    if (!first.ok) {
      throw new Error('Expected the first tie page')
    }

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_tie',
        transcriptPath,
        offset: first.nextOffset,
        limit: 1
      })
    ).resolves.toMatchObject({
      ok: true,
      messages: [{ id: 'msg_b', blocks: [{ type: 'text', text: 'tie second' }] }],
      limited: false
    })
  })

  it('ends the page instead of repeating when a part update outruns the message watermark', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_repeat', 1)
    insertMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_repeat',
      role: 'assistant',
      timeCreated: 10,
      timeUpdated: 10
    })
    insertPart(db, {
      id: 'prt-streamed',
      messageId: 'msg_1',
      sessionId: 'ses_repeat',
      timeCreated: 10,
      timeUpdated: 10,
      data: { type: 'text', text: 'streamed body' }
    })
    db.close()
    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_repeat')

    const initial = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_repeat',
      transcriptPath,
      limit: 1
    })
    expect(initial).toMatchObject({
      ok: true,
      messages: [{ id: 'msg_1', blocks: [{ type: 'text', text: 'streamed body' }] }]
    })
    if (!initial.ok) {
      throw new Error('Expected the initial page')
    }

    const dbWrite = new Database(path)
    dbWrite
      .prepare(`UPDATE part SET data = ?, time_updated = 100 WHERE id = 'prt-streamed'`)
      .run(JSON.stringify({ type: 'text', text: 'streamed body edited' }))
    dbWrite.close()

    const follow = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_repeat',
      transcriptPath,
      offset: initial.nextOffset,
      limit: 1
    })
    expect(follow).toMatchObject({ ok: true, messages: [], limited: false })
    if (!follow.ok) {
      throw new Error('Expected the follow page')
    }

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_repeat',
        transcriptPath,
        offset: follow.nextOffset,
        limit: 1
      })
    ).resolves.toMatchObject({ ok: true, messages: [], limited: false })
  })

  it('shows the final part content when only a part changes', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_part', 1)
    insertMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_part',
      role: 'assistant',
      timeCreated: 10
    })
    insertPart(db, {
      id: 'prt_1',
      messageId: 'msg_1',
      sessionId: 'ses_part',
      timeCreated: 10,
      data: { type: 'text', text: 'partial' }
    })
    db.close()
    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_part')

    const initial = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_part',
      transcriptPath,
      limit: 10
    })
    expect(initial).toMatchObject({
      ok: true,
      messages: [{ blocks: [{ type: 'text', text: 'partial' }] }]
    })

    const dbWrite = new Database(path)
    dbWrite
      .prepare(`UPDATE part SET data = ? WHERE id = 'prt_1'`)
      .run(JSON.stringify({ type: 'text', text: 'final!!' }))
    dbWrite.close()

    const fresh = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_part',
      transcriptPath,
      limit: 10
    })
    expect(fresh).toMatchObject({
      ok: true,
      messages: [{ blocks: [{ type: 'text', text: 'final!!' }] }]
    })
    if (fresh.ok) {
      expect(JSON.stringify(fresh.messages)).not.toContain('partial')
    }
  })

  it('omits parts beyond the per-message cap with a warning', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_many', 1)
    insertMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_many',
      role: 'assistant',
      timeCreated: 10
    })
    for (let index = 0; index < 70; index += 1) {
      insertPart(db, {
        id: `prt-${String(index).padStart(2, '0')}`,
        messageId: 'msg_1',
        sessionId: 'ses_many',
        timeCreated: 10 + index,
        data: { type: 'text', text: `part-body-${String(index).padStart(2, '0')}` }
      })
    }
    db.close()

    const result = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_many',
      transcriptPath: buildOpenCodeSqliteCandidatePath(path, 'ses_many'),
      limit: 10
    })
    expect(result).toMatchObject({
      ok: true,
      messages: [{ blocks: expect.arrayContaining([{ type: 'text', text: 'part-body-00' }]) }]
    })
    if (result.ok) {
      expect(result.warnings).toContain(
        '6 transcript part(s) were omitted from messages with too many parts.'
      )
      expect(JSON.stringify(result)).not.toContain('part-body-69')
    }
  })

  it('bounds records by UTF-8 bytes, not characters', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_unicode', 1)
    insertMessage(db, {
      id: 'msg_ok',
      sessionId: 'ses_unicode',
      role: 'assistant',
      timeCreated: 1
    })
    insertPart(db, {
      id: 'prt-ok',
      messageId: 'msg_ok',
      sessionId: 'ses_unicode',
      timeCreated: 1,
      data: { type: 'text', text: 'visible' }
    })
    insertPart(db, {
      id: 'prt-wide',
      messageId: 'msg_ok',
      sessionId: 'ses_unicode',
      timeCreated: 2,
      data: { type: 'text', text: 'é'.repeat(1_100_000) }
    })
    db.close()

    const result = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_unicode',
      transcriptPath: buildOpenCodeSqliteCandidatePath(path, 'ses_unicode'),
      limit: 10
    })
    expect(result).toMatchObject({
      ok: true,
      messages: [{ blocks: [{ type: 'text', text: 'visible' }] }],
      warnings: ['1 oversized transcript record(s) were skipped.']
    })
    expect(JSON.stringify(result)).not.toContain('é'.repeat(32))
  })

  it('warns when OpenCode parts exceed the record byte limit without returning them', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_big', 1)
    insertTextMessage(db, {
      id: 'msg_ok',
      sessionId: 'ses_big',
      role: 'assistant',
      timeCreated: 1,
      text: 'visible'
    })
    db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'prt-huge',
      'msg_ok',
      'ses_big',
      2,
      2,
      JSON.stringify({ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 8) })
    )
    db.close()

    const result = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_big',
      transcriptPath: buildOpenCodeSqliteCandidatePath(path, 'ses_big'),
      limit: 10
    })
    expect(result).toMatchObject({
      ok: true,
      messages: [{ blocks: [{ type: 'text', text: 'visible' }] }],
      warnings: ['1 oversized transcript record(s) were skipped.']
    })
    expect(JSON.stringify(result)).not.toContain('x'.repeat(32))
  })

  it('bounds the snapshot window and warns when older messages are dropped', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_win', 1)
    for (let index = 0; index < 60; index += 1) {
      insertTextMessage(db, {
        id: `msg_${String(index).padStart(2, '0')}`,
        sessionId: 'ses_win',
        role: index % 2 === 0 ? 'user' : 'assistant',
        timeCreated: 100 + index,
        text: `bulk-${String(index).padStart(2, '0')}`
      })
    }
    db.close()
    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_win')

    const initial = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_win',
      transcriptPath
    })
    expect(initial).toMatchObject({ ok: true, limited: true })
    if (initial.ok) {
      expect(initial.messages).toHaveLength(40)
      expect(initial.messages[0]).toMatchObject({
        id: 'msg_10',
        blocks: [{ type: 'text', text: 'bulk-10' }]
      })
      expect(initial.messages.at(-1)?.id).toBe('msg_49')
      expect(initial.nextOffset).toBe(40)
      expect(initial.warnings).toContain(
        'Older transcript messages were omitted from the bounded snapshot.'
      )
      expect(JSON.stringify(initial)).not.toContain('bulk-09')
      expect(JSON.stringify(initial)).not.toContain('bulk-00')
    }

    const rest = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_win',
      transcriptPath,
      offset: 40,
      limit: 50
    })
    expect(rest).toMatchObject({ ok: true, limited: false })
    if (rest.ok) {
      expect(rest.messages).toHaveLength(10)
      expect(rest.messages.at(-1)?.id).toBe('msg_59')
      expect(rest.nextOffset).toBe(50)
    }

    const done = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_win',
      transcriptPath,
      offset: 50,
      limit: 50
    })
    expect(done).toMatchObject({ ok: true, messages: [], limited: false })
  })

  it('degrades legacy watermark pins instead of scanning the session', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_pin', 1)
    insertTextMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_pin',
      role: 'assistant',
      timeCreated: 10,
      text: 'pinned body'
    })
    db.close()

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_pin',
        transcriptPath: buildOpenCodeSqliteCandidatePath(path, 'ses_pin'),
        offset: 10,
        endOffset: 10,
        limit: 10
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: 'transcript_unreadable',
      warnings: [
        'Legacy pinned OpenCode sessions are not re-read by archive watermark; start a fresh worker-read without the archive cursor.'
      ]
    })
  })

  it('degrades legacy OpenCode JSON sessions instead of reading them unbounded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-worker-opencode-legacy-'))
    tempDirs.push(dir)
    const storage = join(dir, 'storage')
    const exactDir = join(storage, 'message', 'ses_legacy')
    const otherDir = join(storage, 'message', 'ses_other')
    await mkdir(exactDir, { recursive: true })
    await mkdir(otherDir, { recursive: true })
    await mkdir(join(storage, 'session', 'project'), { recursive: true })
    await writeFile(
      join(storage, 'session', 'project', 'ses_legacy.json'),
      JSON.stringify({ id: 'ses_legacy', directory: '/tmp/opencode' })
    )
    await writeFile(
      join(exactDir, 'msg_b.json'),
      JSON.stringify({
        id: 'msg_b',
        role: 'assistant',
        content: [{ type: 'text', text: 'Legacy later' }],
        time: { created: 2 }
      })
    )
    await writeFile(
      join(exactDir, 'msg_a.json'),
      JSON.stringify({
        id: 'msg_a',
        role: 'user',
        content: [{ type: 'text', text: 'Legacy first' }],
        time: { created: 1 }
      })
    )
    await writeFile(
      join(otherDir, 'msg_other.json'),
      JSON.stringify({
        id: 'msg_other',
        role: 'assistant',
        content: [{ type: 'text', text: 'Other legacy session' }],
        time: { created: 1 }
      })
    )

    const result = await readWorkerTranscript({
      agent: 'opencode',
      sessionId: 'ses_legacy',
      transcriptPath: join(storage, 'session', 'project', 'ses_legacy.json'),
      limit: 10
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'transcript_unreadable',
      warnings: [
        'Legacy OpenCode JSON sessions are not read unbounded; structured output requires SQLite storage.'
      ]
    })
    expect(JSON.stringify(result)).not.toContain('Legacy first')
    expect(JSON.stringify(result)).not.toContain('Other legacy session')
  })

  it('reports a missing OpenCode session instead of another id', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_real', 1)
    insertTextMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_real',
      role: 'assistant',
      timeCreated: 1,
      text: 'real'
    })
    db.close()

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_missing',
        transcriptPath: buildOpenCodeSqliteCandidatePath(path, 'ses_missing'),
        limit: 2
      })
    ).resolves.toMatchObject({ ok: false, reason: 'transcript_missing' })
  })

  it('treats a shrunk OpenCode source as changed', async () => {
    const { db, path } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_shrink', 1)
    insertTextMessage(db, {
      id: 'msg_1',
      sessionId: 'ses_shrink',
      role: 'assistant',
      timeCreated: 1,
      text: 'one'
    })
    db.close()
    const transcriptPath = buildOpenCodeSqliteCandidatePath(path, 'ses_shrink')

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_shrink',
        transcriptPath,
        offset: 10,
        limit: 2
      })
    ).resolves.toMatchObject({ ok: false, reason: 'source_changed' })
  })
})
