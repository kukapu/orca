import type { AgentLaunchPreferences } from './agent-session-host-authority'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import type { TuiAgent } from './tui-agent'

export function normalizeAutomationLaunchField(value: string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function automationSupportsLaunchModel(agent: TuiAgent): boolean {
  return Boolean(getAgentSessionOptionCatalog(agent)?.supportsWorkerLaunchPreferences)
}

export function toAutomationLaunchPreferences(args: {
  agentId: TuiAgent
  model?: string | null
  effort?: string | null
}): AgentLaunchPreferences | undefined {
  if (!automationSupportsLaunchModel(args.agentId)) {
    return undefined
  }
  const model = normalizeAutomationLaunchField(args.model)
  if (!model) {
    return undefined
  }
  const effort = normalizeAutomationLaunchField(args.effort)
  return effort ? { model, effort } : { model }
}

export function toAutomationSessionOptions(
  preferences: AgentLaunchPreferences | undefined
): Record<string, string> | undefined {
  if (!preferences) {
    return undefined
  }
  const options = {
    ...(preferences.model ? { model: preferences.model } : {}),
    ...(preferences.effort ? { effort: preferences.effort } : {}),
    ...(preferences.mode ? { mode: preferences.mode } : {})
  }
  return Object.keys(options).length > 0 ? options : undefined
}
