import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_CLI_PROBE_WINDOWS_SHELL,
  assertAgentCliBoundToTestRuntime,
  buildAgentCliProbeCommand,
  buildAgentCliProbeScript,
  evaluateAgentCliProbeResult,
  type AgentCliProbeResultFile
} from './agent-cli-runtime-identity'
import type { HeadlessPairedRuntimeHost } from './headless-paired-runtime-host'

const HOST_RUNTIME_ID = '11111111-2222-4333-8444-555555555555'

function validResult(
  nonce: string,
  overrides: Partial<AgentCliProbeResultFile> = {}
): AgentCliProbeResultFile {
  return {
    nonce,
    exitCode: 0,
    ok: true,
    state: 'ready',
    reachable: true,
    connectionState: 'connected',
    runtimeId: HOST_RUNTIME_ID,
    metaRuntimeId: HOST_RUNTIME_ID,
    ...overrides
  }
}

type RecordedCall = { method: string; params: unknown }

function buildStubHost(
  results: {
    statusRuntimeId?: string
  } = {}
): { host: HeadlessPairedRuntimeHost; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const host = {
    client: {
      call: async (method: string, params: unknown): Promise<{ result: unknown }> => {
        calls.push({ method, params })
        if (method === 'status.get') {
          return { result: { runtimeId: results.statusRuntimeId ?? HOST_RUNTIME_ID } }
        }
        if (method === 'terminal.create') {
          return { result: { terminal: { handle: 'probe-handle-1' } } }
        }
        return { result: {} }
      }
    },
    userDataDir: '/stub/user-data'
  } as unknown as HeadlessPairedRuntimeHost
  return { host, calls }
}

const probeScratchDirs: string[] = []

