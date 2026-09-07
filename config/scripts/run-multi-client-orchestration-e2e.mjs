#!/usr/bin/env node
/**
 * Node-direct runner for the bloque4 RPC lifecycle spec. No pnpm.
 * Do not run until the coordinator opens the e2e-mode build gate.
 * xvfb-run --auto-servernum is decided at that gate; this refuses DISPLAY=:99
 * and refuses an out/ build older than the newest runtime source change.
 * No staleness bypass exists on purpose: testing a stale bundle knowingly is
 * not validation. Child processes go through the compiled house wrapper
 * (windowsHide, .cmd encoding, no shell), imported only after the freshness
 * guard proves the build it comes from is current.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', '.git'])

if (process.env.DISPLAY === ':99') {
  process.stderr.write(
    '[multi-client-orchestration-e2e] refusing production Xvfb DISPLAY=:99; wrap with xvfb-run --auto-servernum\n'
  )
  process.exit(2)
}

const sourceReadErrors = []

function newestMtime(directory, extensions) {
  let newest = 0
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    sourceReadErrors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    return 0
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue
      }
      newest = Math.max(newest, newestMtime(full, extensions))
    } else if (
      extensions.some((extension) => entry.name.endsWith(extension)) &&
      !/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.includes('.bench.') &&
      !/[\\/]__fixtures__[\\/]/.test(full)
    ) {
      try {
        newest = Math.max(newest, statSync(full).mtimeMs)
      } catch (error) {
        sourceReadErrors.push(`${full}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return newest
}

const outMain = path.join(repoRoot, 'out', 'main', 'index.js')
const outCli = path.join(repoRoot, 'out', 'cli', 'index.js')
if (!existsSync(outMain) || !existsSync(outCli)) {
  process.stderr.write(
    '[multi-client-orchestration-e2e] missing out/ build; the coordinator gate builds out/main and out/cli first\n'
  )
  process.exit(2)
}
// The fake worker CLI calls run from out/cli and the serve host from
// out/main: both bundles must postdate the newest runtime source.
const newestSource = Math.max(
  newestMtime(path.join(repoRoot, 'src', 'main'), ['.ts', '.tsx']),
  newestMtime(path.join(repoRoot, 'src', 'shared'), ['.ts', '.tsx']),
  newestMtime(path.join(repoRoot, 'src', 'cli'), ['.ts', '.tsx'])
)
if (sourceReadErrors.length > 0) {
  process.stderr.write(
    `[multi-client-orchestration-e2e] cannot prove freshness, failing closed:\n${sourceReadErrors.join('\n')}\n`
  )
  process.exit(2)
}
const outMainMtime = statSync(outMain).mtimeMs
const outCliMtime = statSync(outCli).mtimeMs
const staleBundle = newestSource > outMainMtime || newestSource > outCliMtime
if (staleBundle) {
  process.stderr.write(
    '[multi-client-orchestration-e2e] out/ predates newer src changes; rebuild via the coordinator gate (no bypass available)\n'
  )
  process.exit(2)
}

const compiledWrapper = path.join(repoRoot, 'out', 'shared', 'child-process', 'run-process.js')
let runProcessSync
try {
  ;({ runProcessSync } = await import(pathToFileURL(compiledWrapper).href))
} catch (error) {
  process.stderr.write(
    `[multi-client-orchestration-e2e] compiled child-process wrapper not importable: ${compiledWrapper}: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(2)
}
if (typeof runProcessSync !== 'function') {
  process.stderr.write(
    `[multi-client-orchestration-e2e] compiled wrapper exports no runProcessSync: ${compiledWrapper}\n`
  )
  process.exit(2)
}

let revision = 'unknown'
try {
  revision = runProcessSync({
    program: 'git',
    args: ['rev-parse', '--short', 'HEAD'],
    cwd: repoRoot,
    timeoutMs: 30_000
  }).stdout.trim()
} catch {
  // Revision is evidence labelling only; the freshness gate above already ran.
}
process.stderr.write(
  `[multi-client-orchestration-e2e] revision=${revision} out/main built ${new Date(outMainMtime).toISOString()} out/cli built ${new Date(outCliMtime).toISOString()}\n`
)

const extraArgs = process.argv.slice(2)
const result = runProcessSync({
  program: process.execPath,
  args: [
    'node_modules/@playwright/test/cli.js',
    'test',
    'tests/e2e/multi-client-orchestration-lifecycle.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--workers=1',
    ...extraArgs
  ],
  cwd: repoRoot,
  env: {
    ...process.env,
    ORCA_BACKGROUND_LAUNCH: '1',
    SKIP_BUILD: process.env.SKIP_BUILD ?? '1',
    TMPDIR: process.env.TMPDIR ?? os.tmpdir()
  },
  stdio: 'inherit',
  timeoutMs: null
})

process.exit(result.code ?? 1)
