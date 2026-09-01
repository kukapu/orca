import type { TuiAgent } from './tui-agent'

/** Why: flags before `run` become opencode *global* flags and change the invoked
 *  command, so anchor command-override flags after the subcommand (#17551).
 *  The rule is shape-based — a wrapper prefix like `npx opencode --auto`
 *  misparses the same way a bare binary does. A prefix carrying its own `run`
 *  or an option terminator is positional input, never moved. */
export function orderOpenCodeRunFlags(
  agentId: TuiAgent,
  _binary: string,
  prefixArgs: string[],
  generatedArgs: string[]
): string[] {
  if (agentId !== 'opencode' || generatedArgs[0] !== 'run') {
    return [...prefixArgs, ...generatedArgs]
  }
  if (prefixArgs.includes('run') || prefixArgs.includes('--')) {
    return [...prefixArgs, ...generatedArgs]
  }
  const flagStart = prefixArgs.findIndex((token) => token.startsWith('-'))
  if (flagStart === -1) {
    return [...prefixArgs, ...generatedArgs]
  }
  // The flag tail is a suffix: flags and their values move together, positionals stay.
  return [
    ...prefixArgs.slice(0, flagStart),
    generatedArgs[0],
    ...prefixArgs.slice(flagStart),
    ...generatedArgs.slice(1)
  ]
}
