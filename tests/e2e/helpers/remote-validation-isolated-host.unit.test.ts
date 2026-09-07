import { spawnSync } from 'node:child_process'
import { spawnProcess } from '../../../src/shared/child-process/run-process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { afterEach, describe, expect, it } from 'vitest'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../../src/shared/pairing'
import {
  FAKE_AGENT_ASK_ARGS_SOURCE,
  FAKE_AGENT_ASK_MARKER_PREFIX,
  FAKE_HOOK_OBSERVED_MODEL,
  FAKE_HOOK_OBSERVED_THINKING,
  FAKE_ORCHESTRATION_AGENT_MARKER,
  fakeAgentHookEvents,
  isFakeOrchestrationAgentSource,
  writeFakeOpencodePiOrchestrationAgents
} from './fake-opencode-pi-orchestration-agents'
import { expectCleanFakeAgentLedger, readFakeAgentLedger } from './fake-agent-ledger'
import {
  PRODUCTION_RUNTIME_PORT,
  PRODUCTION_XVFB_DISPLAY,
  assertRemoteValidationIsolation,
  isProductionDisplay,
  isProductionRuntimePort,
  isProductionUserDataPath,
  productionOrcaConfigDir,
  stripProductionDisplay
} from './remote-validation-isolation-guards'
import {
  REMOTE_VALIDATION_COVERAGE,
  RUNTIME_STATUS_METHOD,
  assertDistinctPairedClientIdentities,
  assertObserverReadOnlyMethod,
  assertStatusMethodMatchesRuntimeRegistry,
  encodeWorkerAskMarker,
  observerReadOnlyMethods,
  readPairedClientIdentity,
  rotateHeadlessRuntimePairingOffer,
  seedHostFolderWorkspace
} from './remote-validation-isolated-host'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function syntheticPairingUrl(deviceId: string, deviceToken: string): string {
  return encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint: 'ws://127.0.0.1:6801/runtime',
    deviceToken,
    publicKeyB64: 'dGVzdC1wdWJsaWMta2V5LWZvci11bml0LXRlc3Rz',
    pairedDeviceId: deviceId,
    scope: 'runtime'
  })
}

