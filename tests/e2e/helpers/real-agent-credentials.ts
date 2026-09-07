import { existsSync, readFileSync } from 'node:fs'

/**
 * Credentials for the real-agent smoke ride the runtime's own
 * `agentDefaultEnv` setting: values pass JSON file -> profile JSON -> PTY env
 * map. They are never interpolated into shell scripts, command lines, or logs.
 *
 * Positive allowlist only: no path, config, or execution-control variable can
 * pass, even ones a blacklist would miss (OPENCODE_CONFIG_CONTENT,
 * OPENCODE_CONFIG, PI_CODING_AGENT_DIR, ...). Extend solely with approved need.
 */
const ALLOWED_REAL_AGENT_ENV_KEYS: readonly string[] = [
  'ZAI_API_KEY',
  'ZHIPU_API_KEY',
  'XAI_API_KEY'
]

export function allowedRealAgentEnvKeys(): readonly string[] {
  return ALLOWED_REAL_AGENT_ENV_KEYS
}

export function isAllowedRealAgentEnvKey(key: string): boolean {
  return ALLOWED_REAL_AGENT_ENV_KEYS.includes(key)
}

export type RealAgentEnvKeyDiff = {
  extra: string[]
  mismatched: string[]
  missing: string[]
}

/** Compares applied vs expected credential env by KEY NAME only. Values never
 * enter the result, so assertion output, logs, traces, and reports cannot
 * carry secrets even when the comparison fails. */
export function diffRealAgentEnvKeys(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>
): RealAgentEnvKeyDiff {
  const actualKeys = Object.keys(actual ?? {})
  const expectedKeys = Object.keys(expected)
  return {
    extra: actualKeys.filter((key) => !expectedKeys.includes(key)),
    mismatched: expectedKeys.filter(
      (key) => actualKeys.includes(key) && actual?.[key] !== expected[key]
    ),
    missing: expectedKeys.filter((key) => !actualKeys.includes(key))
  }
}

export function assertRealAgentEnvApplied(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>
): void {
  const diff = diffRealAgentEnvKeys(actual, expected)
  if (diff.missing.length > 0 || diff.extra.length > 0 || diff.mismatched.length > 0) {
    throw new Error(`Credential env mismatch (keys only): ${JSON.stringify(diff)}`)
  }
}

/** Reads and validates the gate-provided env JSON. Values are preserved
 * literally (no trim, no normalization). Any parse failure becomes a generic
 * error: a SyntaxError message can echo file content, and file content here
 * may be a secret. */
export function readRealAgentEnvFile(envJsonPath: string): Record<string, string> {
  if (!existsSync(envJsonPath)) {
    throw new Error(`Real agent env file not found: ${envJsonPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(envJsonPath, 'utf8')) as unknown
  } catch {
    throw new Error('Real agent env file is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Real agent env file must contain a JSON object')
  }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!isAllowedRealAgentEnvKey(key)) {
      throw new Error(`Real agent env key is not allowed: ${key}`)
    }
    if (typeof value !== 'string') {
      throw new Error(`Real agent env value for ${key} must be a string`)
    }
    result[key] = value
  }
  return result
}
