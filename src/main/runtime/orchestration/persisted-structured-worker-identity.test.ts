import { describe, expect, it, vi } from 'vitest'
import { isPersistedStructuredWorkerIdentity } from './persisted-structured-worker-identity'
import { classifyWorkerTerminalProcessIncarnation } from './worker-terminal-process-liveness'
import { OrcaRuntimeWithSubscribeToTerminalResize } from '../orca-runtime-subscribe-to-terminal-resize'

describe('persisted structured worker process identity', () => {
  it.each([
    'structured:',
    'structured:session:inc',
    'endpoint/structworker_',
    'structworker_broken',
    ' structured: '
  ])('does not infer PTY exit or inspect a host for %s', async (identity) => {
    expect(isPersistedStructuredWorkerIdentity(identity)).toBe(true)
    expect(classifyWorkerTerminalProcessIncarnation(identity, [])).toBe('unverifiable')
    const listProcesses = vi.fn(async () => [])
    const runtime = Object.assign(
      Object.create(OrcaRuntimeWithSubscribeToTerminalResize.prototype),
      {
        ptyController: { listProcesses }
      }
    ) as OrcaRuntimeWithSubscribeToTerminalResize
    for (const scope of [
      { kind: 'local', hostId: 'local' },
      { kind: 'ssh', targetId: 'offline' },
      { kind: 'wsl', hostId: 'local', distro: 'Ubuntu' }
    ]) {
      expect(
        await runtime.inspectTerminalProcessIncarnationLiveness(identity, JSON.stringify(scope))
      ).toBe('unverifiable')
    }
    expect(listProcesses).not.toHaveBeenCalled()
  })

  it('keeps PTY absence classification unchanged', () => {
    expect(isPersistedStructuredWorkerIdentity(null, 'pty:inc', 'term_worker')).toBe(false)
    expect(classifyWorkerTerminalProcessIncarnation('pty:inc', [])).toBe('exited')
  })
})
