import { AGENT_RUNTIME_DIR_ENV_KEYS } from './agent-runtime-dir-env-keys'

/**
 * Last isolation precondition before real-agent credentials (Gate B). The
 * electron-home isolation redirects HOME, but ambient XDG/OpenCode/Pi
 * overrides survive it: an inherited XDG_DATA_HOME or OPENCODE_CONFIG would
 * point the real agent CLI at the developer's live sessions and config. The
 * real smoke refuses to start while any of these carry a non-empty value in
 * the TEST process env. Names only — values are never reported or logged.
 */
const FORBIDDEN_REAL_AGENT_AMBIENT_ENV_KEYS: readonly string[] = [
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  ...AGENT_RUNTIME_DIR_ENV_KEYS,
  'PI_SOURCE_AGENT_DIR',
  'PI_SESSION'
]

export function forbiddenRealAgentAmbientEnvKeys(): readonly string[] {
  return FORBIDDEN_REAL_AGENT_AMBIENT_ENV_KEYS
}

/** Returns the NAMES of forbidden ambient variables with a non-empty value;
 *  empty-string entries are treated as absent. Values never leave this call. */
export function findDirtyRealAgentAmbientEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  return FORBIDDEN_REAL_AGENT_AMBIENT_ENV_KEYS.filter((key) => {
    const value = env[key]
    return typeof value === 'string' && value.length > 0
  })
}

export function assertCleanRealAgentAmbientEnv(
  env: Record<string, string | undefined> = process.env
): void {
  const dirty = findDirtyRealAgentAmbientEnv(env)
  if (dirty.length > 0) {
    throw new Error(
      `Real agent smoke aborted: ambient env isolation variables are set (names only): ${dirty.join(', ')}`
    )
  }
}
