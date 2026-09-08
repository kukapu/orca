import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcessSync } from '../../src/shared/child-process/run-process.ts'

it('keeps publication history out of the next source while explicitly porting later own changes', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'orca-source-lineage-'))
  const repo = join(scratch, 'repo')
  const home = join(scratch, 'home')
  const template = join(scratch, 'empty-template')
  const config = join(scratch, 'empty-config')
  for (const directory of [repo, home, template]) {
    mkdirSync(directory)
  }
  writeFileSync(config, '')
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR)$/i.test(key)
      )
    ),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: '',
    GIT_AUTHOR_NAME: 'Source lineage test',
    GIT_AUTHOR_EMAIL: 'source@example.invalid',
    GIT_COMMITTER_NAME: 'Source lineage test',
    GIT_COMMITTER_EMAIL: 'source@example.invalid',
    ORCA_BACKGROUND_LAUNCH: '1'
  }
  const git = (...args) => {
    const result = runProcessSync({
      program: 'git',
      args: [
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'core.autocrlf=false',
        ...args
      ],
      cwd: repo,
      env,
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024
    })
    expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0)
    return result.stdout.trim()
  }
  const commitFile = (file, content) => {
    writeFileSync(join(repo, file), content)
    git('add', '--', file)
    git('commit', '-m', file)
    return git('rev-parse', 'HEAD')
  }
  const bridge = (source, published) => {
    const tree = git('rev-parse', `${source}^{tree}`)
    expect(git('status', '--porcelain')).toBe('')
    expect(git('rev-parse', 'HEAD')).toBe(source)
    expect(git('write-tree')).toBe(tree)
    git('merge', '--no-ff', '--no-commit', '-s', 'ours', published)
    expect(git('rev-parse', 'HEAD')).toBe(source)
    expect(git('rev-parse', 'MERGE_HEAD')).toBe(published)
    expect(git('write-tree')).toBe(tree)
    git('diff', '--exit-code')
    git('commit', '-m', 'Publish validated source with history bridge')
    const publication = git('rev-parse', 'HEAD')
    expect(git('show', '-s', '--format=%P', publication)).toBe(`${source} ${published}`)
    expect(git('rev-parse', `${publication}^{tree}`)).toBe(tree)
    expect(git('write-tree')).toBe(tree)
    expect(git('status', '--porcelain')).toBe('')
    git('merge-base', '--is-ancestor', published, publication)
    return publication
  }

  try {
    // Git 2.25 has checkout -b, but not init -b; the template contains no hooks.
    git('init', `--template=${template}`)
    git('checkout', '-b', 'official')
    commitFile('base.txt', 'stable A\n')
    git('tag', 'v1.4.198')
    commitFile('feature-b.txt', 'B was on main before its stable release\n')
    const featureB = git('rev-parse', 'HEAD')

    git('checkout', '-b', 'historical-fork')
    const publishedF = commitFile('main-tip-extra.txt', 'excluded from stable source\n')
    git('checkout', '-b', 'source-198', 'v1.4.198')
    const sourceC = commitFile('fork.txt', 'approved own change\n')
    git('tag', 'v1.4.198-kukapu.1', sourceC)
    const publicationP = bridge(sourceC, publishedF)
    expect(git('rev-parse', 'v1.4.198-kukapu.1^{commit}')).toBe(sourceC)
    expect(publicationP).not.toBe(sourceC)
    expect(git('ls-tree', '--name-only', 'HEAD')).not.toMatch(/feature-b|main-tip-extra/)

    const laterOwn = commitFile('later-own.txt', 'review and port me\n')
    expect(git('diff', '--name-only', publicationP, laterOwn)).toBe('later-own.txt')
    expect(git('log', '--format=%H', `${publicationP}..${laterOwn}`)).toBe(laterOwn)

    git('checkout', 'official')
    commitFile('release-199.txt', 'next stable release includes B\n')
    git('tag', 'v1.4.199')
    git('checkout', '-b', 'wrong-from-publication', publicationP)
    git('merge', '--no-ff', '-m', 'Wrong next source from P', 'v1.4.199')
    expect(git('ls-tree', '--name-only', 'HEAD')).not.toContain('feature-b.txt')
    git('merge-base', '--is-ancestor', featureB, 'HEAD')

    git('checkout', '-b', 'source-199', 'v1.4.198-kukapu.1')
    git('cherry-pick', laterOwn)
    git('merge', '--no-ff', '-m', 'Normal stable integration from C', 'v1.4.199')
    const nextC = git('rev-parse', 'HEAD')
    expect(readFileSync(join(repo, 'feature-b.txt'), 'utf8')).toContain('B was on main')
    expect(readFileSync(join(repo, 'later-own.txt'), 'utf8')).toBe('review and port me\n')
    expect(readFileSync(join(repo, 'fork.txt'), 'utf8')).toBe('approved own change\n')
    expect(git('ls-tree', '--name-only', 'HEAD')).not.toContain('main-tip-extra.txt')
    git('tag', 'v1.4.199-kukapu.1', nextC)
    bridge(nextC, laterOwn)
    expect(git('rev-parse', 'v1.4.199-kukapu.1^{commit}')).toBe(nextC)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
