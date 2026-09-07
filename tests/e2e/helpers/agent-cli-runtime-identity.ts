import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildShellCommandFromArgv,
  resolveStartupShell
} from '../../../src/shared/tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from '../../../src/shared/windows-terminal-shell'
import type { HeadlessPairedRuntimeHost } from './headless-paired-runtime-host'

const PROBE_POLL_INTERVAL_MS = 500
const PROBE_RESULT_TIMEOUT_MS = 30_000
const CLI_STATUS_TIMEOUT_MS = 15_000

export type AgentCliProbeResultFile = {
  nonce: string
  probeError?: string
  exitCode?: number | null
  ok?: boolean
  state?: string | null
  reachable?: boolean
  connectionState?: string | null
  runtimeId?: string | null
  metaRuntimeId?: string | null
}

export type AgentCliRuntimeIdentityProbe = {
  probeTerminalHandle: string
  cliRuntimeId: string
  hostRuntimeId: string
}

/** Test pin mirroring FAKE_AGENT_WINDOWS_SHELL: specs own the Windows shell choice. */
export const AGENT_CLI_PROBE_WINDOWS_SHELL = 'powershell.exe'

/**
 * Builds the line typed into the host PTY to run the probe script. Uses the
 * test runner's own node binary (no PATH dependency) and the same shell-aware
 * quoting as agent startup lines, so paths with `$`, backticks or quotes stay
 * literal in sh/bash/zsh/fish, PowerShell and cmd alike.
 */
export function buildAgentCliProbeCommand(args: {
  nodeExecutablePath: string
  scriptPath: string
  platform?: NodeJS.Platform
  terminalWindowsShell?: string
}): string {
  const platform = args.platform ?? process.platform
  const shell = resolveStartupShell(
    platform,
    resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote: false,
      terminalWindowsShell: args.terminalWindowsShell ?? AGENT_CLI_PROBE_WINDOWS_SHELL
    })
  )
  return buildShellCommandFromArgv([args.nodeExecutablePath, args.scriptPath], shell)
}

/**
 * Builds the .mjs probe executed INSIDE the host PTY. It resolves `orca` the
 * way the terminal environment does, captures `orca status --json` through the
 * repo's runProcess wrapper (windowsHide, .cmd-shim safety), and writes ONLY
 * the whitelisted identity fields below plus a nonce to a private result file —
 * never env, keys, pairing URLs, or raw error text.
 */
export function buildAgentCliProbeScript(args: {
  runProcessModuleUrl: string
  resultPath: string
  nonce: string
}): string {
  return [
    `import { runProcess } from ${JSON.stringify(args.runProcessModuleUrl)}`,
    `import { writeFileSync } from 'node:fs'`,
    `const nonce = ${JSON.stringify(args.nonce)}`,
    `const resultPath = ${JSON.stringify(args.resultPath)}`,
    `const write = (payload) => writeFileSync(resultPath, JSON.stringify(payload) + '\\n', { mode: 0o600 })`,
    `try {`,
    `  const result = await runProcess({ program: 'orca', args: ['status', '--json'], timeoutMs: ${CLI_STATUS_TIMEOUT_MS} })`,
    `  let parsed = null`,
    `  try { parsed = JSON.parse(result.stdout) } catch { parsed = null }`,
    `  const runtime = parsed && typeof parsed === 'object' ? parsed.result?.runtime : null`,
    `  const meta = parsed && typeof parsed === 'object' ? parsed._meta : null`,
    `  write({`,
    `    nonce,`,
    `    exitCode: result.code,`,
    `    ok: parsed?.ok === true,`,
    `    state: typeof runtime?.state === 'string' ? runtime.state : null,`,
    `    reachable: runtime?.reachable === true,`,
    `    connectionState: typeof runtime?.connectionState === 'string' ? runtime.connectionState : null,`,
    `    runtimeId: typeof runtime?.runtimeId === 'string' ? runtime.runtimeId : null,`,
    `    metaRuntimeId: typeof meta?.runtimeId === 'string' ? meta.runtimeId : null`,
    `  })`,
    `} catch (error) {`,
    `  // Sanitized: message text may embed paths; keep only an errno/code token.`,
    `  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'spawn_failed'`,
    `  write({ nonce, probeError: code })`,
    `}`,
    ``
  ].join('\n')
}

function asProbeResultFile(raw: string, nonce: string): AgentCliProbeResultFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as AgentCliProbeResultFile
  if (record.nonce !== nonce) {
    return null
  }
  return record
}

/**
 * Validates the probe result against the explicit `orca status --json` contract
 * (`{ok:true,result:{runtime:{state,reachable,connectionState,runtimeId}},_meta:{runtimeId}}`)
 * and the isolated host's exact runtimeId. Returns a machine-readable reason on
 * every rejection path — no arbitrary JSON search, no text-includes matching.
 */
