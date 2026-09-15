import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectAddedLineRanges,
  intersectAddedLineRanges,
  diagnosticTouchesAddedLines
} from './check-changed-code-quality.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-merge-quality-'))
  roots.push(root)
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
      }
    }).trim()
  const write = (file, body) => writeFileSync(path.join(root, file), body)
  git('init', '--quiet')
  write('base.ts', 'export const base = 0\n')
  git('add', 'base.ts')
  git('commit', '--quiet', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', '-b', 'fork')
  write('fork.ts', 'export const own = 1\n')
  git('add', 'fork.ts')
  git('commit', '--quiet', '-m', 'fork')
  const fork = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', '-b', 'official', base)
  write('official.ts', 'export const inherited = 2\n')
  git('add', 'official.ts')
  git('commit', '--quiet', '-m', 'official')
  const official = git('rev-parse', 'HEAD')
  git('checkout', '--quiet', 'fork')
  return { root, git, write, fork, official }
}

describe('merge-resolution quality scope', () => {
  it('intersects current-file coordinates without losing partial overlaps', () => {
    expect(
      intersectAddedLineRanges(
        [{ start: 2, end: 8 }],
        [
          { start: 1, end: 3 },
          { start: 6, end: 9 }
        ]
      )
    ).toEqual([
      { start: 2, end: 3 },
      { start: 6, end: 8 }
    ])
    expect(intersectAddedLineRanges([{ start: 2, end: 4 }], [{ start: 5, end: 8 }])).toEqual([])
  })

  it('keeps new violations and untracked files while attributing inherited source to its parent', () => {
    const { root, git, write, fork, official } = fixture()
    git('merge', '--quiet', '--no-ff', '--no-edit', official)
    write('fork.ts', 'export const own = 3\n')
    write('resolution.ts', 'export const resolution = 4\n')
    const ordinary = collectAddedLineRanges(root, fork)
    expect(ordinary.rangesByFile.has('official.ts')).toBe(true)
    const merged = collectAddedLineRanges(root, fork, official)
    expect([...merged.rangesByFile.keys()].sort()).toEqual(['fork.ts', 'resolution.ts'])
    expect(
      diagnosticTouchesAddedLines(
        { filename: 'fork.ts', labels: [{ span: { line: 1 } }] },
        merged.rangesByFile,
        root
      )
    ).toBe(true)
  })

  it('refuses an unmerged source rather than suppressing diagnostics from it', () => {
    const { root, fork, official } = fixture()
    expect(() => collectAddedLineRanges(root, fork, official)).toThrow()
  })
})
