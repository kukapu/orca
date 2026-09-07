import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { buildOpenCodeSqliteCandidatePath } from '../../ai-vault/session-scanner-opencode-sqlite-paths'
import {
  buildOpenCodeSnapshot,
  byteLengthExpr,
  snapshotMessageDataSql,
  snapshotMessageWindowSql,
  snapshotPartDataSql,
  snapshotPartWindowSql
} from './worker-transcript-opencode-snapshot'
import { readWorkerTranscript } from './worker-transcript-read'

const RECORD_LIMIT = 2 * 1024 * 1024

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

function createTempDb(): { db: Database.Database; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-worker-opencode-snapshot-'))
  tempDirs.push(dir)
  const path = join(dir, 'opencode.db')
  return { db: new Database(path), path }
}

function applyOpenCodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
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

function insertSession(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
     VALUES (?, 'proj-1', ?, '/tmp/opencode', ?, '1.0.0', 1, 1)`
  ).run(id, `slug-${id}`, `Title ${id}`)
}

function insertMessage(
  db: Database.Database,
  args: {
    id: string
    sessionId: string
    role: 'user' | 'assistant'
    timeCreated: number
  }
): void {
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.sessionId,
    args.timeCreated,
    args.timeCreated,
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
    text: string
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
    args.timeCreated,
    JSON.stringify({ type: 'text', text: args.text })
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
    text: args.text
  })
}

type ExplainOpcodeRow = {
  opcode: string
  p1: number
  p4: string | null
}

type ExplainPlanRow = {
  detail: string
}

// The transient payload gates (length + role extraction) are the only legitimate `data` reads;
// anything else would carry payloads into a sorter or projection before the cap applies.
function stripPayloadGates(sql: string): string {
  return sql
    .split(byteLengthExpr())
    .join('')
    .replace(/json_extract\([^)]*\)/g, '')
}

describe('OpenCode snapshot SQL caps payloads before materialization', () => {
  it('compiles the row caps into SQLite and never sorts payload columns', () => {
    const { db } = createTempDb()
    applyOpenCodeSchema(db)
    const windowQueries: [string, (string | number)[], number][] = [
      [snapshotMessageWindowSql(), ['ses_plan', RECORD_LIMIT], 51],
      [
        snapshotPartWindowSql({ sessionFilter: 'session_id = ? AND ', timeOrder: true }),
        ['ses_plan', 'msg_plan', RECORD_LIMIT],
        65
      ]
    ]
    for (const [sql, binds, cap] of windowQueries) {
      expect(stripPayloadGates(sql)).not.toMatch(/\bdata\b/)
      const plan = db.prepare(`EXPLAIN ${sql}`).all(...binds) as ExplainOpcodeRow[]
      expect(plan.some((op) => op.opcode === 'Integer' && op.p1 === cap)).toBe(true)
      expect(plan.some((op) => String(op.p4 ?? '').includes('row_number'))).toBe(false)
      const eqp = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds) as ExplainPlanRow[]
      expect(eqp.every((row) => !row.detail.includes('CO-ROUTINE'))).toBe(true)
    }
    for (const [sql, binds] of [
      [snapshotMessageDataSql(2), ['msg_a', 'msg_b', RECORD_LIMIT]],
      [snapshotPartDataSql(2), ['msg_plan', 'prt_a', 'prt_b', RECORD_LIMIT]]
    ] as [string, (string | number)[]][]) {
      expect(sql).toContain(`${byteLengthExpr()} <= ?`)
      const eqp = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...binds) as ExplainPlanRow[]
      expect(eqp.every((row) => row.detail.startsWith('SEARCH'))).toBe(true)
      expect(eqp.every((row) => !row.detail.includes('TEMP B-TREE'))).toBe(true)
    }
    db.close()
  })

  it('caps a high part fanout per message in SQL before loading payloads', () => {
    const { db } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_fanout')
    insertMessage(db, {
      id: 'msg_fanout',
      sessionId: 'ses_fanout',
      role: 'assistant',
      timeCreated: 0
    })
    for (let index = 0; index < 1_500; index += 1) {
      insertPart(db, {
        id: `prt-${String(index).padStart(4, '0')}`,
        messageId: 'msg_fanout',
        sessionId: 'ses_fanout',
        timeCreated: index + 1,
        text: `fanout-${index}`
      })
    }
    const snapshot = buildOpenCodeSnapshot(db, 'ses_fanout')
    const parts = snapshot.partsByMessage.get('msg_fanout') ?? []
    expect([parts.length, parts[0]?.id, parts.at(-1)?.id]).toEqual([64, 'prt-0000', 'prt-0063'])
    expect(snapshot).toMatchObject({
      partsOmittedCount: 1_436,
      oversizedPartCount: 0,
      partsBudgetExhausted: false
    })
    expect(buildOpenCodeSnapshot(db, 'ses_fanout').digest).toBe(snapshot.digest)
    db.close()
  })

  it('spends the part byte budget on the newest tail content first', async () => {
    const { db, path: dbPath } = createTempDb()
    applyOpenCodeSchema(db)
    insertSession(db, 'ses_budget')
    for (let index = 0; index < 36; index += 1) {
      insertTextMessage(db, {
        id: `msg_${String(index).padStart(2, '0')}`,
        sessionId: 'ses_budget',
        role: index % 2 === 0 ? 'user' : 'assistant',
        timeCreated: 100 + index,
        text: `budget-msg-${String(index).padStart(2, '0')}-${'k'.repeat(80 * 1024)}`
      })
    }
    const snapshot = buildOpenCodeSnapshot(db, 'ses_budget')
    const partCount = (id: string) => snapshot.partsByMessage.get(id)?.length ?? 0
    expect(snapshot.rows).toHaveLength(36)
    expect(snapshot.partsBudgetExhausted).toBe(true)
    for (let index = 25; index <= 35; index += 1) {
      expect(partCount(`msg_${String(index).padStart(2, '0')}`)).toBe(1)
    }
    for (let index = 0; index <= 8; index += 1) {
      expect(partCount(`msg_${String(index).padStart(2, '0')}`)).toBe(0)
    }
    let partBytes = 0
    for (const parts of snapshot.partsByMessage.values()) {
      partBytes += parts.reduce((total, part) => total + Buffer.byteLength(part.data, 'utf8'), 0)
    }
    expect(partBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(snapshot).toMatchObject({ oversizedPartCount: 0, partsOmittedCount: 0 })
    expect(buildOpenCodeSnapshot(db, 'ses_budget').digest).toBe(snapshot.digest)
    db.close()

    await expect(
      readWorkerTranscript({
        agent: 'opencode',
        sessionId: 'ses_budget',
        transcriptPath: buildOpenCodeSqliteCandidatePath(dbPath, 'ses_budget'),
        limit: 1
      })
    ).resolves.toMatchObject({
      ok: true,
      warnings: expect.arrayContaining([
        'Some transcript parts were omitted to keep the snapshot byte budget.'
      ])
    })
  })
})
