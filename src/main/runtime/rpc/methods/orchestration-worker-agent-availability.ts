import type { TuiAgent } from '../../../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { TuiAgentDetectionRuntime } from '../../../../shared/tui-agent-config'
import type { RemoteAgentDetection } from '../../../preflight/agent-detection'
import { OrchestrationError } from '../../orchestration/orchestration-error'

/**
 * Worker-start availability gate (#17943): an agent whose CLI is missing on
 * the execution host used to spawn a bare shell that swallowed the task prompt
 * and failed as `agent_prompt_stalled`. This module turns "the host answered
 * and does not have this agent" into a structured `agent_not_available` error
 * before any resource exists.
 *
 * Every path where the host cannot vouch fails OPEN (no fence): a user command
 * override is invisible to host inventory, detection can only speak for agents
 * without `detectUnsupportedRuntimes`, and an unreachable host or a failed
 * probe is absence of evidence, not evidence of absence
 * (docs/reference/wsl-probe-failure-semantics.md).
 */
export type WorkerAgentAvailabilityHost =
  | { kind: 'local' }
  | { kind: 'local-wsl'; wslDistro: string }
  | { kind: 'remote-ssh'; connectionId: string }

export type WorkerAgentAvailabilityDeps = {
  detectLocalAgents: (context?: { wslDistro?: string }) => Promise<string[]>
  detectRemoteAgentsStatus: (args: { connectionId: string }) => Promise<RemoteAgentDetection>
}

export function describeWorkerAgentAvailabilityHost(host: WorkerAgentAvailabilityHost): string {
  switch (host.kind) {
    case 'local':
      return 'the local execution host'
    case 'local-wsl':
      return `the WSL distro ${host.wslDistro}`
    case 'remote-ssh':
      return `the SSH host ${host.connectionId}`
  }
}

export async function assertWorkerAgentLaunchability(args: {
  agent: TuiAgent
  host: WorkerAgentAvailabilityHost
  deps: WorkerAgentAvailabilityDeps
  cmdOverride?: string
}): Promise<void> {
  const { agent, host, deps } = args
  // Why: the override replaces the agent's launch command wholesale, so host
  // inventory (which probes the agent's public binary) says nothing about it.
  if (args.cmdOverride) {
    return
  }
  // Why: agents with runtime-specific launch modes are only fenced where PATH
  // detection describes them (e.g. claude-agent-teams falls back to Claude's
  // in-process mode on win32/wsl, but is a real PATH launch on darwin/linux).
  // A remote host's runtime is unknown from here, so those agents fail open.
  const runtime = detectionRuntimeForHost(host)
  const unsupportedRuntimes = TUI_AGENT_CONFIG[agent].detectUnsupportedRuntimes
  if (unsupportedRuntimes?.length && (!runtime || unsupportedRuntimes.includes(runtime))) {
    return
  }
  const detected = await detectHostAgents(host, deps)
  if (!detected) {
    return
  }
  if (!detected.includes(agent)) {
    throw new OrchestrationError(
      'agent_not_available',
      `Agent ${agent} was not detected on ${describeWorkerAgentAvailabilityHost(host)}. Install it there, or start the worker with an agent that is installed.`,
      { agent, host }
    )
  }
}

type WorkerStartAgentFenceRuntime = {
  assertAgentLaunchableOnRepoHost: (agent: TuiAgent, repoSelector: string) => Promise<void>
  assertAgentLaunchableOnWorkspaceHost: (agent: TuiAgent, worktreeSelector: string) => Promise<void>
}

/**
 * Fence an explicit worker-start agent before its Dispatch exists (#17943),
 * against the execution host that will spawn it: new worktrees spawn from
 * the repo's host (which need not be the coordinator's), everything else
 * from the requested worktree's host. Explicit-terminal starts have no
 * agent fence — the terminal is already running something.
 */
export function fenceWorkerStartAgent(
  runtime: WorkerStartAgentFenceRuntime,
  agent: TuiAgent | undefined,
  params: { terminal?: unknown; repo?: unknown; worktree?: unknown },
  ctx: {
    createsWorktree: boolean
    creationWorktreeRepoId?: string
    coordinatorWorktreeId: string
  }
): Promise<void> {
  if (!agent || params.terminal) {
    return Promise.resolve()
  }
  const requestedWorktree = typeof params.worktree === 'string' ? params.worktree : 'current'
  const repoSelector =
    typeof params.repo === 'string' ? params.repo : `id:${ctx.creationWorktreeRepoId as string}`
  const workspaceSelector =
    requestedWorktree === 'current' ? `id:${ctx.coordinatorWorktreeId}` : requestedWorktree
  return ctx.createsWorktree
    ? runtime.assertAgentLaunchableOnRepoHost(agent, repoSelector)
    : runtime.assertAgentLaunchableOnWorkspaceHost(agent, workspaceSelector)
}

/** Returns null when the host could not answer — the caller must fail open. */
function detectionRuntimeForHost(
  host: WorkerAgentAvailabilityHost
): TuiAgentDetectionRuntime | null {
  if (host.kind === 'local-wsl') {
    return 'wsl'
  }
  if (host.kind === 'local') {
    return process.platform
  }
  return null
}

async function detectHostAgents(
  host: WorkerAgentAvailabilityHost,
  deps: WorkerAgentAvailabilityDeps
): Promise<string[] | null> {
  try {
    if (host.kind === 'remote-ssh') {
      const detection = await deps.detectRemoteAgentsStatus({ connectionId: host.connectionId })
      return detection.status === 'answered' ? detection.agents : null
    }
    return await deps.detectLocalAgents(
      host.kind === 'local-wsl' ? { wslDistro: host.wslDistro } : undefined
    )
  } catch {
    // Why: a failed probe is "could not run it", never "not installed".
    return null
  }
}
