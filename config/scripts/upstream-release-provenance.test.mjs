import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runUpstreamReleasePrecheck } from './upstream-release-precheck.mjs'

const OPTIONS = { automationId: 'automation-1', repoId: 'repo-1', baselineTag: 'v1.4.197' }
const TAG = 'v1.4.198-kukapu.1'
const HASH = 'e'.repeat(64)
const MANIFEST = 'orca-release-provenance.json'
const asset = (name = 'orca.zip', id = 1) => ({
  id,
  name,
  state: 'uploaded',
  size: 123,
  digest: `sha256:${HASH}`
})
const manifest = (extra = {}) => ({
  schemaVersion: 1,
  repository: 'kukapu/orca',
  upstreamRepository: 'stablyai/orca',
  state: 'published',
  upstreamTag: 'v1.4.198',
  upstreamOid: 'a'.repeat(40),
  sourceTag: TAG,
  forkVersion: '1.4.198-kukapu.1',
  sourceCommit: 'c'.repeat(40),
  publicationCommit: 'd'.repeat(40),
  sourceTree: 'f'.repeat(40),
  artifacts: [{ name: 'orca.zip', size: 123, sha256: HASH }],
  ...extra
})
function fixture(value = manifest(), flags = {}) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
  return {
    payload,
    release: {
      id: 10,
      tag_name: value.sourceTag ?? TAG,
      draft: true,
      prerelease: false,
      assets: [
        asset(),
        {
          id: 99,
          name: MANIFEST,
          state: 'uploaded',
          size: payload.length,
          digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
        }
      ],
      ...flags
    }
  }
}
function runner(
  record = fixture(),
  { fork = [record.release], worktrees = [], target = 'v1.4.199', orcaCli = 'orca' } = {}
) {
  return vi.fn(async (command, args) => {
    if (command === orcaCli) {
      return JSON.stringify({
        ok: true,
        result: {
          worktrees,
          totalCount: worktrees.length,
          truncated: false,
          hostScope: { omittedHostIds: [] }
        }
      })
    }
    expect(command).toBe('gh')
    if (args[1] === 'repos/stablyai/orca/releases?per_page=100&page=1') {
      return JSON.stringify([{ tag_name: target, draft: false, prerelease: false }])
    }
    if (args[1] === 'repos/kukapu/orca/releases?per_page=100&page=1') {
      return JSON.stringify(fork)
    }
    expect(args).toEqual([
      'api',
      'repos/kukapu/orca/releases/assets/99',
      '-H',
      'Accept: application/octet-stream'
    ])
    return record.payload
  })
}
const local = (extra = {}) => ({
  automationProvenance: { automationId: OPTIONS.automationId },
  comment: `orca-release-preparation:${JSON.stringify(manifest(extra))}`
})
const blocked = { launch: false, reason: 'unverifiable', error: true }

