/**
 * Gate B no-LLM startup probe (approved): reproduces the worker agent
 * terminal (same real binary via the shared cmdOverride/startup builder, same
 * isolated env/guard, same credential allowlist, same model session option)
 * WITHOUT any dispatch, preamble, prompt, or dialog input, then observes the
 * rendered screen (screen:true) AND the stream tail in one execution, plus a
 * whitelisted typed process inspection. All captured text is redacted IN
 * MEMORY — exact credential values first — before printing or attaching.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { expect, test } from './helpers/orca-app'
import { assertCleanRealAgentAmbientEnv } from './helpers/real-agent-ambient-env-guard'
import { readRealAgentEnvFile } from './helpers/real-agent-credentials'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { seedHostFolderWorkspace } from './helpers/remote-validation-isolated-host'
import { assertRemoteValidationIsolation } from './helpers/remote-validation-isolation-guards'
import { assertAgentCliBoundToTestRuntime } from './helpers/agent-cli-runtime-identity'
import {
  extractProcessInspectionEvidence,
  readTailLinesFromTerminalRead,
  redactTerminalEvidenceLines,
  redactTerminalEvidenceText
} from './helpers/real-agent-screen-evidence'
import { runProcess } from '../../src/shared/child-process/run-process'

const PROBE_ENABLED = process.env.ORCA_E2E_REAL_STARTUP_PROBE === '1'
const MODEL = process.env.ORCA_E2E_REAL_OPENCODE_MODEL ?? 'zai-coding-plan/glm-5.3'

async function resolveBinary(command: string): Promise<string | null> {
  try {
    const probe = await runProcess({
      program: process.platform === 'win32' ? 'where' : 'which',
      args: [command],
      timeoutMs: 10_000
    })
    const resolved = probe.stdout.trim().split(/\r?\n/)[0]
    return probe.code === 0 && resolved ? resolved : null
  } catch {
    return null
  }
}

test('real OpenCode worker startup screen probe (no prompt, no dispatch, no LLM)', async ({
  testRepoPath
}, testInfo) => {
  test.skip(!PROBE_ENABLED, 'startup probe requires ORCA_E2E_REAL_STARTUP_PROBE=1')
  assertCleanRealAgentAmbientEnv()
  const binaryPath = await resolveBinary('opencode')
  test.skip(!binaryPath, 'real opencode binary not found on PATH')
  if (!binaryPath) {
    return
  }
  const credentialEnv = process.env.ORCA_E2E_REAL_AGENT_ENV_JSON
    ? readRealAgentEnvFile(process.env.ORCA_E2E_REAL_AGENT_ENV_JSON)
    : {}
  const credentialValues = Object.values(credentialEnv)
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-startup-probe-'))
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    settingsOverrides: {
      agentCmdOverrides: { opencode: buildFakeAgentCommandOverride(binaryPath) },
      agentDefaultEnv: { opencode: credentialEnv }
    },
    userDataParent: scratch
  })
  let agentHandle = ''
  try {
    assertRemoteValidationIsolation({ display: process.env.DISPLAY, userDataDir: host.userDataDir })
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    await assertAgentCliBoundToTestRuntime(host, { worktreeId })
    // Worker-equivalent agent session (verified in code: same
    // buildAgentStartupPlan inputs — cmdOverride, agentEnv, model session
    // option), NO prompt: the probe observes; it never types or dispatches.
    const created = await host.client.call<{ terminal: { handle: string } }>(
      'terminal.createAgentSession',
      {
        clientOperationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
        worktree: `id:${worktreeId}`,
        agent: 'opencode',
        launchPreferences: { model: MODEL },
        viewMode: 'terminal'
      }
    )
    agentHandle = created.result.terminal.handle
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    const screenRead = await host.client.call<unknown>('terminal.read', {
      terminal: agentHandle,
      screen: true
    })
    const streamRead = await host.client.call<unknown>('terminal.read', { terminal: agentHandle })
    // Contract guard: a wrong shape fails here instead of fabricating output.
    const screenLines = readTailLinesFromTerminalRead(screenRead.result)
    const streamLines = readTailLinesFromTerminalRead(streamRead.result)
    const redactedScreen = redactTerminalEvidenceLines(screenLines, credentialValues)
    const redactedStream = redactTerminalEvidenceLines(streamLines, credentialValues)
    console.log(`[GATE-B-SCREEN]\n${redactedScreen.join('\n')}`)
    console.log(`[GATE-B-STREAM]\n${redactedStream.join('\n')}`)
    await testInfo.attach('startup-screen-redacted', {
      body: redactedScreen.join('\n'),
      contentType: 'text/plain'
    })
    await testInfo.attach('startup-stream-redacted', {
      body: redactedStream.join('\n'),
      contentType: 'text/plain'
    })
    const inspection = await host.client.call<unknown>('terminal.inspectProcess', {
      terminal: agentHandle
    })
    const evidence = extractProcessInspectionEvidence(inspection.result)
    evidence.foregroundProcessName = evidence.foregroundProcessName
      ? redactTerminalEvidenceText(evidence.foregroundProcessName, credentialValues)
      : null
    console.log(`[GATE-B-PROC] ${JSON.stringify(evidence)}`)
    const agentState = await host.client.call<{ isRunningAgent?: boolean }>(
      'terminal.isRunningAgent',
      { terminal: agentHandle }
    )
    console.log(
      `[GATE-B-STATE] ${JSON.stringify({ isRunningAgent: agentState.result.isRunningAgent === true })}`
    )
    expect(screenLines.length + streamLines.length).toBeGreaterThan(0)
  } finally {
    if (agentHandle) {
      await host.client.call('terminal.close', { terminal: agentHandle }).catch(() => undefined)
    }
    await host.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})
