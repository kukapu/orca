import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcessSync } from '../../../src/shared/child-process/run-process'
import { AGENT_RUNTIME_DIR_ENV_KEYS } from './agent-runtime-dir-env-keys'
import {
  areSameHomePath,
  assertElectronResolvedIsolatedHome,
  createElectronHomeIsolation
} from './electron-home-isolation'

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function createUserDataDir(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'orca-home-isolation-test-'))
  tempDirs.push(tempDir)
  return tempDir
}

describe('createElectronHomeIsolation', () => {
  it('strips ambient home and Codex state before forcing a disposable home', () => {
    const userDataDir = createUserDataDir()
    const isolation = createElectronHomeIsolation({
      inheritedEnv: {
        HOME: '/real/home',
        USERPROFILE: '/real/home',
        CODEX_HOME: '/real/codex',
        ORCA_CODEX_HOME: '/real/orca-codex',
        ZDOTDIR: '/real/zdotdir',
        PATH: '/bin'
      },
      launchEnv: { TEST_TOKEN: 'safe' },
      extraEnv: { EXTRA_TEST_FLAG: '1' },
      userDataDir,
      realHome: '/real/home'
    })

    // Why: the disposable home must be the canonical spelling (no tmpdir
    // symlink/8.3 alias) or git-canonicalized worktree paths stop matching.
    const canonicalHome = realpathSync.native(path.join(userDataDir, 'home'))
    expect(isolation.isolatedHome).toBe(canonicalHome)
    expect(isolation.env).toMatchObject({
      PATH: '/bin',
      TEST_TOKEN: 'safe',
      EXTRA_TEST_FLAG: '1',
      HOME: canonicalHome,
      USERPROFILE: canonicalHome,
      ORCA_E2E_USER_DATA_DIR: userDataDir
    })
    expect(isolation.env.CODEX_HOME).toBeUndefined()
    expect(isolation.env.ORCA_CODEX_HOME).toBeUndefined()
    expect(isolation.env.ZDOTDIR).toBeUndefined()
    // Codex always routes to the resolved home, so the post-launch guard must
    // accept the boundary this env produces.
    expect(() =>
      assertElectronResolvedIsolatedHome(isolation.isolatedHome, isolation)
    ).not.toThrow()
  })

  it('rejects generic fixture overlays that could escape the boundary', () => {
    expect(() =>
      createElectronHomeIsolation({
        inheritedEnv: {},
        launchEnv: { CODEX_HOME: '/unsafe' },
        extraEnv: {},
        userDataDir: createUserDataDir(),
        realHome: '/real/home'
      })
    ).toThrow(/launchEnv\.CODEX_HOME/)

    expect(() =>
      createElectronHomeIsolation({
        inheritedEnv: {},
        launchEnv: {},
        extraEnv: { ORCA_E2E_USER_DATA_DIR: '/unsafe' },
        userDataDir: createUserDataDir(),
        realHome: '/real/home'
      })
    ).toThrow(/orcaAppExtraEnv\.ORCA_E2E_USER_DATA_DIR/)
  })

  it('compares Windows home paths case-insensitively', () => {
    expect(areSameHomePath('C:\\Users\\Alice', 'c:\\users\\alice', 'win32')).toBe(true)
  })

  it('strips inherited agent source/overlay dirs instead of remapping them', () => {
    const userDataDir = createUserDataDir()
    const decoyDir = mkdtempSync(path.join(os.tmpdir(), 'orca-agent-dir-decoy-'))
    tempDirs.push(decoyDir)
    const inheritedEnv: NodeJS.ProcessEnv = {
      HOME: '/real/home',
      PATH: '/bin'
    }
    for (const key of AGENT_RUNTIME_DIR_ENV_KEYS) {
      inheritedEnv[key] = decoyDir
    }

    const isolation = createElectronHomeIsolation({
      inheritedEnv,
      launchEnv: {},
      extraEnv: {},
      userDataDir,
      realHome: '/real/home'
    })

    for (const key of AGENT_RUNTIME_DIR_ENV_KEYS) {
      expect(isolation.env[key]).toBeUndefined()
    }
    expect(isolation.env.HOME).toBe(isolation.isolatedHome)
    expect(isolation.env.HOME).not.toBe(decoyDir)
  })

  it('rejects launch overlays that reintroduce agent source dirs', () => {
    expect(() =>
      createElectronHomeIsolation({
        inheritedEnv: {},
        launchEnv: { ORCA_PI_SOURCE_AGENT_DIR: '/decoy/pi-source' },
        extraEnv: {},
        userDataDir: createUserDataDir(),
        realHome: '/real/home'
      })
    ).toThrow(/launchEnv\.ORCA_PI_SOURCE_AGENT_DIR/)

    expect(() =>
      createElectronHomeIsolation({
        inheritedEnv: {},
        launchEnv: {},
        extraEnv: { ORCA_OPENCODE_CONFIG_DIR: '/decoy/opencode' },
        userDataDir: createUserDataDir(),
        realHome: '/real/home'
      })
    ).toThrow(/orcaAppExtraEnv\.ORCA_OPENCODE_CONFIG_DIR/)
  })

  it('child inherits isolated HOME without mutating an inherited source decoy', () => {
    const userDataDir = createUserDataDir()
    const decoyDir = mkdtempSync(path.join(os.tmpdir(), 'orca-agent-dir-decoy-'))
    tempDirs.push(decoyDir)
    const sentinelPath = path.join(decoyDir, 'sentinel.txt')
    const sentinelBody = 'untouched-decoy\n'
    writeFileSync(sentinelPath, sentinelBody)
    const reportPath = path.join(userDataDir, 'child-env-report.json')
    const childScriptPath = path.join(userDataDir, 'child-env-probe.cjs')
    writeFileSync(
      childScriptPath,
      [
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const decoy = process.argv[2]',
        'const report = process.argv[3]',
        'const isolatedHome = process.argv[4]',
        'if (process.env.ORCA_PI_SOURCE_AGENT_DIR || process.env.ORCA_OPENCODE_CONFIG_DIR) {',
        '  fs.writeFileSync(path.join(decoy, "LEAKED"), "1")',
        '}',
        'fs.writeFileSync(report, JSON.stringify({',
        '  homeMatchesIsolated: process.env.HOME === isolatedHome,',
        '  sourcePresent: Boolean(process.env.ORCA_PI_SOURCE_AGENT_DIR),',
        '  overlayPresent: Boolean(process.env.ORCA_OPENCODE_CONFIG_DIR)',
        '}))'
      ].join('\n')
    )

    const isolation = createElectronHomeIsolation({
      inheritedEnv: {
        HOME: '/real/home',
        PATH: process.env.PATH,
        ORCA_PI_SOURCE_AGENT_DIR: decoyDir,
        ORCA_OPENCODE_CONFIG_DIR: decoyDir
      },
      launchEnv: {},
      extraEnv: {},
      userDataDir,
      realHome: '/real/home'
    })

    const childEnv: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(isolation.env)) {
      if (value !== undefined) {
        childEnv[key] = value
      }
    }

    const result = runProcessSync({
      program: process.execPath,
      args: [childScriptPath, decoyDir, reportPath, isolation.isolatedHome],
      env: childEnv,
      timeoutMs: 10_000
    })

    expect(result.code).toBe(0)
    expect(existsSync(path.join(decoyDir, 'LEAKED'))).toBe(false)
    expect(readFileSync(sentinelPath, 'utf8')).toBe(sentinelBody)
    expect(readdirSync(decoyDir)).toEqual(['sentinel.txt'])
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({
      homeMatchesIsolated: true,
      sourcePresent: false,
      overlayPresent: false
    })
  })
})
