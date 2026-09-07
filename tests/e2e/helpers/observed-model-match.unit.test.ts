import { describe, expect, it } from 'vitest'
import { observedModelMatchesRequested } from './observed-model-match'

describe('observed model exact match', () => {
  it('accepts the exact requested id per agent', () => {
    expect(observedModelMatchesRequested('opencode', 'xai/grok-4.6', 'xai/grok-4.6')).toBe(true)
    expect(
      observedModelMatchesRequested(
        'opencode',
        'zai-coding-plan/glm-5.3',
        'zai-coding-plan/glm-5.3'
      )
    ).toBe(true)
    expect(observedModelMatchesRequested('pi', 'zai/glm-5.3', 'zai/glm-5.3')).toBe(true)
    expect(observedModelMatchesRequested('opencode', 'xai/grok-4.6', '  xai/grok-4.6  ')).toBe(true)
  })

  it('rejects wrong providers, last-segment lookalikes, and absent evidence', () => {
    // Last-segment-only matching would accept these; exact matching must not.
    expect(observedModelMatchesRequested('opencode', 'xai/grok-4.6', 'other/grok-4.6')).toBe(false)
    expect(
      observedModelMatchesRequested('opencode', 'zai-coding-plan/glm-5.3', 'zai/glm-5.3')
    ).toBe(false)
    expect(observedModelMatchesRequested('opencode', 'xai/grok-4.6', 'XAI/GROK-4.6')).toBe(false)
    expect(observedModelMatchesRequested('opencode', 'xai/grok-4.6', 'xai/grok-4.6-extra')).toBe(
      false
    )
    expect(observedModelMatchesRequested('pi', 'zai/glm-5.3', undefined)).toBe(false)
    expect(observedModelMatchesRequested('pi', 'zai/glm-5.3', '')).toBe(false)
  })
})
