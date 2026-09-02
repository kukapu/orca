import type { TuiAgent } from '../../shared/tui-agent'
import type { Repo } from '../../shared/repo-types'
import { getWorktreeMirrorDistro } from '../project-runtime-git-options'
import {
  detectInstalledAgentsWithShellPathHydration,
  detectRemoteAgentsStatus
} from '../preflight/agent-detection'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import {
  assertWorkerAgentLaunchability,
  type WorkerAgentAvailabilityDeps,
  type WorkerAgentAvailabilityHost
} from './rpc/methods/orchestration-worker-agent-availability'

const WORKER_AGENT_AVAILABILITY_DEPS: WorkerAgentAvailabilityDeps = {
  detectLocalAgents: (context) => detectInstalledAgentsWithShellPathHydration(context),
  detectRemoteAgentsStatus
}

export class OrcaRuntimeWithWorkerAgentAvailability extends OrcaRuntimeWithResolveWaiter {
  /**
   * Fence an explicit worker-start agent against the execution host that will
   * spawn it (#17943): local, a WSL distro, or an SSH connection. Throws
   * `agent_not_available` only when that host answered and lacks the agent;
   * every unverifiable path fails open inside the availability module.
   */
  async assertAgentLaunchableOnWorkspaceHost(
    agent: TuiAgent,
    worktreeSelector: string
  ): Promise<void> {
    if (!this.store) {
      // Why fail open: a settings-less runtime cannot scope overrides or the
      // host. Production worker-start always has a store — the launch path
      // itself throws runtime_unavailable otherwise — so this only relaxes
      // store-less harnesses, never a real spawn.
      return
    }
    // Why fail open: a selector the scope resolver cannot answer is the
    // terminal-create path's error to raise; the fence must never introduce a
    // failure mode the start would not otherwise have.
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(worktreeSelector).catch(
      () => null
    )
    if (!workspace) {
      return
    }
    const connectionId = workspace.connectionId ?? workspace.repo?.connectionId ?? null
    const host: WorkerAgentAvailabilityHost = connectionId
      ? { kind: 'remote-ssh', connectionId }
      : workspace.repo
        ? this.resolveWorkerAgentAvailabilityHostFromRepo(workspace.repo)
        : { kind: 'local' }
    await this.assertAgentLaunchableOnHost(agent, host)
  }

  /** Same fence for a repo selector: federation creates worktrees from a repo before any worktree id exists. */
  async assertAgentLaunchableOnRepoHost(agent: TuiAgent, repoSelector: string): Promise<void> {
    if (!this.store) {
      return
    }
    const repo = await this.resolveRepoSelectorForConnection(repoSelector).catch(() => null)
    if (!repo) {
      return
    }
    await this.assertAgentLaunchableOnHost(
      agent,
      this.resolveWorkerAgentAvailabilityHostFromRepo(repo)
    )
  }

  private async assertAgentLaunchableOnHost(
    agent: TuiAgent,
    host: WorkerAgentAvailabilityHost
  ): Promise<void> {
    const cmdOverride = this.getWorkerAgentCmdOverride(agent)
    await assertWorkerAgentLaunchability({
      agent,
      host,
      ...(cmdOverride ? { cmdOverride } : {}),
      deps: WORKER_AGENT_AVAILABILITY_DEPS
    })
  }

  private getWorkerAgentCmdOverride(agent: TuiAgent): string | undefined {
    const override = this.store?.getSettings().agentCmdOverrides?.[agent]?.trim()
    return override ? override : undefined
  }

  private resolveWorkerAgentAvailabilityHostFromRepo(repo: Repo): WorkerAgentAvailabilityHost {
    if (repo.connectionId) {
      return { kind: 'remote-ssh', connectionId: repo.connectionId }
    }
    const wslDistro = this.store ? getWorktreeMirrorDistro(this.store, repo) : undefined
    return wslDistro ? { kind: 'local-wsl', wslDistro } : { kind: 'local' }
  }
}
