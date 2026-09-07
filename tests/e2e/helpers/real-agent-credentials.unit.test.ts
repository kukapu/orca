import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allowedRealAgentEnvKeys,
  assertRealAgentEnvApplied,
  diffRealAgentEnvKeys,
  isAllowedRealAgentEnvKey,
  readRealAgentEnvFile
} from './real-agent-credentials'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('real agent smoke env allowlist', () => {
  it('exposes a minimal positive list of provider keys', () => {
    expect([...allowedRealAgentEnvKeys()]).toEqual(['ZAI_API_KEY', 'ZHIPU_API_KEY', 'XAI_API_KEY'])
    for (const allowed of allowedRealAgentEnvKeys()) {
      expect(isAllowedRealAgentEnvKey(allowed)).toBe(true)
    }
  })

  it('rejects config, path, and execution-control variables by name', () => {
    for (const forbidden of [
      'OPENCODE_CONFIG_CONTENT',
      'OPENCODE_CONFIG',
      'OPENCODE_CONFIG_DIR',
      'OPENCODE_API_KEY',
      'PI_CODING_AGENT_DIR',
      'PI_CODING_AGENT_SESSION_DIR',
      'HOME',
      'USERPROFILE',
      'PATH',
      'ORCA_TERMINAL_HANDLE',
      'ORCA_USER_DATA_PATH',
      'XDG_CONFIG_HOME',
      'LD_PRELOAD',
      'ELECTRON_RUN_AS_NODE',
      'NODE_OPTIONS',
      'GROK_API_KEY',
      'ZAI_API_TOKEN_2',
      'lowercase_key',
      'WITH-DASH',
      'SPA CE',
      ''
    ]) {
      expect(isAllowedRealAgentEnvKey(forbidden)).toBe(false)
    }
  })

  it('passes values with shell metacharacters through verbatim, un-interpolated', () => {
    const dir = tempDir('orca-real-agent-env-')
    const file = path.join(dir, 'env.json')
    const hostile = 'va$lue `backtick` $(cmd) "quote" sp ace'
    writeFileSync(file, `${JSON.stringify({ XAI_API_KEY: hostile })}\n`)
    expect(readRealAgentEnvFile(file)).toEqual({ XAI_API_KEY: hostile })
  })

  it('rejects forbidden keys, non-objects, and non-string values without echoing values', () => {
    const dir = tempDir('orca-real-agent-env-')
    const file = path.join(dir, 'env.json')
    writeFileSync(file, `${JSON.stringify({ OPENCODE_CONFIG_CONTENT: 's3cr3t' })}\n`)
    expect(() => readRealAgentEnvFile(file)).toThrow(/not allowed: OPENCODE_CONFIG_CONTENT/)
    writeFileSync(file, '[1,2]\n')
    expect(() => readRealAgentEnvFile(file)).toThrow(/JSON object/)
    writeFileSync(file, `${JSON.stringify({ XAI_API_KEY: 42 })}\n`)
    expect(() => readRealAgentEnvFile(file)).toThrow(/must be a string/)
    expect(() => readRealAgentEnvFile(path.join(dir, 'missing.json'))).toThrow(/not found/)
  })

  it('reports invalid JSON generically, never echoing file content', () => {
    const dir = tempDir('orca-real-agent-env-')
    const file = path.join(dir, 'env.json')
    const secret = 's3cr3t-not-valid-json{{{'
    writeFileSync(file, `{"XAI_API_KEY": "${secret}"\n`)
    let message = ''
    try {
      readRealAgentEnvFile(file)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe('Real agent env file is not valid JSON')
    expect(message).not.toContain('s3cr3t')
  })

  it('diffs credential env by key name only, never carrying values', () => {
    const secret = 's3cr3t-value'
    expect(diffRealAgentEnvKeys({ XAI_API_KEY: secret }, { XAI_API_KEY: secret })).toEqual({
      extra: [],
      mismatched: [],
      missing: []
    })
    expect(diffRealAgentEnvKeys({ XAI_API_KEY: 'other' }, { XAI_API_KEY: secret })).toEqual({
      extra: [],
      mismatched: ['XAI_API_KEY'],
      missing: []
    })
    expect(diffRealAgentEnvKeys({}, { XAI_API_KEY: secret })).toEqual({
      extra: [],
      mismatched: [],
      missing: ['XAI_API_KEY']
    })
    expect(diffRealAgentEnvKeys(undefined, { XAI_API_KEY: secret }).missing).toEqual([
      'XAI_API_KEY'
    ])
    expect(() =>
      assertRealAgentEnvApplied({ XAI_API_KEY: 'other' }, { XAI_API_KEY: secret })
    ).toThrow(/"mismatched":\["XAI_API_KEY"\]/)
    try {
      assertRealAgentEnvApplied({ XAI_API_KEY: 'other' }, { XAI_API_KEY: secret })
      expect.unreachable()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain(secret)
      expect(message).not.toContain('other')
    }
    expect(() =>
      assertRealAgentEnvApplied({ XAI_API_KEY: secret }, { XAI_API_KEY: secret })
    ).not.toThrow()
  })
})