afterEach(() => {
  for (const dir of probeScratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The helper makes its own scratch dir; recover it from the sent command so a
// failed assertion does not leave temp files behind in unit runs.
function trackScratch(command: string): string {
  const dir = command.match(/["'](.+)[/\\]probe\.mjs["']/)?.[1] ?? ''
  if (dir) {
    probeScratchDirs.push(dir)
  }
  return dir
}

function nonceFromScript(scriptPath: string): string {
  return readFileSync(scriptPath, 'utf8').match(/const nonce = "(.+)"/)?.[1] ?? ''
}
function writeResult(resultPath: string, result: AgentCliProbeResultFile): void {
  writeFileSync(resultPath, `${JSON.stringify(result)}\n`, { mode: 0o600 })
}

describe('buildAgentCliProbeScript', () => {
  it('runs orca status through the runProcess wrapper with a baked nonce and result path', () => {
    const script = buildAgentCliProbeScript({
      runProcessModuleUrl: 'file:///repo/out/shared/child-process/run-process.js',
      resultPath: '/tmp/probe-result.json',
      nonce: 'nonce-1'
    })
    expect(script).toContain(
      `import { runProcess } from "file:///repo/out/shared/child-process/run-process.js"`
    )
    expect(script).toContain(`const nonce = "nonce-1"`)
    expect(script).toContain(`const resultPath = "/tmp/probe-result.json"`)
    expect(script).toContain(`program: 'orca', args: ['status', '--json']`)
    // Only whitelisted identity fields may be written — no env/URL/error text.
    expect(script).toContain('write({')
    expect(script).not.toContain('process.env')
    expect(script).not.toContain('pairingUrl')
    expect(script).not.toContain('error.message')
  })
})

describe('evaluateAgentCliProbeResult', () => {
  it('accepts the explicit ready contract with an exact runtimeId match', () => {
    expect(evaluateAgentCliProbeResult(validResult('n'), HOST_RUNTIME_ID)).toEqual({ ok: true })
  })

  it('rejects spawn errors, non-zero exits, and ok:false payloads', () => {
    expect(
      evaluateAgentCliProbeResult(validResult('n', { probeError: 'ENOENT' }), HOST_RUNTIME_ID)
    ).toEqual({ ok: false, reason: 'probe-error:ENOENT' })
    expect(evaluateAgentCliProbeResult(validResult('n', { exitCode: 1 }), HOST_RUNTIME_ID)).toEqual(
      {
        ok: false,
        reason: 'cli-exit:1'
      }
    )
    expect(evaluateAgentCliProbeResult(validResult('n', { ok: false }), HOST_RUNTIME_ID)).toEqual({
      ok: false,
      reason: 'cli-not-ok'
    })
  })

  it('rejects not-ready, unreachable, or not-yet-connected runtimes', () => {
    expect(
      evaluateAgentCliProbeResult(validResult('n', { state: 'starting' }), HOST_RUNTIME_ID)
    ).toEqual({
      ok: false,
      reason: 'runtime-state:starting'
    })
    expect(
      evaluateAgentCliProbeResult(validResult('n', { reachable: false }), HOST_RUNTIME_ID)
    ).toEqual({
      ok: false,
      reason: 'runtime-not-reachable'
    })
    expect(
      evaluateAgentCliProbeResult(
        validResult('n', { connectionState: 'connecting' }),
        HOST_RUNTIME_ID
      )
    ).toEqual({
      ok: false,
      reason: 'runtime-connection-state:connecting'
    })
    expect(
      evaluateAgentCliProbeResult(validResult('n', { connectionState: null }), HOST_RUNTIME_ID)
    ).toEqual({
      ok: false,
      reason: 'runtime-connection-state:null'
    })
  })

  it('rejects missing, mismatched, or _meta-conflicting runtime ids exactly', () => {
    expect(
      evaluateAgentCliProbeResult(validResult('n', { runtimeId: null }), HOST_RUNTIME_ID)
    ).toEqual({
      ok: false,
      reason: 'missing-runtime-id'
    })
    expect(
      evaluateAgentCliProbeResult(validResult('n', { runtimeId: 'other-runtime' }), HOST_RUNTIME_ID)
    ).toEqual({ ok: false, reason: 'runtime-id-mismatch' })
    expect(
      evaluateAgentCliProbeResult(
        validResult('n', { metaRuntimeId: 'other-runtime' }),
        HOST_RUNTIME_ID
      )
    ).toEqual({ ok: false, reason: 'meta-runtime-id-conflict' })
  })
})

describe('assertAgentCliBoundToTestRuntime (flow)', () => {
  it('passes when the probe result file lands after a delay and cleans up', async () => {
    const { host, calls } = buildStubHost()
    let capturedResultPath = ''
    const probe = await assertAgentCliBoundToTestRuntime(host, {
      worktreeId: 'wt-1',
      onProbeCommandSent: async (command, resultPath, scriptPath) => {
        capturedResultPath = resultPath
        trackScratch(command)
        // Simulate the PTY script: the file only appears after the first polls.
        await new Promise((resolve) => setTimeout(resolve, 700))
        writeResult(resultPath, validResult(nonceFromScript(scriptPath)))
      }
    })
    expect(probe.hostRuntimeId).toBe(HOST_RUNTIME_ID)
    expect(probe.cliRuntimeId).toBe(HOST_RUNTIME_ID)
    expect(probe.probeTerminalHandle).toBe('probe-handle-1')
    expect(calls.map((call) => call.method)).toContain('terminal.close')
    expect(() => statSync(capturedResultPath)).toThrow()
  })

  it('ignores files with a wrong nonce and aborts on runtime-id mismatch', async () => {
    const { host, calls } = buildStubHost()
    let sawCommand = ''
    await expect(
      assertAgentCliBoundToTestRuntime(host, {
        worktreeId: 'wt-1',
        onProbeCommandSent: async (command, resultPath, scriptPath) => {
          sawCommand = command
          trackScratch(command)
          // Forged/stale file first: right shape, wrong nonce — must be ignored.
          writeResult(resultPath, validResult('forged-nonce', { runtimeId: 'evil-runtime' }))
          await new Promise((resolve) => setTimeout(resolve, 550))
          writeResult(
            resultPath,
            validResult(nonceFromScript(scriptPath), { runtimeId: 'different-runtime' })
          )
        }
      })
    ).rejects.toThrow('runtime-id-mismatch')
    // Cleanup still runs on abort.
    expect(calls.map((call) => call.method)).toContain('terminal.close')
    expect(sawCommand).toContain('probe.mjs')
  })

  it('aborts on probe spawn errors and on missing result files', async () => {
    const { host } = buildStubHost()
    await expect(
      assertAgentCliBoundToTestRuntime(host, {
        worktreeId: 'wt-1',
        onProbeCommandSent: async (command, resultPath, scriptPath) => {
          trackScratch(command)
          writeResult(
            resultPath,
            validResult(nonceFromScript(scriptPath), { probeError: 'ENOENT' })
          )
        }
      })
    ).rejects.toThrow('probe-error:ENOENT')

    const { host: quietHost } = buildStubHost()
    await expect(
      assertAgentCliBoundToTestRuntime(quietHost, {
        worktreeId: 'wt-1',
        resultTimeoutMs: 1_200,
        onProbeCommandSent: async (command) => {
          trackScratch(command)
        }
      })
    ).rejects.toThrow('timed out waiting for its result file')
  })

  it('rejects a host that never reports a runtimeId before creating terminals', async () => {
    const { host, calls } = buildStubHost({ statusRuntimeId: '' })
    await expect(assertAgentCliBoundToTestRuntime(host, { worktreeId: 'wt-1' })).rejects.toThrow(
      'did not report a runtimeId'
    )
    expect(calls.map((call) => call.method)).not.toContain('terminal.create')
  })
})

describe('probe command portability', () => {
  it('sends a single unchained invocation with a shell-quoted script path', async () => {
    const { host, calls } = buildStubHost()
    let command = ''
    await assertAgentCliBoundToTestRuntime(host, {
      worktreeId: 'wt-1',
      onProbeCommandSent: async (sent, resultPath, scriptPath) => {
        command = sent
        trackScratch(sent)
        writeResult(resultPath, validResult(nonceFromScript(scriptPath)))
      }
    })
    expect(command).toContain('probe.mjs')
    expect(command).not.toMatch(/^node "/)
    expect(command).not.toContain(';')
    expect(command).not.toContain('&&')
    const send = calls.find((call) => call.method === 'terminal.send')
    expect(send?.params).toMatchObject({ terminal: 'probe-handle-1', enter: true })
  })

  it('quotes node and script paths literally for the posix shell family', () => {
    expect(
      buildAgentCliProbeCommand({
        nodeExecutablePath: '/opt/node/bin/node',
        scriptPath: '/tmp/probe.mjs',
        platform: 'linux'
      })
    ).toBe(`'/opt/node/bin/node' '/tmp/probe.mjs'`)
    // $ and backticks stay literal inside the portable single-quote encoding;
    // apostrophes round-trip via the '"'"' splice sh/bash/zsh/fish all accept.
    expect(
      buildAgentCliProbeCommand({
        nodeExecutablePath: '/opt/node/bin/node',
        scriptPath: "/tmp/orca p'robe/$x/`probe.mjs",
        platform: 'linux'
      })
    ).toBe(`'/opt/node/bin/node'` + ` '/tmp/orca p'"'"'robe/$x/\`probe.mjs'`)
  })

  it('follows the pinned Windows shell for PowerShell and cmd quoting', () => {
    expect(
      buildAgentCliProbeCommand({
        nodeExecutablePath: String.raw`C:\node\node.exe`,
        scriptPath: String.raw`C:\o'b\probe.mjs`,
        platform: 'win32',
        terminalWindowsShell: AGENT_CLI_PROBE_WINDOWS_SHELL
      })
    ).toBe(String.raw`& 'C:\node\node.exe' 'C:\o''b\probe.mjs'`)
    expect(
      buildAgentCliProbeCommand({
        nodeExecutablePath: String.raw`C:\node\node.exe`,
        scriptPath: String.raw`C:\o"b\probe.mjs`,
        platform: 'win32',
        terminalWindowsShell: 'cmd.exe'
      })
    ).toBe(String.raw`"C:\node\node.exe" "C:\o^"b\probe.mjs"`)
  })
})
