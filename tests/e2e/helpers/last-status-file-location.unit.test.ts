import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { locateLastStatusFile } from './last-status-file-location'
import { readLastStatusSessionOracle } from './real-pi-startup-hook-probe'

const tempDirs: string[] = []

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function createUserDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-last-status-'))
  tempDirs.push(dir)
  return dir
}

const SESSION_START_BODY = JSON.stringify({
  version: 2,
  entries: { pane: { providerSessionOnly: true, agentType: 'pi' } }
})

describe('locateLastStatusFile', () => {
  it('finds a flat agent-hooks last-status file', () => {
    const userDataDir = createUserDataDir()
    mkdirSync(path.join(userDataDir, 'agent-hooks'))
    writeFileSync(path.join(userDataDir, 'agent-hooks', 'last-status.json'), SESSION_START_BODY)
    expect(locateLastStatusFile(userDataDir).status).toBe('found')
    expect(readLastStatusSessionOracle(userDataDir)).toEqual({
      fileStatus: 'read',
      sessionStartObserved: true,
      providerSessionOnly: true,
      agent: 'pi'
    })
  })

  it('finds a single namespaced last-status file one level down', () => {
    const userDataDir = createUserDataDir()
    mkdirSync(path.join(userDataDir, 'agent-hooks', 'dev-instance'), { recursive: true })
    writeFileSync(
      path.join(userDataDir, 'agent-hooks', 'dev-instance', 'last-status.json'),
      SESSION_START_BODY
    )
    expect(locateLastStatusFile(userDataDir).status).toBe('found')
    expect(readLastStatusSessionOracle(userDataDir)).toEqual({
      fileStatus: 'read',
      sessionStartObserved: true,
      providerSessionOnly: true,
      agent: 'pi'
    })
  })

  it('rejects flat and namespaced files as ambiguous', () => {
    const userDataDir = createUserDataDir()
    mkdirSync(path.join(userDataDir, 'agent-hooks', 'dev-instance'), { recursive: true })
    writeFileSync(path.join(userDataDir, 'agent-hooks', 'last-status.json'), SESSION_START_BODY)
    writeFileSync(
      path.join(userDataDir, 'agent-hooks', 'dev-instance', 'last-status.json'),
      SESSION_START_BODY
    )
    expect(locateLastStatusFile(userDataDir).status).toBe('ambiguous')
    expect(readLastStatusSessionOracle(userDataDir)).toEqual({
      fileStatus: 'ambiguous',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: null
    })
  })

  it('rejects two namespace files as ambiguous', () => {
    const userDataDir = createUserDataDir()
    mkdirSync(path.join(userDataDir, 'agent-hooks', 'ns-a'), { recursive: true })
    mkdirSync(path.join(userDataDir, 'agent-hooks', 'ns-b'), { recursive: true })
    writeFileSync(
      path.join(userDataDir, 'agent-hooks', 'ns-a', 'last-status.json'),
      SESSION_START_BODY
    )
    writeFileSync(
      path.join(userDataDir, 'agent-hooks', 'ns-b', 'last-status.json'),
      SESSION_START_BODY
    )
    expect(locateLastStatusFile(userDataDir).status).toBe('ambiguous')
    expect(readLastStatusSessionOracle(userDataDir).fileStatus).toBe('ambiguous')
  })

  it('ignores a symlink that escapes the isolated userData tree', () => {
    const userDataDir = createUserDataDir()
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'orca-last-status-outside-'))
    tempDirs.push(outsideDir)
    writeFileSync(path.join(outsideDir, 'last-status.json'), SESSION_START_BODY)
    mkdirSync(path.join(userDataDir, 'agent-hooks'))
    symlinkSync(outsideDir, path.join(userDataDir, 'agent-hooks', 'escaped'))
    expect(locateLastStatusFile(userDataDir).status).toBe('missing')
    expect(readLastStatusSessionOracle(userDataDir).fileStatus).toBe('missing')
  })
})
