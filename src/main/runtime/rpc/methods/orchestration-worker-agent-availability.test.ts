import { describe, expect, it, vi } from 'vitest'
import type { RemoteAgentDetection } from '../../../preflight/agent-detection'
import {
  assertWorkerAgentLaunchability,
  describeWorkerAgentAvailabilityHost,
  type WorkerAgentAvailabilityDeps
} from './orchestration-worker-agent-availability'

function createDeps(
  overrides: Partial<WorkerAgentAvailabilityDeps> = {}
): WorkerAgentAvailabilityDeps {
  return {
    detectLocalAgents: vi.fn(async () => ['codex', 'claude']),
    detectRemoteAgentsStatus: vi.fn(async (): Promise<RemoteAgentDetection> => ({
      status: 'answered',
      agents: ['codex']
    })),
    ...overrides
  }
}

describe('assertWorkerAgentLaunchability', () => {
  it('passes when the local host reports the agent', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({ agent: 'claude', host: { kind: 'local' }, deps })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).toHaveBeenCalledWith(undefined)
  })

  it('passes the WSL distro through so the guest PATH is probed, not the Windows one', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'local-wsl', wslDistro: 'Ubuntu' },
        deps
      })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).toHaveBeenCalledWith({ wslDistro: 'Ubuntu' })
  })

  it('fences with agent_not_available when the local host answered without the agent', async () => {
    const deps = createDeps({ detectLocalAgents: vi.fn(async () => ['codex']) })
    await expect(
      assertWorkerAgentLaunchability({ agent: 'claude', host: { kind: 'local' }, deps })
    ).rejects.toMatchObject({
      code: 'agent_not_available',
      data: { agent: 'claude', host: { kind: 'local' } }
    })
  })

  it('fences when an SSH host answered without the agent', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'remote-ssh', connectionId: 'ssh-1' },
        deps
      })
    ).rejects.toMatchObject({
      code: 'agent_not_available',
      data: { agent: 'claude', host: { kind: 'remote-ssh', connectionId: 'ssh-1' } }
    })
    expect(deps.detectRemoteAgentsStatus).toHaveBeenCalledWith({ connectionId: 'ssh-1' })
    expect(deps.detectLocalAgents).not.toHaveBeenCalled()
  })

  it('passes when an SSH host answered with the agent', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'codex',
        host: { kind: 'remote-ssh', connectionId: 'ssh-1' },
        deps
      })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).not.toHaveBeenCalled()
  })

  it('fences runtime-specific agents on runtimes where PATH detection describes them', async () => {
    // claude-agent-teams is a real PATH launch on darwin/linux; only win32/wsl
    // fall back, so this assertion is platform-gated for the Windows CI lane.
    if (process.platform === 'win32') {
      return
    }
    const deps = createDeps({ detectLocalAgents: vi.fn(async () => ['codex']) })
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude-agent-teams',
        host: { kind: 'local' },
        deps
      })
    ).rejects.toMatchObject({ code: 'agent_not_available' })
  })

  it('fails open for runtime-specific agents on their unsupported runtimes', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude-agent-teams',
        host: { kind: 'local-wsl', wslDistro: 'Ubuntu' },
        deps
      })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).not.toHaveBeenCalled()
  })

  it('fails open for runtime-specific agents on a remote host whose runtime is unknown', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude-agent-teams',
        host: { kind: 'remote-ssh', connectionId: 'ssh-1' },
        deps
      })
    ).resolves.toBeUndefined()
    expect(deps.detectRemoteAgentsStatus).not.toHaveBeenCalled()
  })

  it('fails open on a whitespace-only cmd override without probing', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'local' },
        deps,
        cmdOverride: '   '
      })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).not.toHaveBeenCalled()
  })

  it('fails open when the SSH host is unreachable — loss of contact is not absence', async () => {
    const deps = createDeps({
      detectRemoteAgentsStatus: vi.fn(async (): Promise<RemoteAgentDetection> => ({
        status: 'unreachable'
      }))
    })
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'remote-ssh', connectionId: 'ssh-down' },
        deps
      })
    ).resolves.toBeUndefined()
  })

  it('fails open when local detection throws — a failed probe is not "not installed"', async () => {
    const deps = createDeps({
      detectLocalAgents: vi.fn(async () => {
        throw new Error('ETIMEDOUT')
      })
    })
    await expect(
      assertWorkerAgentLaunchability({ agent: 'claude', host: { kind: 'local' }, deps })
    ).resolves.toBeUndefined()
  })

  it('fails open when the remote detection request itself rejects', async () => {
    const deps = createDeps({
      detectRemoteAgentsStatus: vi.fn(async () => {
        throw new Error('channel closed')
      })
    })
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'remote-ssh', connectionId: 'ssh-1' },
        deps
      })
    ).resolves.toBeUndefined()
  })

  it('fails open without probing when a user command override owns the launch', async () => {
    const deps = createDeps()
    await expect(
      assertWorkerAgentLaunchability({
        agent: 'claude',
        host: { kind: 'local' },
        deps,
        cmdOverride: '/opt/nightly/claude'
      })
    ).resolves.toBeUndefined()
    expect(deps.detectLocalAgents).not.toHaveBeenCalled()
  })
})

describe('describeWorkerAgentAvailabilityHost', () => {
  it('names each host kind for operator-facing errors', () => {
    expect(describeWorkerAgentAvailabilityHost({ kind: 'local' })).toBe('the local execution host')
    expect(describeWorkerAgentAvailabilityHost({ kind: 'local-wsl', wslDistro: 'Ubuntu' })).toBe(
      'the WSL distro Ubuntu'
    )
    expect(describeWorkerAgentAvailabilityHost({ kind: 'remote-ssh', connectionId: 'ssh-1' })).toBe(
      'the SSH host ssh-1'
    )
  })
})
