import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { runUpstreamReleasePrecheck } from './upstream-release-precheck.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const OPTIONS = { automationId: 'automation-1', repoId: 'repo-1', baselineTag: 'v1.4.197' }
const LATEST = 'v1.4.198'
const provenance = (upstreamTag = LATEST, revision = 1) => ({
  upstreamTag,
  upstreamOid: 'a'.repeat(40),
  sourceTag: `${upstreamTag}-kukapu.${revision}`,
  sourceCommit: 'c'.repeat(40),
  forkVersion: `${upstreamTag.slice(1)}-kukapu.${revision}`
})
const release = (tag_name, flags = {}) => ({ tag_name, draft: false, prerelease: false, ...flags })
const fullPage = Array.from({ length: 100 }, (_, i) => release(`mobile-v0.0.${i}`))
const envelope = (worktrees = [], overrides = {}) => ({
  ok: true,
  result: {
    worktrees,
    totalCount: worktrees.length,
    truncated: false,
    hostScope: { omittedHostIds: [] },
    ...overrides
  }
})
const worktree = (state, upstreamTag = LATEST, overrides = {}) => ({
  id: 'worktree-1',
  createdAt: 1,
  automationProvenance: { automationId: OPTIONS.automationId },
  comment: `orca-release-preparation:${JSON.stringify({
    ...(state === 'prepared' || state === 'published' ? provenance(upstreamTag) : { upstreamTag }),
    ...(state === 'published' ? { publicationCommit: 'd'.repeat(40) } : {}),
    state
  })}\nEvidence follows`,
  ...overrides
})