export function evaluateAgentCliProbeResult(
  result: AgentCliProbeResultFile,
  expectedRuntimeId: string
): { ok: true } | { ok: false; reason: string } {
  if (typeof result.probeError === 'string') {
    return { ok: false, reason: `probe-error:${result.probeError}` }
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: `cli-exit:${String(result.exitCode)}` }
  }
  if (result.ok !== true) {
    return { ok: false, reason: 'cli-not-ok' }
  }
  if (result.state !== 'ready') {
    return { ok: false, reason: `runtime-state:${String(result.state)}` }
  }
  if (result.reachable !== true) {
    return { ok: false, reason: 'runtime-not-reachable' }
  }
  if (result.connectionState !== 'connected') {
    return { ok: false, reason: `runtime-connection-state:${String(result.connectionState)}` }
  }
  if (typeof result.runtimeId !== 'string' || result.runtimeId.length === 0) {
    return { ok: false, reason: 'missing-runtime-id' }
  }
  if (result.runtimeId !== expectedRuntimeId) {
    return { ok: false, reason: 'runtime-id-mismatch' }
  }
  if (result.metaRuntimeId !== result.runtimeId) {
    return { ok: false, reason: 'meta-runtime-id-conflict' }
  }
  return { ok: true }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readHostRuntimeId(host: HeadlessPairedRuntimeHost): Promise<string> {
  const status = await host.client.call<{ runtimeId?: string }>('status.get', {})
  const runtimeId = status.result.runtimeId
  if (typeof runtimeId !== 'string' || runtimeId.length === 0) {
    throw new Error('Isolated host did not report a runtimeId over status.get')
  }
  return runtimeId
}

/**
 * Pre-LLM isolation precondition. Runs the probe script inside a terminal of
 * the same host environment the agent terminal will live in, then requires the
 * reported runtime identity to EXACTLY equal the isolated host's runtimeId
 * (exact UUID comparison). Aborts — before any agent or LLM spend — on timeout,
 * spawn failure, non-ready runtime, or identity mismatch. Terminal output is
 * never parsed (command echo cannot fake the result file's nonce).
 */
export async function assertAgentCliBoundToTestRuntime(
  host: HeadlessPairedRuntimeHost,
  args: {
    worktreeId: string
    /** Test-only hook: notified with the probe command and paths once sent. */
    onProbeCommandSent?: (
      probeCommand: string,
      resultPath: string,
      scriptPath: string
    ) => Promise<void>
    /** Test-only override for the result-file wait budget. */
    resultTimeoutMs?: number
  }
): Promise<AgentCliRuntimeIdentityProbe> {
  const hostRuntimeId = await readHostRuntimeId(host)
  const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'orca-agent-cli-identity-'))
  const nonce = randomUUID()
  const scriptPath = path.join(scratchDir, 'probe.mjs')
  const resultPath = path.join(scratchDir, 'probe-result.json')
  const runProcessModulePath = path.join(
    process.cwd(),
    'out',
    'shared',
    'child-process',
    'run-process.js'
  )
  writeFileSync(
    scriptPath,
    buildAgentCliProbeScript({
      runProcessModuleUrl: pathToFileURL(runProcessModulePath).href,
      resultPath,
      nonce
    }),
    { mode: 0o600 }
  )
  const probeCommand = buildAgentCliProbeCommand({
    nodeExecutablePath: process.execPath,
    scriptPath
  })
  let probeTerminalHandle = ''
  try {
    const probe = await host.client.call<{ terminal: { handle: string } }>('terminal.create', {
      worktree: `id:${args.worktreeId}`
    })
    probeTerminalHandle = probe.result.terminal.handle
    await host.client.call('terminal.send', {
      terminal: probeTerminalHandle,
      text: probeCommand,
      enter: true
    })
    await args.onProbeCommandSent?.(probeCommand, resultPath, scriptPath)
    const deadline = Date.now() + (args.resultTimeoutMs ?? PROBE_RESULT_TIMEOUT_MS)
    let verdict: { ok: true } | { ok: false; reason: string } | null = null
    let matchedResult: AgentCliProbeResultFile | null = null
    while (Date.now() < deadline) {
      let raw = ''
      try {
        raw = readFileSync(resultPath, 'utf8')
      } catch {
        raw = ''
      }
      const result = raw ? asProbeResultFile(raw, nonce) : null
      if (result) {
        matchedResult = result
        verdict = evaluateAgentCliProbeResult(result, hostRuntimeId)
        break
      }
      await sleep(PROBE_POLL_INTERVAL_MS)
    }
    if (!matchedResult) {
      throw new Error('Agent CLI identity probe timed out waiting for its result file')
    }
    if (verdict && !verdict.ok) {
      throw new Error(
        `Agent CLI runtime identity probe rejected: ${verdict.reason}; aborting before agent start`
      )
    }
    return {
      probeTerminalHandle,
      cliRuntimeId: matchedResult.runtimeId ?? '',
      hostRuntimeId
    }
  } finally {
    if (probeTerminalHandle) {
      await host.client
        .call('terminal.close', { terminal: probeTerminalHandle })
        .catch(() => undefined)
    }
    rmSync(scratchDir, { recursive: true, force: true })
  }
}
