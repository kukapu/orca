import { hasFlag } from './agent-cli-flag-detection'
import { removeAgentArgOption } from './agent-session-option-agent-args'
import type {
  AgentSessionOptionCatalog,
  CatalogModel,
  CatalogOption
} from './agent-session-option-catalog-types'

const PI_THINKING: CatalogOption = {
  id: 'effort',
  label: 'Thinking',
  category: 'thought_level',
  kind: {
    type: 'select',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra high' },
      { value: 'max', label: 'Max' }
    ],
    defaultValue: 'medium'
  },
  apply: {
    launchArgs: (value) => ['--thinking', String(value)],
    agentArgsOverride: (tokens) => hasFlag(tokens, ['--thinking']),
    removeAgentArgs: (tokens) => removeAgentArgOption(tokens, ['--thinking'])
  }
}

function parsePiModels(stdout: string): CatalogModel[] {
  const seen = new Set<string>()
  return stdout.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (
      !trimmed ||
      /^provider\s+model\b/i.test(trimmed) ||
      /^no models\b/i.test(trimmed) ||
      /^warning:/i.test(trimmed)
    ) {
      return []
    }
    const match = trimmed.match(/^([a-z0-9][a-z0-9._-]*)\s+([a-z0-9][a-z0-9._:-]*)(?:\s|$)/i)
    if (!match) {
      return []
    }
    const id = `${match[1]}/${match[2]}`
    if (seen.has(id)) {
      return []
    }
    seen.add(id)
    return [{ id, label: id, options: [] }]
  })
}

export const PI_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  // Why: Pi's TUI accepts `--model provider/id` and `--thinking` at launch, so
  // worker `--effort` maps to `--thinking` instead of being composed into the id.
  supportsWorkerLaunchPreferences: true,
  models: [],
  modelApply: {
    launchArgs: (value) => ['--model', String(value)],
    agentArgsOverride: (tokens) => hasFlag(tokens, ['--model']),
    removeAgentArgs: (tokens) => removeAgentArgOption(tokens, ['--model'])
  },
  unknownModelOptions: [PI_THINKING],
  listModels: { command: 'pi --list-models', parse: parsePiModels }
}
