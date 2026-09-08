import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess, spawnProcess } from '../../src/shared/child-process/run-process'

const script = resolve(import.meta.dirname, 'install-local-linux-release.sh')
const SOURCE = readFileSync(script, 'utf8')
const tempDirs = []
const holders = []

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeDecoy(dir, body = 'decoy-appimage-body\n') {
  const path = join(dir, 'orca-linux.AppImage')
  writeFileSync(path, body)
  return path
}

function writeFakeBin(
  dir,
  { tamperStage = false, failVersionMv = false, failVersionRestore = false } = {}
) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'file'),
    '#!/usr/bin/env bash\necho "ELF 64-bit LSB executable, x86-64"\n'
  )
  writeFileSync(
    join(bin, 'id'),
    '#!/usr/bin/env bash\n[[ "${1:-}" == -u ]] && { echo 0; exit 0; }\necho root\n'
  )
  writeFileSync(
    join(bin, 'install'),
    tamperStage
      ? `#!/usr/bin/env bash
set -euo pipefail
dest="\${@: -1}"
if [[ " $* " == *" -d "* ]]; then mkdir -p "$dest"; exit 0; fi
src="\${@: -2:1}"
cp "$src" "$dest"
if [[ "$dest" == *AppImage.stage* ]]; then printf 'tamper' >> "$dest"; fi
`
      : `#!/usr/bin/env bash
set -euo pipefail
dest="\${@: -1}"
if [[ " $* " == *" -d "* ]]; then mkdir -p "$dest"; exit 0; fi
src="\${@: -2:1}"
cp "$src" "$dest"
`
  )
  writeFileSync(join(bin, 'chown'), '#!/usr/bin/env bash\nexit 0\n')
  writeFileSync(
    join(bin, 'systemctl'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${join(dir, 'systemctl.log')}"
exit 0
`
  )
  writeFileSync(join(bin, 'ss'), '#!/usr/bin/env bash\necho "LISTEN 0 0 0.0.0.0:6768 0.0.0.0:*"\n')
  if (failVersionMv) {
    writeFileSync(
      join(bin, 'mv'),
      `#!/usr/bin/env bash
dest="\${@: -1}"
src="\${@: -2:1}"
if [[ "$dest" == */VERSION && "$src" == *VERSION.stage* ]]; then exit 1; fi
exec /bin/mv "$@"
`
    )
  }
  if (failVersionRestore) {
    writeFileSync(
      join(bin, 'cp'),
      `#!/usr/bin/env bash
dest="\${@: -1}"
if [[ "$dest" == */VERSION && " $* " == *" /backups/ "* || "$dest" == */VERSION && "$*" == *backups*VERSION* ]]; then
  exit 1
fi
exec /bin/cp "$@"
`
    )
  }
  writeFileSync(join(dir, 'systemctl.log'), '')
  for (const name of ['file', 'id', 'install', 'chown', 'systemctl', 'ss', 'mv', 'cp']) {
    const path = join(bin, name)
    try {
      chmodSync(path, 0o755)
    } catch {
      // optional mocks
    }
  }
  return bin
}

function fixtureScript(dir, { stubCgroup = false } = {}) {
  const destDir = join(dir, 'opt', 'orca')
  mkdirSync(join(destDir, 'backups'), { recursive: true })
  expect(SOURCE).toContain('DEST=/opt/orca/orca-linux.AppImage')
  expect(SOURCE).toContain('VER_DEST=/opt/orca/VERSION')
  expect(SOURCE).toContain('BACKUP_DIR=/opt/orca/backups')
  expect(SOURCE).toContain('LOCK=/opt/orca/install.lock')
  expect(SOURCE).not.toMatch(/--dest\b|ORCA_INSTALL_ROOT/)
  let text = SOURCE.replaceAll(
    '/opt/orca/orca-linux.AppImage',
    join(destDir, 'orca-linux.AppImage')
  )
    .replaceAll('/opt/orca/VERSION', join(destDir, 'VERSION'))
    .replaceAll('/opt/orca/backups', join(destDir, 'backups'))
    .replaceAll('/opt/orca/install.lock', join(destDir, 'install.lock'))
  expect(text).not.toContain('DEST=/opt/orca/orca-linux.AppImage')
  expect(text).not.toContain('VER_DEST=/opt/orca/VERSION')
  expect(text).not.toContain('BACKUP_DIR=/opt/orca/backups')
  expect(text).not.toContain('LOCK=/opt/orca/install.lock')
  expect(text).toContain(`DEST=${join(destDir, 'orca-linux.AppImage')}`)
  expect(text).toContain(`LOCK=${join(destDir, 'install.lock')}`)
  if (stubCgroup) {
    text = text.replace("grep -F -q 'orca-server.service'", 'false')
  }
  const path = join(dir, 'install-local-linux-release.sh')
  writeFileSync(path, text)
  chmodSync(path, 0o755)
  return { path, destDir, lock: join(destDir, 'install.lock') }
}

function applyEnv(bin, extra = {}) {
  return {
    PATH: `${bin}:${process.env.PATH}`,
    ORCA_PANE_KEY: '',
    ORCA_OPENCODE_CONFIG_DIR: '',
    ORCA_TERMINAL_HANDLE: '',
    ...extra
  }
}

async function invoke(target, args, env = {}) {
  return runProcess({
    program: 'bash',
    args: [target, ...args],
    env: { ...process.env, ...env },
    timeoutMs: 15_000
  })
}

async function invokeOriginal(args, env = {}) {
  if (args.includes('--apply')) {
    throw new Error('tests must not --apply the original installer')
  }
  return invoke(script, args, env)
}

function required(artifact, digest) {
  return ['--artifact', artifact, '--version', 'v1.4.197-kukapu.9', '--sha256', digest]
}

function seedDest(destDir) {
  writeFileSync(join(destDir, 'orca-linux.AppImage'), 'old-binary\n')
  writeFileSync(join(destDir, 'VERSION'), 'v1.4.197-kukapu.1')
}

function destUnchanged(destDir) {
  expect(readFileSync(join(destDir, 'orca-linux.AppImage'), 'utf8')).toBe('old-binary\n')
  expect(readFileSync(join(destDir, 'VERSION'), 'utf8')).toBe('v1.4.197-kukapu.1')
}

describe.skipIf(process.platform !== 'linux')('install-local-linux-release', () => {
  afterEach(() => {
    for (const child of holders.splice(0)) {
      child.kill('SIGTERM')
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes bash -n', async () => {
    const result = await runProcess({ program: 'bash', args: ['-n', script], timeoutMs: 5_000 })
    expect(result.code).toBe(0)
  })

  it('keeps production dest hardcoded with no public override', () => {
    expect(SOURCE).toContain('DEST=/opt/orca/orca-linux.AppImage')
    expect(SOURCE).toContain('LOCK=/opt/orca/install.lock')
    expect(SOURCE).toContain('ORCA_TERMINAL_HANDLE')
    expect(SOURCE).toContain('Restore incomplete')
    expect(SOURCE).not.toMatch(/--dest\b|ORCA_INSTALL_ROOT|--force\s*=/)
    expect(SOURCE).not.toMatch(/https?:\/\//)
    expect(SOURCE).not.toContain('journalctl')
    expect(SOURCE).not.toContain('pairing-address')
    expect(SOURCE).not.toContain('sleep 6')
  })

  it('prints help without a release hash', async () => {
    const result = await invokeOriginal(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('--confirm=INSTALL')
    expect(result.stdout).not.toMatch(/[0-9a-f]{64}/i)
  })

  it('names each missing argument', async () => {
    const none = await invokeOriginal(['--preflight'])
    expect(none.stderr).toContain('Missing --artifact PATH.')
    const noVersion = await invokeOriginal(['--artifact', '/tmp/nope', '--preflight'])
    expect(noVersion.stderr).toContain('Missing --version VER.')
  })

  it('rejects a non-semver version marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-ver-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const result = await invokeOriginal([
      '--artifact',
      artifact,
      '--version',
      '../etc/passwd',
      '--sha256',
      '0'.repeat(64),
      '--preflight'
    ])
    expect(result.stderr).toContain('VERSION must look like')
  })

  it('rejects a hash mismatch before dest is used', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-hash-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const result = await invokeOriginal([...required(artifact, '0'.repeat(64)), '--preflight'])
    expect(result.stderr).toContain('SHA-256 mismatch')
  })

  it('dry-run and preflight do not mutate or call systemctl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-dry-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const bin = writeFakeBin(dir)
    const digest = sha256Of(artifact)
    const env = { PATH: `${bin}:${process.env.PATH}` }
    const preflight = await invokeOriginal([...required(artifact, digest), '--preflight'], env)
    const dry = await invokeOriginal([...required(artifact, digest), '--dry-run'], env)
    expect(preflight.code).toBe(0)
    expect(dry.code).toBe(0)
    expect(dry.stdout).toContain('mode=dry-run (no mutation)')
    expect(dry.stdout).toContain('dest=/opt/orca/orca-linux.AppImage')
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8').length).toBe(0)
  })

  it('apply without confirm stays on the decoy dest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-noconfirm-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const bin = writeFakeBin(dir)
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(path, [...required(artifact, digest), '--apply'], applyEnv(bin))
    expect(result.stderr).toContain('--confirm=INSTALL')
    destUnchanged(destDir)
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })

  it('refuses apply when ORCA_TERMINAL_HANDLE is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-term-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const bin = writeFakeBin(dir)
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin, { ORCA_TERMINAL_HANDLE: 'term_fixture' })
    )
    expect(result.stderr).toContain('Orca environment')
    destUnchanged(destDir)
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })

  it('swaps only decoy dest files and re-hashes the stage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-swap-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir, 'staged-bytes-v9\n')
    const bin = writeFakeBin(dir)
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin)
    )
    expect(result.code, result.stderr).toBe(0)
    expect(readFileSync(join(destDir, 'orca-linux.AppImage'), 'utf8')).toBe('staged-bytes-v9\n')
    expect(readFileSync(join(destDir, 'VERSION'), 'utf8')).toBe('v1.4.197-kukapu.9')
    expect(SOURCE).toContain('DEST=/opt/orca/orca-linux.AppImage')
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).toContain('restart')
  })

  it('aborts when staged bytes no longer match the expected hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-tamper-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir, 'staged-bytes-v9\n')
    const bin = writeFakeBin(dir, { tamperStage: true })
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin)
    )
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('SHA-256 mismatch')
    destUnchanged(destDir)
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })

  it('restores both backups when the VERSION mv fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-mvfail-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir, 'staged-bytes-v9\n')
    const bin = writeFakeBin(dir, { failVersionMv: true })
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin)
    )
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('VERSION swap failed')
    destUnchanged(destDir)
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })

  it('does not claim a full restore when VERSION restore fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-restorefail-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir, 'staged-bytes-v9\n')
    const bin = writeFakeBin(dir, { failVersionMv: true, failVersionRestore: true })
    const digest = sha256Of(artifact)
    const { path, destDir } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin)
    )
    expect(result.stderr).toContain('Restore incomplete')
    expect(result.stderr).not.toContain('binary and VERSION restored from backups')
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })

  it('refuses apply while the dest lock is held', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-install-lock-'))
    tempDirs.push(dir)
    const artifact = writeDecoy(dir)
    const bin = writeFakeBin(dir)
    const digest = sha256Of(artifact)
    const { path, destDir, lock } = fixtureScript(dir, { stubCgroup: true })
    seedDest(destDir)
    const holder = spawnProcess({
      program: 'bash',
      args: ['-c', `exec 9>"${lock}"; flock 9; sleep 60`]
    })
    holders.push(holder)
    await runProcess({ program: 'bash', args: ['-c', 'sleep 0.2'], timeoutMs: 2_000 })
    const result = await invoke(
      path,
      [...required(artifact, digest), '--apply', '--confirm=INSTALL'],
      applyEnv(bin)
    )
    expect(result.stderr).toContain('Another installer holds')
    destUnchanged(destDir)
    expect(readFileSync(join(dir, 'systemctl.log'), 'utf8')).not.toContain('restart')
  })
})