describe('durable release provenance precheck', () => {
  it.each(['v1.4.198', 'v1.4.199'])(
    'recovers C/P without worktree metadata for %s',
    async (target) => {
      const run = runner(fixture(), { target })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: target === 'v1.4.199',
        reason: target === 'v1.4.199' ? 'new-stable-release' : 'fork-draft-exists',
        upstreamTag: target,
        highwaterTag: 'v1.4.198',
        sourceTag: TAG,
        sourceCommit: 'c'.repeat(40),
        publicationCommit: 'd'.repeat(40),
        sourceTree: 'f'.repeat(40)
      })
      expect(run).toHaveBeenCalledTimes(4)
      expect(run.mock.calls[3][2]).toEqual({
        encoding: null,
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }
  )

  it('accepts a published release and SHA-256 Git OIDs', async () => {
    const value = manifest(
      Object.fromEntries(
        ['upstreamOid', 'sourceCommit', 'publicationCommit', 'sourceTree'].map((field) => [
          field,
          'A'.repeat(64)
        ])
      )
    )
    expect(
      await runUpstreamReleasePrecheck(OPTIONS, runner(fixture(value, { draft: false })))
    ).toMatchObject({ launch: true, sourceCommit: 'A'.repeat(64) })
  })

  it.each(['sourceCommit', 'publicationCommit', 'upstreamOid', 'sourceTree'])(
    'blocks local/durable %s conflicts',
    async (field) => {
      const run = runner(fixture(), { worktrees: [local({ [field]: 'b'.repeat(40) })] })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: false,
        reason: 'reconcile-legacy'
      })
    }
  )

  it.each(['preparing', 'blocked', 'legacy'])('preserves %s worktree blockers', async (state) => {
    const worktree = state === 'legacy' ? { ...local(), comment: '' } : local({ state })
    expect(
      await runUpstreamReleasePrecheck(OPTIONS, runner(fixture(), { worktrees: [worktree] }))
    ).toMatchObject({
      launch: false,
      reason: state === 'legacy' ? 'reconcile-legacy' : 'preparation-pending'
    })
  })

  it('merges matching local provenance case-insensitively and retains the tree', async () => {
    const run = runner(fixture(), {
      worktrees: [local({ sourceCommit: 'C'.repeat(40), sourceTree: undefined })]
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: true,
      sourceTree: 'f'.repeat(40),
      publicationCommit: 'd'.repeat(40)
    })
  })

  it.each([
    { schemaVersion: 2 },
    { schemaVersion: '1' },
    { repository: 'evil/orca' },
    { upstreamRepository: 'kukapu/orca' },
    { state: 'prepared' },
    { upstreamTag: 'main' },
    { sourceTag: 'v1.4.198-kukapu.2' },
    { sourceTag: undefined },
    { forkVersion: '1.4.198-kukapu.2' },
    ...['upstreamOid', 'sourceCommit', 'publicationCommit', 'sourceTree'].flatMap((field) =>
      [undefined, null, 123, 'SECRET invalid oid', 'a'.repeat(39), 'g'.repeat(40)].map((value) => ({
        [field]: value
      }))
    )
  ])('rejects invalid manifest source fields (%j)', async (extra) => {
    const result = await runUpstreamReleasePrecheck(
      OPTIONS,
      runner(fixture(manifest(extra), { tag_name: TAG }))
    )
    expect(result).toMatchObject(blocked)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it.each(
    [
      null,
      [],
      Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, size: 123, sha256: HASH })),
      [null],
      [{ name: MANIFEST, size: 123, sha256: HASH }],
      ...['../orca.zip', '/orca.zip', 'C:\\orca.zip', '.', '..', 'a/b', 'a\\b', 'a\n'].map(
        (name) => [{ name, size: 123, sha256: HASH }]
      ),
      ...[0, -1, 1.5, '123', Number.MAX_SAFE_INTEGER + 1].map((size) => [
        { name: 'orca.zip', size, sha256: HASH }
      ]),
      [{ name: 'orca.zip', size: 123, sha256: 'bad' }],
      [
        { name: 'orca.zip', size: 123, sha256: HASH },
        { name: 'orca.zip', size: 123, sha256: HASH }
      ],
      [{ name: 'missing.zip', size: 123, sha256: HASH }]
    ].map((artifacts) => [artifacts])
  )('rejects invalid/missing/duplicate artifacts (%j)', async (artifacts) => {
    expect(
      await runUpstreamReleasePrecheck(OPTIONS, runner(fixture(manifest({ artifacts }))))
    ).toMatchObject(blocked)
  })

  it.each([
    { state: 'starter' },
    { size: 124 },
    { digest: null },
    { digest: `sha256:${'0'.repeat(64)}` }
  ])('blocks incomplete artifact uploads (%j)', async (extra) => {
    const record = fixture()
    Object.assign(record.release.assets[0], extra)
    expect(await runUpstreamReleasePrecheck(OPTIONS, runner(record))).toMatchObject(blocked)
  })

  it.each([1, 4, 20])(
    'accepts %s generic artifacts as a subset, not a platform checklist',
    async (count) => {
      const assets = Array.from({ length: count }, (_, i) => asset(`package-${i}.zip`, i + 1))
      const record = fixture(
        manifest({ artifacts: assets.map(({ name, size }) => ({ name, size, sha256: HASH })) })
      )
      record.release.assets = [
        ...assets,
        record.release.assets[1],
        { ...asset('unrelated notes.txt', 50), digest: null, state: 'starter' }
      ]
      expect(await runUpstreamReleasePrecheck(OPTIONS, runner(record))).toMatchObject({
        launch: true
      })
    }
  )

  it.each(
    [
      null,
      {},
      [null],
      [{ ...asset(), id: '1' }],
      [{ ...asset(), size: -1 }],
      [{ ...asset(), digest: 'bad' }],
      [{ ...asset(), name: null }],
      [asset(), asset()],
      [asset(), asset('other.zip')],
      [asset(), asset('orca.zip', 2)],
      [{ ...asset(), state: false }]
    ].map((assets) => [assets])
  )('validates asset listing shape (%j)', async (assets) => {
    const record = fixture(manifest(), { assets })
    const run = runner(record)
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject(blocked)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it.each([{ size: 65537 }, { size: 0 }, { digest: null }, { state: 'starter' }])(
    'rejects manifest metadata before downloading (%j)',
    async (extra) => {
      const record = fixture()
      Object.assign(record.release.assets[1], extra)
      const run = runner(record)
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject(blocked)
      expect(run).toHaveBeenCalledTimes(3)
    }
  )

  it.each(['digest', 'size', 'oversized', 'private-json', 'utf8'])(
    'checks raw payload integrity before JSON parsing (%s)',
    async (kind) => {
      const record = fixture(
        kind === 'private-json' ? Buffer.from('SECRET invalid JSON') : manifest()
      )
      if (kind === 'digest') {
        record.release.assets[1].digest = `sha256:${'0'.repeat(64)}`
      }
      if (kind === 'size') {
        record.release.assets[1].size += 1
      }
      if (kind === 'oversized') {
        record.payload = Buffer.alloc(65537)
      }
      if (kind === 'utf8') {
        record.payload = Buffer.from(record.payload.toString().replace('published', 'publíshéd'))
      }
      const result = await runUpstreamReleasePrecheck(OPTIONS, runner(record))
      expect(result).toMatchObject(blocked)
      expect(JSON.stringify(result)).not.toContain('SECRET')
    }
  )

  it('redacts asset command stderr and private payload', async () => {
    const base = runner()
    const run = vi.fn((...args) => {
      if (args[1][1].includes('/assets/')) {
        throw Object.assign(new Error('SECRET'), {
          stdout: 'SECRET payload',
          stderr: 'SECRET credentials'
        })
      }
      return base(...args)
    })
    const result = await runUpstreamReleasePrecheck(OPTIONS, run)
    expect(result).toMatchObject({ launch: false, reason: 'command-error', error: true })
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('accepts the exact 64 KiB payload boundary without reserializing JSON', async () => {
    const json = JSON.stringify(manifest(), null, 2)
    const record = fixture(Buffer.from(json.padEnd(65536, ' ')))
    expect(await runUpstreamReleasePrecheck(OPTIONS, runner(record))).toMatchObject({
      launch: true
    })
  })

  it.each(['releases', 'worktrees'])(
    'never recovers from incomplete %s visibility',
    async (kind) => {
      const record = fixture()
      const base = runner(record)
      const run = vi.fn((command, args) => {
        if (kind === 'releases' && args[1].startsWith('repos/kukapu/orca/releases?')) {
          return JSON.stringify(Array.from({ length: 100 }, () => record.release))
        }
        if (kind === 'worktrees' && command === 'orca') {
          return JSON.stringify({
            ok: true,
            result: { worktrees: [], totalCount: 0, truncated: true }
          })
        }
        return base(command, args)
      })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: false,
        error: true,
        reason: kind === 'releases' ? 'incomplete-release-listing' : 'unverifiable'
      })
      expect(run.mock.calls.some(([, args]) => args[1].includes('/assets/'))).toBe(false)
    }
  )

  it.each([false, true])(
    'fetches only the numeric greatest manifest, malformed=%s never falls back',
    async (malformed) => {
      const record = fixture(
        manifest({
          sourceTag: 'v1.10.0-kukapu.10',
          forkVersion: '1.10.0-kukapu.10',
          upstreamTag: 'v1.10.0',
          schemaVersion: malformed ? 2 : 1
        })
      )
      const older = ['v1.9.999-kukapu.99', 'v1.10.0-kukapu.2', TAG].map((tag_name, i) => ({
        ...fixture().release,
        tag_name,
        assets: [asset(), { ...record.release.assets[1], id: 200 + i }]
      }))
      const run = runner(record, {
        fork: [older[0], record.release, ...older.slice(1)],
        target: 'v1.11.0'
      })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject(
        malformed ? blocked : { launch: true, sourceTag: 'v1.10.0-kukapu.10' }
      )
      expect(run).toHaveBeenCalledTimes(4)
    }
  )

  it.each([false, true])(
    'blocks newer releases without provenance including draft=%s',
    async (draft) => {
      const record = fixture()
      const fork = [record.release, { tag_name: 'v1.4.198-kukapu.2', draft }]
      expect(await runUpstreamReleasePrecheck(OPTIONS, runner(record, { fork }))).toMatchObject({
        launch: false,
        reason: 'unknown-source-lineage'
      })
      expect(
        await runUpstreamReleasePrecheck(
          OPTIONS,
          runner(record, {
            fork,
            worktrees: [local({ sourceTag: 'v1.4.198-kukapu.2', forkVersion: '1.4.198-kukapu.2' })]
          })
        )
      ).toMatchObject({ launch: true, sourceTag: 'v1.4.198-kukapu.2' })
    }
  )

  it('calls the explicitly pinned absolute Orca CLI', async () => {
    const orcaCli = isAbsolute('/home/kukapu/.local/bin/orca-ide')
      ? '/home/kukapu/.local/bin/orca-ide'
      : 'C:\\orca\\orca-ide.exe'
    const run = runner(fixture(), { orcaCli })
    expect(await runUpstreamReleasePrecheck({ ...OPTIONS, orcaCli }, run)).toMatchObject({
      launch: true
    })
    expect(run.mock.calls[2].slice(0, 2)).toEqual([
      orcaCli,
      ['worktree', 'list', '--repo', 'id:repo-1', '--limit', '100', '--json']
    ])
  })

  it.each(['orca', './orca', '', null, 42])(
    'rejects nonabsolute explicit CLI (%j)',
    async (orcaCli) => {
      const run = runner()
      expect(await runUpstreamReleasePrecheck({ ...OPTIONS, orcaCli }, run)).toMatchObject({
        launch: false,
        reason: 'invalid-options',
        error: true
      })
      expect(run).not.toHaveBeenCalled()
    }
  )
})