function mockRun({
  official = [[release(LATEST)]],
  fork = [[]],
  listing = envelope([worktree('published', OPTIONS.baselineTag)])
} = {}) {
  return vi.fn(async (command, args) => {
    if (command === 'orca') {
      return JSON.stringify(listing)
    }
    const match = /^repos\/(stablyai|kukapu)\/orca\/releases\?per_page=100&page=([1-9]|10)$/.exec(
      args[1]
    )
    if (command !== 'gh' || args[0] !== 'api' || !match) {
      throw new Error('Unexpected command')
    }
    const pages = match[1] === 'stablyai' ? official : fork
    const page = pages[Number(match[2]) - 1]
    if (page === undefined) {
      throw new Error('Unexpected page')
    }
    return JSON.stringify(page)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(execFileSync).mockReset()
})

describe('runUpstreamReleasePrecheck', () => {
  it('launches only the greatest official stable exact tag using three read-only commands', async () => {
    const run = mockRun({
      official: [[release('v1.4.199'), release(LATEST), release('v1.4.200', { prerelease: true })]]
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toEqual({
      launch: true,
      reason: 'new-stable-release',
      upstreamTag: 'v1.4.199',
      highwaterTag: OPTIONS.baselineTag,
      sourceTag: `${OPTIONS.baselineTag}-kukapu.1`,
      sourceCommit: 'c'.repeat(40),
      forkVersion: '1.4.197-kukapu.1',
      sourceUpstreamTag: OPTIONS.baselineTag,
      sourceUpstreamOid: 'a'.repeat(40),
      publicationCommit: 'd'.repeat(40)
    })
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [
        'gh',
        [
          'api',
          'repos/stablyai/orca/releases?per_page=100&page=1',
          '--jq',
          'map({tag_name,draft,prerelease})'
        ]
      ],
      [
        'gh',
        [
          'api',
          'repos/kukapu/orca/releases?per_page=100&page=1',
          '--jq',
          'map({id,tag_name,draft,prerelease,assets: [.assets[] | {id,name,state,size,digest}]})'
        ]
      ],
      ['orca', ['worktree', 'list', '--repo', 'id:repo-1', '--limit', '100', '--json']]
    ])
    for (const [, , options] of run.mock.calls) {
      expect(options).toEqual({
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }
  })

  it.each([
    [],
    [release('mobile-v9.0.0'), release('v9.0.0-rc.1'), release('v9.0.0-kukapu.1')],
    [release('v9.0.0', { draft: true }), release('v8.0.0', { prerelease: true })],
    [
      { tagName: 'v9.0.0', isDraft: true },
      { tagName: 'v8.0.0', isPrerelease: true }
    ]
  ])('does not launch without an official stable release (%j)', async (...releases) => {
    const run = mockRun({ official: [releases] })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: false,
      reason: 'no-stable-release',
      upstreamTag: ''
    })
    expect(run).toHaveBeenCalledTimes(3)
  })

  it.each(['v1.4.196', 'v1.4.197'])('honors the explicit baseline snapshot for %s', async (tag) => {
    expect(
      await runUpstreamReleasePrecheck(OPTIONS, mockRun({ official: [[release(tag)]] }))
    ).toMatchObject({ launch: false, reason: 'already-covered', highwaterTag: 'v1.4.197' })
  })

  it('completes ten pages per repository within 21 commands and compares semver numerically', async () => {
    const ninePages = Array.from({ length: 9 }, () => fullPage)
    const run = mockRun({
      official: [...ninePages, [release('v1.10.0'), release('v1.9.999')]],
      fork: [...ninePages, [release('v1.9.999-kukapu.1')]],
      listing: envelope([worktree('published', 'v1.9.999')])
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: true,
      upstreamTag: 'v1.10.0',
      highwaterTag: 'v1.9.999'
    })
    expect(run).toHaveBeenCalledTimes(21)
    expect(run.mock.calls.slice(0, 20).map(([command, args]) => [command, args])).toEqual(
      ['stablyai', 'kukapu'].flatMap((owner) =>
        Array.from({ length: 10 }, (_, index) => [
          'gh',
          [
            'api',
            `repos/${owner}/orca/releases?per_page=100&page=${index + 1}`,
            '--jq',
            owner === 'kukapu'
              ? 'map({id,tag_name,draft,prerelease,assets: [.assets[] | {id,name,state,size,digest}]})'
              : 'map({tag_name,draft,prerelease})'
          ]
        ])
      )
    )
  })

  it.each(['official', 'fork'])(
    'fails closed at ten full %s pages without fetching page 11',
    async (source) => {
      const run = mockRun({ [source]: [...Array.from({ length: 10 }, () => fullPage), []] })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: false,
        reason: 'incomplete-release-listing',
        error: true
      })
      expect(run).toHaveBeenCalledTimes(source === 'official' ? 10 : 11)
    }
  )

  it.each([1, 2, 3])('redacts remote command failure at call %s', async (call) => {
    const fixture = mockRun()
    const run = vi.fn(async (...args) => {
      if (run.mock.calls.length === call) {
        throw Object.assign(new Error('SECRET command credentials'), {
          stdout: 'SECRET stdout',
          stderr: 'SECRET stderr'
        })
      }
      return fixture(...args)
    })
    const result = await runUpstreamReleasePrecheck(OPTIONS, run)
    expect(result).toMatchObject({ launch: false, reason: 'command-error', error: true })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(run).toHaveBeenCalledTimes(call)
  })

  it.each(
    [null, {}, [null], [{ tag_name: 123 }], [release(LATEST, { draft: 'false' })]].map((rows) => [
      rows
    ])
  )('rejects malformed release data (%j)', async (rows) => {
    expect(await runUpstreamReleasePrecheck(OPTIONS, mockRun({ official: [rows] }))).toMatchObject({
      launch: false,
      reason: 'unverifiable',
      error: true
    })
  })

  it.each([
    { truncated: true },
    { truncated: undefined },
    { totalCount: 101 },
    { total: 101 },
    { totalCount: undefined },
    { hostScope: undefined },
    { hostScope: {} },
    { hostScope: { omittedHostIds: ['ssh:offline'] } },
    { worktrees: [null], totalCount: 1 }
  ])('rejects incomplete worktree visibility (%j)', async (overrides) => {
    expect(
      await runUpstreamReleasePrecheck(OPTIONS, mockRun({ listing: envelope([], overrides) }))
    ).toMatchObject({ launch: false, reason: 'unverifiable', error: true })
  })

  it.each([null, {}, { ok: false, result: envelope().result }, { ok: true, result: {} }])(
    'requires a successful worktree envelope (%j)',
    async (listing) => {
      expect(await runUpstreamReleasePrecheck(OPTIONS, mockRun({ listing }))).toMatchObject({
        launch: false,
        reason: 'unverifiable',
        error: true
      })
    }
  )

  it.each(['preparing', 'blocked'])(
    'blocks older %s even with a newer official release',
    async (state) => {
      const run = mockRun({
        listing: envelope([worktree(state, 'v1.4.196', { status: 'completed' })])
      })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: false,
        reason: 'preparation-pending',
        upstreamTag: LATEST
      })
    }
  )

  it.each(['prepared', 'published'])(
    'does not recompile %s same/newer preparation',
    async (state) => {
      for (const tag of [LATEST, 'v1.5.0']) {
        const run = mockRun({ listing: envelope([worktree(state, tag)]) })
        expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
          launch: false,
          reason: 'already-covered',
          highwaterTag: tag
        })
        expect(run).toHaveBeenCalledTimes(3)
      }
    }
  )

  it('allows a newer release after an older preparation and ignores other automations', async () => {
    const run = mockRun({
      listing: envelope([
        worktree('prepared', OPTIONS.baselineTag),
        worktree('blocked', LATEST, {
          automationProvenance: { automationId: 'another' },
          comment: ''
        })
      ])
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({ launch: true })
  })

  it.each([
    undefined,
    '',
    'completed',
    'orca-release-preparation:{',
    '\norca-release-preparation:{"upstreamTag":"v1.4.198","state":"prepared"}',
    'orca-release-preparation:null',
    ...[
      { state: undefined },
      { state: 'completed' },
      { state: 'unverifiable' },
      { state: null },
      { upstreamTag: 'main' },
      { upstreamOid: 'bad' },
      { upstreamOid: undefined },
      { sourceTag: undefined },
      { sourceCommit: undefined },
      { forkVersion: undefined },
      { sourceTag: 'v1.4.199-kukapu.1' },
      { forkVersion: '1.4.198-kukapu.2' },
      { sourceTag: 'v1.4.198-kukapu.0', forkVersion: '1.4.198-kukapu.0' },
      { sourceCommit: 'c'.repeat(39) },
      { sourceCommit: 123 },
      { publicationCommit: 'not-an-oid' },
      { publicationCommit: null },
      { state: 'published', publicationCommit: undefined },
      { reason: {} }
    ].map(
      (extra) =>
        `orca-release-preparation:${JSON.stringify({ ...provenance(), state: 'prepared', ...extra })}`
    )
  ])('requires reconciliation of legacy/invalid comments (%j)', async (comment) => {
    const run = mockRun({
      listing: envelope([worktree('prepared', LATEST, { comment, status: 'completed' })])
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: false,
      reason: 'reconcile-legacy'
    })
  })

  it('accepts optional OID/reason without exposing comment secrets', async () => {
    const comment = `orca-release-preparation:${JSON.stringify({
      upstreamTag: LATEST,
      upstreamOid: 'a'.repeat(40),
      state: 'blocked',
      reason: 'SECRET'
    })}\nprivate evidence`
    const result = await runUpstreamReleasePrecheck(
      OPTIONS,
      mockRun({
        listing: envelope([worktree('blocked', LATEST, { comment })])
      })
    )
    expect(result.reason).toBe('preparation-pending')
    expect(JSON.stringify(result)).not.toMatch(/SECRET|private/)
  })

  it.each(['draft', 'isDraft'])('blocks the same fork draft via %s', async (flag) => {
    const run = mockRun({ fork: [[release(`${LATEST}-kukapu.1`, { [flag]: true })]] })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: false,
      reason: 'fork-draft-exists'
    })
  })

  it.each([`${LATEST}-kukapu.1`, 'v1.5.0-kukapu.2'])(
    'blocks uninventoried published fork %s without certifying its highwater',
    async (tag) => {
      const run = mockRun({ fork: [[release(tag)]] })
      expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
        launch: false,
        reason: 'unknown-source-lineage',
        highwaterTag: OPTIONS.baselineTag
      })
    }
  )

  it('ignores fork prereleases, mobile, official-format tags and older drafts', async () => {
    const run = mockRun({
      fork: [
        [
          release('v9.0.0-kukapu.1', { prerelease: true }),
          { tagName: 'v8.0.0-kukapu.1', isPrerelease: true },
          release('mobile-v9.0.0-kukapu.1'),
          release('v9.0.0'),
          release('v1.4.196-kukapu.1', { draft: true })
        ]
      ]
    })
    expect(await runUpstreamReleasePrecheck(OPTIONS, run)).toMatchObject({
      launch: true,
      highwaterTag: OPTIONS.baselineTag
    })
  })

  it.each([
    null,
    {},
    { ...OPTIONS, baselineTag: undefined },
    { ...OPTIONS, baselineTag: 'main' },
    { ...OPTIONS, repoId: 'x; touch /tmp/secret' },
    { ...OPTIONS, automationId: '' }
  ])('validates options before any command (%j)', async (options) => {
    const run = mockRun()
    expect(await runUpstreamReleasePrecheck(options, run)).toMatchObject({
      launch: false,
      reason: 'invalid-options',
      error: true
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects non-JSON command output without exposing it', async () => {
    const result = await runUpstreamReleasePrecheck(
      OPTIONS,
      vi.fn(() => 'SECRET not JSON')
    )
    expect(result).toEqual({ launch: false, reason: 'unverifiable', upstreamTag: '', error: true })
  })

  it.each([[], [worktree('prepared', 'v1.4.190')]])(
    'does not bootstrap from a baseline or obsolete source (%j)',
    async (...worktrees) => {
      expect(
        await runUpstreamReleasePrecheck(OPTIONS, mockRun({ listing: envelope(worktrees) }))
      ).toMatchObject({ launch: false, reason: 'canonical-source-required' })
    }
  )

  it.each(['prepared', 'published'])(
    'reconciles %s legacy markers lacking provenance',
    async (state) => {
      const comment = `orca-release-preparation:${JSON.stringify({ upstreamTag: LATEST, state })}`
      expect(
        await runUpstreamReleasePrecheck(
          OPTIONS,
          mockRun({ listing: envelope([worktree(state, LATEST, { comment })]) })
        )
      ).toMatchObject({ launch: false, reason: 'reconcile-legacy' })
    }
  )

  it('selects the maximum canonical source numerically, not publication or inventory order', async () => {
    const source = {
      ...provenance(LATEST, 10),
      sourceCommit: 'C'.repeat(64),
      upstreamOid: 'A'.repeat(64)
    }
    const comment = `orca-release-preparation:${JSON.stringify({ ...source, state: 'prepared' })}`
    const result = await runUpstreamReleasePrecheck(
      OPTIONS,
      mockRun({
        official: [[release('v1.4.199')]],
        fork: [[release('v1.4.197-kukapu.2')]],
        listing: envelope([
          worktree('published', 'v1.4.197'),
          worktree('prepared', LATEST, { comment }),
          worktree('published', LATEST)
        ])
      })
    )
    expect(result).toMatchObject({
      launch: true,
      sourceTag: source.sourceTag,
      sourceCommit: source.sourceCommit,
      sourceUpstreamOid: source.upstreamOid
    })
    expect(result).not.toHaveProperty('publicationCommit')
    expect(result).not.toHaveProperty('state')
  })

  it.each(['sourceCommit', 'upstreamOid', 'publicationCommit'])(
    'rejects contradictory %s for the same source tag',
    async (field) => {
      const comment = `orca-release-preparation:${JSON.stringify({ ...provenance(), [field]: 'b'.repeat(40), state: 'prepared' })}`
      expect(
        await runUpstreamReleasePrecheck(
          OPTIONS,
          mockRun({
            listing: envelope([
              worktree('published'),
              worktree('prepared'),
              worktree('prepared', LATEST, { comment })
            ])
          })
        )
      ).toMatchObject({ launch: false, reason: 'reconcile-legacy' })
    }
  )

  it.each([true, false])(
    'retains publication provenance regardless of marker order (%s)',
    async (reverse) => {
      const markers = [worktree('published'), worktree('prepared')]
      const result = await runUpstreamReleasePrecheck(
        OPTIONS,
        mockRun({
          official: [[release('v1.4.199')]],
          listing: envelope(reverse ? markers.toReversed() : markers)
        })
      )
      expect(result).toMatchObject({
        launch: true,
        sourceCommit: 'c'.repeat(40),
        publicationCommit: 'd'.repeat(40)
      })
    }
  )

  it('blocks a higher uninventoried fork revision even when the official version is covered', async () => {
    expect(
      await runUpstreamReleasePrecheck(
        OPTIONS,
        mockRun({
          fork: [[release(`${LATEST}-kukapu.2`)]],
          listing: envelope([worktree('prepared')])
        })
      )
    ).toMatchObject({ launch: false, reason: 'unknown-source-lineage', highwaterTag: LATEST })
  })
})

