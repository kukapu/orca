import { RuntimeClientError } from '../runtime-client'

export function getOptionalLaunchFieldFlag(
  flags: Map<string, string | boolean>,
  name: string
): string | null | undefined {
  if (!flags.has(name)) {
    return undefined
  }
  const value = flags.get(name)
  if (typeof value !== 'string') {
    throw new RuntimeClientError('invalid_argument', `--${name} requires a value`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getAutomationLaunchPreferenceFlags(flags: Map<string, string | boolean>): {
  model?: string | null
  effort?: string | null
} {
  const model = getOptionalLaunchFieldFlag(flags, 'model')
  const effort = getOptionalLaunchFieldFlag(flags, 'effort')
  if (effort && !model) {
    throw new RuntimeClientError('invalid_argument', '--effort requires --model')
  }
  return {
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {})
  }
}
