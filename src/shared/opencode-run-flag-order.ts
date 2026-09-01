import type { TuiAgent } from './tui-agent'

/** Why: flags before `run` become opencode *global* flags and change the invoked
 *  command, so anchor command-override flags after the subcommand (#17551).
 *  Only a bare opencode binary is reordered — an `npx opencode` prefix names
 *  the CLI itself and must stay in front — and a prefix carrying an option
 *  terminator is positional input, never moved. */
export function orderOpenCodeRunFlags(
  agentId: TuiAgent,
  binary: string,
  prefixArgs: string[],
  generatedArgs: string[]
): string[] {
  const isBareOpenCodeBinary =
    agentId === 'opencode' && /(?:^|[\\/])opencode(?:\.(?:cmd|exe))?$/i.test(binary)
  if (!isBareOpenCodeBinary || prefixArgs.includes('--')) {
    return [...prefixArgs, ...generatedArgs]
  }
  const runIndex = generatedArgs.indexOf('run')
  if (runIndex === -1) {
    return [...prefixArgs, ...generatedArgs]
  }
  return [
    ...generatedArgs.slice(0, runIndex + 1),
    ...prefixArgs,
    ...generatedArgs.slice(runIndex + 1)
  ]
}
