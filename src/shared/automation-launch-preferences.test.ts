import { describe, expect, it } from 'vitest'
import {
  automationSupportsLaunchModel,
  normalizeAutomationLaunchField,
  toAutomationLaunchPreferences
} from './automation-launch-preferences'

describe('automation launch preferences', () => {
  it('treats blank model strings as unset', () => {
    expect(normalizeAutomationLaunchField('  ')).toBeNull()
    expect(normalizeAutomationLaunchField(null)).toBeNull()
    expect(normalizeAutomationLaunchField('opus')).toBe('opus')
  })

  it('pins a model for agents that accept launch-time selection', () => {
    expect(automationSupportsLaunchModel('opencode')).toBe(true)
    expect(
      toAutomationLaunchPreferences({
        agentId: 'opencode',
        model: 'zai-coding-plan/glm-5.3'
      })
    ).toEqual({ model: 'zai-coding-plan/glm-5.3' })
  })

  it('ignores a pin when the agent cannot apply launch-time model flags', () => {
    expect(
      toAutomationLaunchPreferences({
        agentId: 'hermes',
        model: 'ignored'
      })
    ).toBeUndefined()
  })

  it('drops effort when no model is pinned', () => {
    expect(
      toAutomationLaunchPreferences({
        agentId: 'claude',
        effort: 'high'
      })
    ).toBeUndefined()
  })
})
