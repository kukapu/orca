import type { TuiAgent } from './tui-agent'

/** Why: flags before `run` become opencode *global* flags and change the invoked
 *  command, so anchor command-override flags after the subcommand (#17551).
 *  Safe shapes only — anything the classifier cannot prove passes through
 *  verbatim:
 *  - a bare opencode binary may carry a pure flag tail (`opencode --auto`);
 *  - a wrapper (npx, node, …) must anchor a positional before its first flag
 *    (`npx -y opencode` would otherwise run a package named `run`);
 *  - the tail must be pure flags — a non-flag token is indistinguishable from
 *    a flag's value vs `run`'s message positional, and opencode accepts
 *    `--model`-style globals anyway, so verbatim stays correct;
 *  - a prefix carrying its own `run` or an option terminator never moves. */
export function orderOpenCodeRunFlags(
  agentId: TuiAgent,
  binary: string,
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
  const flagTail = flagStart === -1 ? [] : prefixArgs.slice(flagStart)
  if (flagTail.some((token) => !token.startsWith('-'))) {
    return [...prefixArgs, ...generatedArgs]
  }
  const bareBinary = isBareOpenCodeBinary(binary)
  if (!bareBinary && flagStart <= 0) {
    return [...prefixArgs, ...generatedArgs]
  }
  if (flagStart === -1) {
    return [...prefixArgs, ...generatedArgs]
  }
  return [
    ...prefixArgs.slice(0, flagStart),
    generatedArgs[0],
    ...flagTail,
    ...generatedArgs.slice(1)
  ]
}

function isBareOpenCodeBinary(binary: string): boolean {
  const normalized = binary.replaceAll('\\', '/').toLowerCase()
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return base === 'opencode' || base === 'opencode.cmd' || base === 'opencode.exe'
}