describe('remote validation isolation', () => {
  it('rejects production userData, port 6768, and DISPLAY=:99', () => {
    const realHome = '/home/kukapu'
    expect(isProductionUserDataPath(path.join(realHome, '.config', 'orca'), realHome)).toBe(true)
    expect(
      isProductionUserDataPath(path.join(realHome, '.config', 'orca', 'nested'), realHome)
    ).toBe(true)
    expect(isProductionRuntimePort(PRODUCTION_RUNTIME_PORT)).toBe(true)
    expect(isProductionRuntimePort(6801)).toBe(false)
    expect(isProductionDisplay(PRODUCTION_XVFB_DISPLAY)).toBe(true)
    expect(isProductionDisplay(':100')).toBe(false)
    expect(() =>
      assertRemoteValidationIsolation({
        userDataDir: productionOrcaConfigDir(realHome),
        realHome
      })
    ).toThrow(/production Orca userData/)
    expect(() =>
      assertRemoteValidationIsolation({
        userDataDir: '/tmp/opencode/orca-e2e-isolated',
        port: PRODUCTION_RUNTIME_PORT,
        realHome
      })
    ).toThrow(/6768/)
    expect(() =>
      assertRemoteValidationIsolation({
        userDataDir: '/tmp/opencode/orca-e2e-isolated',
        display: PRODUCTION_XVFB_DISPLAY,
        realHome
      })
    ).toThrow(/xvfb-run --auto-servernum/)
  })

  it('strips inherited production DISPLAY without touching other env', () => {
    expect(
      stripProductionDisplay({
        DISPLAY: PRODUCTION_XVFB_DISPLAY,
        PATH: '/usr/bin',
        HOME: '/tmp/isolated-home'
      })
    ).toEqual({ PATH: '/usr/bin', HOME: '/tmp/isolated-home' })
    expect(stripProductionDisplay({ DISPLAY: ':1', PATH: '/bin' })).toEqual({
      DISPLAY: ':1',
      PATH: '/bin'
    })
  })

  it('labels RPC coverage separately from the web navigation complement', () => {
    expect(REMOTE_VALIDATION_COVERAGE.rpcControlPlane).toBe('rpc-two-paired-clients')
    expect(REMOTE_VALIDATION_COVERAGE.webNavigationComplement).toBe(
      'tests/e2e/multi-client-navigation-isolation.spec.ts'
    )
  })

  it('authenticates observers with the real status.get RPC method', () => {
    expect(() => assertStatusMethodMatchesRuntimeRegistry()).not.toThrow()
    expect(RUNTIME_STATUS_METHOD).toBe('status.get')
  })

  it('keeps paired observers on read-only methods only', () => {
    expect(observerReadOnlyMethods()).toContain(RUNTIME_STATUS_METHOD)
    expect(observerReadOnlyMethods()).toContain('orchestration.workerRead')
    for (const mutating of [
      'orchestration.reply',
      'orchestration.send',
      'orchestration.workerStart',
      'orchestration.workerStop',
      'orchestration.runCreate',
      'terminal.send',
      'repo.add'
    ]) {
      expect(() => assertObserverReadOnlyMethod(mutating)).toThrow(/read-only/)
    }
    expect(() => assertObserverReadOnlyMethod('orchestration.dispatchShow')).not.toThrow()
  })

  it('allows orchestration.check only in non-consuming modes', () => {
    expect(() =>
      assertObserverReadOnlyMethod('orchestration.check', { terminal: 't', peek: true })
    ).not.toThrow()
    expect(() =>
      assertObserverReadOnlyMethod('orchestration.check', { terminal: 't', all: true })
    ).not.toThrow()
    for (const mutating of [
      { ack: 'dlv_1' },
      { inject: true },
      { wait: true },
      { compatibilityQuestionAck: 'x' }
    ]) {
      expect(() => assertObserverReadOnlyMethod('orchestration.check', mutating)).toThrow(
        /ack\/inject\/wait/
      )
    }
  })
})

describe('paired RPC client identities', () => {
  it('requires distinct device tokens and ids', () => {
    const left = readPairedClientIdentity(syntheticPairingUrl('device-a', 'token-a'))
    const right = readPairedClientIdentity(syntheticPairingUrl('device-b', 'token-b'))
    expect(left.deviceId).toBe('device-a')
    expect(right.deviceToken).toBe('token-b')
    assertDistinctPairedClientIdentities(left, right)
    expect(() => assertDistinctPairedClientIdentities(left, left)).toThrow(/distinct device/)
    expect(() =>
      assertDistinctPairedClientIdentities(
        left,
        readPairedClientIdentity(syntheticPairingUrl('device-a', 'token-other'))
      )
    ).toThrow(/distinct device/)
  })
})

describe('rotateHeadlessRuntimePairingOffer', () => {
  it('invokes mobile pairing with rotate and this-computer reach', async () => {
    const handler = async (_event: unknown, args: unknown) => {
      expect(args).toEqual({
        address: '127.0.0.1',
        rotate: true,
        reach: 'this-computer'
      })
      return {
        available: true,
        pairingUrl: syntheticPairingUrl('device-b', 'token-b'),
        deviceId: 'device-b'
      }
    }
    const handlers = new Map([['mobile:getRuntimePairingUrl', handler]])
    const app = {
      evaluate: (callback: (electron: unknown) => unknown) =>
        Promise.resolve(callback({ ipcMain: { _invokeHandlers: handlers } }))
    } as unknown as ElectronApplication
    const offer = await rotateHeadlessRuntimePairingOffer(app)
    expect(offer.pairingUrl).toContain('orca://pair')
    expect(offer.deviceId).toBe('device-b')
  })

  it('fails when the pairing IPC is missing', async () => {
    const app = {
      evaluate: (callback: (electron: unknown) => unknown) =>
        Promise.resolve(callback({ ipcMain: { _invokeHandlers: new Map() } }))
    } as unknown as ElectronApplication
    await expect(rotateHeadlessRuntimePairingOffer(app)).rejects.toThrow(
      /mobile:getRuntimePairingUrl is unavailable/
    )
  })
})

