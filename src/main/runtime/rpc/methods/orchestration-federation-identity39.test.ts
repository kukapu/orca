import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import {
  createPersistedSchemaFixture,
  openPersistedSchemaMethodsFixture
} from '../../orchestration/db/schema/persisted-schema-test-fixture'
import { ORCHESTRATION_FEDERATION_ATTACH_METHODS } from './orchestration/federation/federation'

describe('federation caller native resource identity bridge, no admission39', () => {
  let directory: string
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  function fixture(version: 30 | 39) {
    directory = mkdtempSync(join(tmpdir(), 'orca-federation-identity-'))
    const file = join(directory, 'db.sqlite')
    createPersistedSchemaFixture(file, version)
    db = openPersistedSchemaMethodsFixture(file)
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'validateOrchestrationAgentLauncher').mockImplementation(() => {})
    vi.spyOn(runtime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'folder:worker'
    } as never)
    vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'worker',
      worktreeId: 'folder:worker',
      title: 'worker'
    })
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({
      handle: 'worker',
      worktreeId: 'folder:worker'
    } as never)
    vi.spyOn(runtime, 'isTerminalRunningAgent').mockResolvedValue(true)
    vi.spyOn(runtime, 'waitForTerminal').mockResolvedValue({
      handle: 'worker',
      condition: 'tui-idle',
      satisfied: true,
      status: 'running',
      exitCode: null
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('native-pane')
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue('native-process')
    vi.spyOn(runtime, 'getOrchestrationDispatchAuthority').mockReturnValue({
      paneKey: 'native-pane',
      processIncarnation: 'native-process',
      hostScope: { kind: 'local', hostId: 'local' }
    } as never)
    vi.spyOn(runtime, 'getTerminalOrchestrationCliCommand').mockReturnValue('orca')
    vi.spyOn(runtime, 'sendTerminalAgentPrompt').mockResolvedValue({
      handle: 'worker',
      accepted: true,
      bytesWritten: 1
    })
  }
  afterEach(() => {
    runtime?.stopOrchestrationFederationRelay()
    db?.close()
    vi.restoreAllMocks()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  function start(reused = false) {
    const method = ORCHESTRATION_FEDERATION_ATTACH_METHODS[0]
    return method.handler(
      method.params!.parse({
        dispatchId: 'remote',
        taskId: 'remote-task',
        taskSpec: 'task',
        protocolVersion: 3,
        worktree: 'folder:worker',
        ...(reused ? { terminal: 'worker' } : { agent: 'cursor' }),
        hostScope: 'ssh:untrusted-payload',
        terminalOwnership: 'owned'
      }),
      {
        runtime,
        orchestrationMutation: {
          callerFingerprint: 'peer',
          requestId: 'request',
          method: 'orchestration.federationAttachStart',
          payloadHash: 'hash'
        }
      }
    )
  }

  for (const version of [30, 39] as const) {
    it.each([false, true])(`schema${version} native reuse=%s`, async (reused) => {
      fixture(version)
      expect(await start(reused)).toMatchObject({ state: 'ready' })
      expect(db.getWorkerTerminalResourceByOwner('remote')).toMatchObject({
        ownership_state: reused ? 'external' : 'owned',
        host_scope: '{"kind":"local","hostId":"local"}',
        process_incarnation: 'native-process'
      })
      if (version === 39) {
        expect(db.getWorkerTerminalResourceByOwner('remote')).toMatchObject({
          endpoint_id: runtime.getRuntimeId(),
          endpoint_incarnation: 'native-process'
        })
      }
      expect(db.db.pragma('user_version', { simple: true })).toBe(version)
    })
  }

  it('does not borrow a host scope from another authority incarnation', async () => {
    fixture(39)
    vi.mocked(runtime.getOrchestrationDispatchAuthority).mockReturnValue({
      paneKey: 'native-pane',
      processIncarnation: 'other-process',
      hostScope: { kind: 'ssh', targetId: 'other-host' }
    } as never)
    expect(await start()).toMatchObject({ state: 'ready' })
    expect(db.getWorkerTerminalResourceByOwner('remote')).toMatchObject({ host_scope: null })
  })

  it('does not expand the native producer to structured workers', async () => {
    fixture(39)
    vi.mocked(runtime.getTerminalProcessIncarnation).mockReturnValue(
      'structured:session:generation'
    )
    expect(await start()).toMatchObject({ state: 'failed' })
    expect(db.getWorkerTerminalResourceByOwner('remote')).toBeUndefined()
    expect(runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })
})