describe('standalone environment entrypoint', () => {
  it.each(['command-error', 'incomplete-release-listing'])(
    'prints safe %s JSON and exits 2',
    async (reason) => {
      vi.resetModules()
      vi.stubEnv('ORCA_RELEASE_PRECHECK_OPTIONS', JSON.stringify(OPTIONS))
      vi.mocked(execFileSync).mockImplementation(() => {
        if (reason === 'command-error') {
          throw new Error('SECRET stderr')
        }
        return JSON.stringify(fullPage)
      })
      const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const previous = process.exitCode
      try {
        await import('./upstream-release-precheck.mjs')
        expect(process.exitCode).toBe(2)
        expect(write).toHaveBeenCalledExactlyOnceWith(
          `${JSON.stringify({ launch: false, reason, upstreamTag: '', error: true })}\n`
        )
        expect(execFileSync).toHaveBeenCalledTimes(reason === 'command-error' ? 1 : 10)
      } finally {
        process.exitCode = previous
      }
    }
  )

  it('bundles in memory as ESM without runtime filesystem dependencies', async () => {
    const result = await build({
      entryPoints: ['config/scripts/upstream-release-precheck.mjs'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true
    })
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports)
    expect(imports.every((entry) => entry.external)).toBe(true)
    expect(imports.map((entry) => entry.path).sort()).toEqual([
      'node:child_process',
      'node:crypto',
      'node:path',
      'node:url'
    ])
    expect(result.outputFiles[0].text).toContain('ORCA_RELEASE_PRECHECK_OPTIONS')
  })

  it.each([
    [undefined, undefined],
    ['', 2],
    ['{', 2],
    ['{}', 2],
    [JSON.stringify(OPTIONS), 0],
    [JSON.stringify({ ...OPTIONS, baselineTag: LATEST }), 1]
  ])('runs only with explicit env options (%j)', async (raw, exitCode) => {
    vi.resetModules()
    vi.stubEnv('ORCA_RELEASE_PRECHECK_OPTIONS', raw)
    vi.mocked(execFileSync)
      .mockReturnValueOnce(JSON.stringify([release(LATEST)]))
      .mockReturnValueOnce('[]')
      .mockReturnValueOnce(JSON.stringify(envelope([worktree('published', OPTIONS.baselineTag)])))
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const previous = process.exitCode
    try {
      await import('./upstream-release-precheck.mjs')
      expect(process.exitCode).toBe(exitCode ?? previous)
      expect(write).toHaveBeenCalledTimes(raw === undefined ? 0 : 1)
      expect(execFileSync).toHaveBeenCalledTimes(exitCode === 0 || exitCode === 1 ? 3 : 0)
      if (raw !== undefined) {
        expect(JSON.parse(write.mock.calls[0][0]).launch).toBe(exitCode === 0)
      }
    } finally {
      process.exitCode = previous
    }
  })
})