describe('fake agent ledger', () => {
  it('tolerates only a trailing fragment and surfaces complete corrupt lines', () => {
    const dir = tempDir('orca-fake-ledger-')
    const ledger = path.join(dir, 'ledger.jsonl')
    writeFileSync(
      ledger,
      '{"kind":"opencode","phase":"worker_done","status":0}\n{"kind":"opencode"'
    )
    const trailing = readFakeAgentLedger(ledger)
    expect(trailing.entries).toHaveLength(1)
    expect(trailing.corruptLines).toEqual([])
    writeFileSync(ledger, '{"kind":"opencode","phase":"worker_done","status":0}\nnot json at all\n')
    expect(() => expectCleanFakeAgentLedger(ledger)).toThrow(/malformed complete line/)
  })
})

describe('fake OpenCode/Pi orchestration agents', () => {
  it('writes platform wrappers that are fake, not real binaries', () => {
    const directory = tempDir('orca-fake-oc-pi-')
    const agents = writeFakeOpencodePiOrchestrationAgents(directory)
    const opencodeSource = readFileSync(agents.paths.opencode, 'utf8')
    const piSource = readFileSync(agents.paths.pi, 'utf8')
    const shared = readFileSync(path.join(directory, 'fake-orchestration-agent.cjs'), 'utf8')
    expect(isFakeOrchestrationAgentSource(shared)).toBe(true)
    expect(shared).toContain(FAKE_ORCHESTRATION_AGENT_MARKER)
    expect(shared).not.toContain('zai-coding-plan')
    expect(shared).not.toContain('xai/grok')
    expect(agents.overrides.opencode).toContain(agents.paths.opencode)
    expect(agents.overrides.pi).toContain(agents.paths.pi)
    expect(agents.overrides.opencode).not.toBe(agents.overrides.pi)
    if (process.platform === 'win32') {
      expect(opencodeSource).toContain('FAKE_ORCHESTRATION_AGENT_KIND=opencode')
      expect(piSource).toContain('FAKE_ORCHESTRATION_AGENT_KIND=pi')
      expect(agents.paths.opencode.endsWith('.cmd')).toBe(true)
    } else {
      expect(opencodeSource).toContain('FAKE_ORCHESTRATION_AGENT_KIND=opencode')
      expect(piSource).toContain('FAKE_ORCHESTRATION_AGENT_KIND=pi')
    }
  })

  it('executes OpenCode startup bytes as 2004h then 25h before the idle marker', async () => {
    const directory = tempDir('orca-fake-oc-startup-')
    const agents = writeFakeOpencodePiOrchestrationAgents(directory)
    const collectStartup = async (program: string): Promise<string> => {
      const child = spawnProcess({
        program,
        args: [],
        env: {
          ...process.env,
          ORCA_AGENT_HOOK_PORT: '',
          ORCA_AGENT_HOOK_TOKEN: ''
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeoutMs: 10_000
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('binary')
      })
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        if (stdout.includes(FAKE_ORCHESTRATION_AGENT_MARKER)) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      child.kill()
      return stdout
    }
    const opencodeOut = await collectStartup(agents.paths.opencode)
    const paste = opencodeOut.indexOf('\x1b[?2004h')
    const cursor = opencodeOut.indexOf('\x1b[?25h')
    const idle = opencodeOut.indexOf(FAKE_ORCHESTRATION_AGENT_MARKER)
    expect(paste).toBeGreaterThanOrEqual(0)
    expect(cursor).toBeGreaterThan(paste)
    expect(idle).toBeGreaterThan(cursor)
    const piOut = await collectStartup(agents.paths.pi)
    expect(piOut.indexOf('\x1b[?2004h')).toBe(-1)
    expect(piOut.indexOf('\x1b[?25h')).toBe(-1)
    expect(piOut).toContain(FAKE_ORCHESTRATION_AGENT_MARKER)
  }, 15_000)

  it('generates a syntactically valid agent script with the ask handler', () => {
    const directory = tempDir('orca-fake-oc-pi-')
    writeFakeOpencodePiOrchestrationAgents(directory)
    const shared = path.join(directory, 'fake-orchestration-agent.cjs')
    const check = spawnSync(process.execPath, ['--check', shared], { encoding: 'utf8' })
    expect(check.stderr).toBe('')
    expect(check.status).toBe(0)
    const source = readFileSync(shared, 'utf8')
    expect(source).toContain(FAKE_AGENT_ASK_MARKER_PREFIX)
    expect(source).toContain('ASK_ANSWER_RECEIVED')
    expect(source).toContain('buildFakeAgentAskArgs')
    expect(source).toContain('postHookEvent')
    expect(source).toContain('X-Orca-Agent-Hook-Token')
    expect(source).toContain(FAKE_HOOK_OBSERVED_MODEL)
  })

  it('builds the orchestration ask argv with identity, capability, and request', () => {
    const buildAskArgs = new Function(
      'request',
      'env',
      'capability',
      `${FAKE_AGENT_ASK_ARGS_SOURCE}; return buildFakeAgentAskArgs(request, env, capability)`
    ) as (
      request: { options?: string; question: string; timeoutMs?: number; to: string },
      env: { ORCA_TERMINAL_HANDLE?: string },
      capability: string | null
    ) => string[]
    const env = { ORCA_TERMINAL_HANDLE: 'term_worker' }
    expect(
      buildAskArgs(
        { options: 'yes,no', question: 'Proceed?', timeoutMs: 45_000, to: 'term_coord' },
        env,
        'dcap_test'
      )
    ).toEqual([
      'orchestration',
      'ask',
      '--from',
      'term_worker',
      '--dispatch-capability',
      'dcap_test',
      '--to',
      'term_coord',
      '--question',
      'Proceed?',
      '--json',
      '--options',
      'yes,no',
      '--timeout-ms',
      '45000'
    ])
    expect(buildAskArgs({ question: 'Q', timeoutMs: 0, to: 'term_coord' }, env, null)).toEqual([
      'orchestration',
      'ask',
      '--from',
      'term_worker',
      '--to',
      'term_coord',
      '--question',
      'Q',
      '--json'
    ])
    expect(() => buildAskArgs({ question: 'Q', timeoutMs: 1, to: 't' }, {}, null)).toThrow(
      /ORCA_TERMINAL_HANDLE/
    )
  })

  it('builds hook events that mirror the real provider plugins', () => {
    expect(fakeAgentHookEvents('opencode')).toEqual({
      working: {
        hook_event_name: 'MessagePart',
        role: 'assistant',
        model: FAKE_HOOK_OBSERVED_MODEL
      },
      done: { hook_event_name: 'SessionIdle' }
    })
    expect(fakeAgentHookEvents('pi')).toEqual({
      working: {
        hook_event_name: 'agent_start',
        model: FAKE_HOOK_OBSERVED_MODEL,
        thinking_level: FAKE_HOOK_OBSERVED_THINKING
      },
      done: { hook_event_name: 'agent_end' }
    })
  })

  it('generated agent writes newline-delimited JSON ledger entries end to end', async () => {
    const directory = tempDir('orca-fake-oc-pi-exec-')
    const agents = writeFakeOpencodePiOrchestrationAgents(directory)
    const ledger = path.join(directory, 'ledger.jsonl')
    const cliStub = path.join(directory, 'cli-stub.cjs')
    const cliStubResult = JSON.stringify({ ok: true, result: { answer: 'yes' } })
    writeFileSync(cliStub, `process.stdout.write(${JSON.stringify(cliStubResult)})\n`)
    const encodedDone = Buffer.from(
      JSON.stringify({ coordinator: 'term_coord', dispatchId: 'ctx_1', taskId: 'task_1' })
    ).toString('base64')
    const child = spawnProcess({
      program: agents.paths.opencode,
      args: [],
      env: {
        ...process.env,
        ORCA_E2E_CLI_ENTRY: cliStub,
        ORCA_E2E_FAKE_AGENT_LEDGER: ledger,
        ORCA_TERMINAL_HANDLE: 'term_worker_exec',
        ORCA_AGENT_HOOK_PORT: '',
        ORCA_AGENT_HOOK_TOKEN: ''
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeoutMs: 15_000
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stdin.write(
      `\x1b[200~--dispatch-capability dcap_exec_test prompt\x1b[201~\rORCA_E2E_WORKER_DONE:${encodedDone}\r`
    )
    const deadline = Date.now() + 10_000
    let entries: ReturnType<typeof readFakeAgentLedger>['entries'] = []
    while (Date.now() < deadline) {
      entries = readFakeAgentLedger(ledger).entries
      if (entries.some((entry) => entry.phase === 'worker_done')) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    child.kill()
    // Real newline separators: every physical line is a standalone JSON doc.
    const rawLines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    expect(rawLines.length).toBeGreaterThan(1)
    for (const line of rawLines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(stdout).toContain('ACK')
    const clean = expectCleanFakeAgentLedger(ledger)
    expect(clean).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'opencode', phase: 'hook_working' }),
        expect.objectContaining({ kind: 'opencode', phase: 'worker_done', status: 0 })
      ])
    )
  }, 20_000)

  it('round-trips the worker ask marker', () => {
    const encoded = encodeWorkerAskMarker({
      options: 'yes,no',
      question: 'Confirm fake pi result path',
      timeoutMs: 45_000,
      to: 'term_coord'
    })
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    expect(decoded).toEqual({
      options: 'yes,no',
      question: 'Confirm fake pi result path',
      timeoutMs: 45_000,
      to: 'term_coord'
    })
  })
})

describe('host folder workspace seeding', () => {
  it('adds the repo and waits until the host lists its worktree', async () => {
    const calls: { method: string; params: unknown }[] = []
    let listCalls = 0
    const host = {
      client: {
        call: async (method: string, params: unknown) => {
          calls.push({ method, params })
          if (method === 'repo.add') {
            return { result: { repo: { id: 'repo_1' } } }
          }
          listCalls += 1
          return {
            result: {
              worktrees: listCalls >= 2 ? [{ id: 'wt_1' }] : []
            }
          }
        }
      },
      userDataDir: tempDir('orca-remote-validation-seed-')
    }
    const seeded = await seedHostFolderWorkspace(
      host as unknown as Parameters<typeof seedHostFolderWorkspace>[0],
      '/tmp/opencode/orca-e2e-repo'
    )
    expect(seeded).toEqual({ repoId: 'repo_1', worktreeId: 'wt_1' })
    expect(calls[0]).toEqual({
      method: 'repo.add',
      params: { path: '/tmp/opencode/orca-e2e-repo', kind: 'folder' }
    })
    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  it('fails loudly when the host never lists the worktree', async () => {
    const host = {
      client: {
        call: async (method: string) =>
          method === 'repo.add'
            ? { result: { repo: { id: 'repo_1' } } }
            : { result: { worktrees: [] } }
      },
      userDataDir: tempDir('orca-remote-validation-seed-')
    }
    await expect(
      seedHostFolderWorkspace(
        host as unknown as Parameters<typeof seedHostFolderWorkspace>[0],
        '/tmp/opencode/orca-e2e-repo',
        { pollTimeoutMs: 300 }
      )
    ).rejects.toThrow(/never listed/)
  })
})
