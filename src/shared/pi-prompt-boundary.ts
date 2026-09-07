import { tokenizeStartupCommand, type AgentStartupShell } from './tui-agent-startup-shell'
import { getCommandTokenPathBasename } from './command-token-scanner'

// Pi 0.85 consumes the next argv for these flags, even when that value is `--`.
const PI_VALUE_FLAGS = new Set(
  (
    `--mode --provider --model --api-key --system-prompt --append-system-prompt --name -n ` +
    `--session --session-id --fork --session-dir --models --tools -t --exclude-tools -xt ` +
    `--thinking --export --extension -e --skill --prompt-template --theme`
  ).split(' ')
)
// Optional-value flags in this set do not consume a following `--` in Pi 0.85.
const PI_NON_VALUE_FLAGS = new Set(
  (
    `--help -h --version -v --continue -c --resume -r --no-session --no-tools -nt ` +
    `--no-builtin-tools -nbt --print -p --no-extensions -ne --no-skills -ns ` +
    `--no-prompt-templates -np --no-themes --no-context-files -nc --list-models ` +
    `--tui-mode --use-theme --verbose --approve -a --no-approve -na --offline`
  ).split(' ')
)

export type PiPromptBoundary = { terminated: boolean; separatorValue: boolean }

export function getPiPromptBoundary({
  command,
  shell,
  launchArgs,
  configuredArgs,
  overridesSessionOptions
}: {
  command: string
  shell: AgentStartupShell
  launchArgs: readonly string[]
  configuredArgs: readonly string[]
  overridesSessionOptions: boolean
}): PiPromptBoundary | null {
  const parsed = tokenizeStartupCommand(command, shell)
  if (!parsed.ok) {
    return null
  }
  const { tokens, spans } = parsed
  if (![...tokens, ...launchArgs, ...configuredArgs].includes('--')) {
    return { terminated: false, separatorValue: false }
  }
  const callOperator = shell === 'powershell' && tokens[0] === '&'
  let executable = callOperator ? 1 : 0
  if (shell === 'posix') {
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[executable] ?? '')) {
      executable += 1
    }
    if (getCommandTokenPathBasename(tokens[executable] ?? '') === 'env') {
      executable += 1
    }
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[executable] ?? '')) {
      executable += 1
    }
  }
  if (
    !/^pi(?:\.(?:exe|cmd|bat|ps1))?$/i.test(getCommandTokenPathBasename(tokens[executable] ?? ''))
  ) {
    return null
  }
  if (
    spans.some(
      (span, index) =>
        (span.divergesFromShell && !(callOperator && index === 0)) ||
        !/^[ \t]*$/.test(command.slice(index === 0 ? 0 : spans[index - 1].end, span.start))
    )
  ) {
    return null
  }
  const commandArgs = tokens.slice(executable + 1)
  const commandBoundary = scanPiPromptArgs(commandArgs)
  if (!commandBoundary || (commandBoundary.terminated && launchArgs.length > 0)) {
    return null
  }
  // The shared picker inserter uses the first `--`, including flag values.
  if (
    overridesSessionOptions &&
    scanPiPromptArgs([...commandArgs, ...configuredArgs])?.separatorValue !== false
  ) {
    return null
  }
  return scanPiPromptArgs([...commandArgs, ...launchArgs])
}

function scanPiPromptArgs(tokens: readonly string[]): PiPromptBoundary | null {
  let separatorValue = false
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') {
      return { terminated: true, separatorValue }
    }
    if (PI_VALUE_FLAGS.has(token)) {
      index += 1
      separatorValue ||= tokens[index] === '--'
    } else if (
      token.startsWith('-') &&
      !token.includes('=') &&
      !PI_NON_VALUE_FLAGS.has(token) &&
      tokens[index + 1] === '--'
    ) {
      // An extension may own this value; refusing is safer than changing its argv.
      return null
    }
  }
  return { terminated: false, separatorValue }
}
