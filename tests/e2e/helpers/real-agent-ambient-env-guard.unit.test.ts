import { describe, expect, it } from 'vitest'
import {
  assertCleanRealAgentAmbientEnv,
  forbiddenRealAgentAmbientEnvKeys,
  findDirtyRealAgentAmbientEnv
} from './real-agent-ambient-env-guard'

describe('findDirtyRealAgentAmbientEnv', () => {
  it('accepts a clean environment and empty-string values', () => {
    expect(findDirtyRealAgentAmbientEnv({})).toEqual([])
    expect(
      findDirtyRealAgentAmbientEnv({
        XDG_CONFIG_HOME: '',
        OPENCODE_CONFIG: '',
        PI_SESSION: ''
      })
    ).toEqual([])
    expect(() => assertCleanRealAgentAmbientEnv({ HOME: '/isolated/home' })).not.toThrow()
  })

  it('reports NAMES only for every forbidden variable with a value', () => {
    const dirty = findDirtyRealAgentAmbientEnv({
      XDG_DATA_HOME: '/home/dev/.local/share',
      OPENCODE_CONFIG: '/home/dev/.config/opencode/opencode.json',
      OPENCODE_CONFIG_CONTENT: '{"model":"x"}',
      PI_CODING_AGENT_DIR: '/home/dev/.pi'
    })
    expect(dirty).toContain('XDG_DATA_HOME')
    expect(dirty).toContain('OPENCODE_CONFIG')
    expect(dirty).toContain('OPENCODE_CONFIG_CONTENT')
    expect(dirty).toContain('PI_CODING_AGENT_DIR')
    // No value ever leaks into the result.
    expect(JSON.stringify(dirty)).not.toContain('/home/dev')
  })

  it('covers the full guard list (XDG homes + OpenCode/Pi overrides)', () => {
    expect(forbiddenRealAgentAmbientEnvKeys()).toEqual([
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME',
      'ORCA_PI_SOURCE_AGENT_DIR',
      'ORCA_PI_CODING_AGENT_DIR',
      'PI_CODING_AGENT_DIR',
      'ORCA_OMP_SOURCE_AGENT_DIR',
      'ORCA_OMP_CODING_AGENT_DIR',
      'ORCA_OMP_STATUS_EXTENSION',
      'ORCA_PRIME_AGENT_SOURCE_AGENT_DIR',
      'ORCA_PRIME_AGENT_STATUS_EXTENSION',
      'PRIME_AGENT_CODING_AGENT_DIR',
      'ORCA_OPENCODE_SOURCE_CONFIG_DIR',
      'ORCA_OPENCODE_CONFIG_DIR',
      'OPENCODE_CONFIG',
      'OPENCODE_CONFIG_DIR',
      'OPENCODE_CONFIG_CONTENT',
      'OPENCODE_SOURCE_CONFIG_DIR',
      'ORCA_MIMOCODE_SOURCE_HOME',
      'ORCA_MIMOCODE_HOME',
      'MIMOCODE_HOME',
      'PI_SOURCE_AGENT_DIR',
      'PI_SESSION'
    ])
    for (const key of forbiddenRealAgentAmbientEnvKeys()) {
      expect(findDirtyRealAgentAmbientEnv({ [key]: 'set' })).toEqual([key])
    }
  })
})

describe('assertCleanRealAgentAmbientEnv', () => {
  it('aborts with variable names only, never values', () => {
    let message = ''
    try {
      assertCleanRealAgentAmbientEnv({ XDG_STATE_HOME: '/real/state', PI_SESSION: 'sess-1' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('XDG_STATE_HOME')
    expect(message).toContain('PI_SESSION')
    expect(message).not.toContain('/real/state')
    expect(message).not.toContain('sess-1')
  })
})
