/**
 * Gate B no-LLM Pi startup probe.
 *
 * Reuses the OpenCode startup-probe launch: same isolated --serve host, same
 * cmdOverride/startup builder, no dispatch, no preamble, no prompt, no dialog.
 * Oracle is Pi session_start (providerSessionOnly last-status), not agent_start.
 *
 * Node-direct (no pnpm), after a fresh CLI+Electron --mode e2e build:
 *   xvfb-run --auto-servernum env ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1 \
 *     TMPDIR=/tmp/opencode ORCA_E2E_REAL_STARTUP_PROBE=1 \
 *     node node_modules/@playwright/test/cli.js test \
 *     --config tests/playwright.config.ts --project electron-headless \
 *     --retries=0 --max-failures=1 \
 *     tests/e2e/real-pi-startup-hook-probe.opt-in.spec.ts
 *
 * No ORCA_E2E_REAL_AGENT_ENV_JSON / model env.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { expect, test } from './helpers/orca-app'
import { assertCleanRealAgentAmbientEnv } from './helpers/real-agent-ambient-env-guard'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { seedHostFolderWorkspace } from './helpers/remote-validation-isolated-host'
import {
  PRODUCTION_XVFB_DISPLAY,
  assertRemoteValidationIsolation
} from './helpers/remote-validation-isolation-guards'
import { assertAgentCliBoundToTestRuntime } from './helpers/agent-cli-runtime-identity'
import { readTailLinesFromTerminalRead } from './helpers/real-agent-screen-evidence'
import {
  classifyPiExtensionLoadErrors,
  extractIsRunningAgentObservation,
  extractTerminalAgentStatusObservation,
  extractWorktreeHookRowObservation,
  inspectPiManagedExtensions,
  readLastStatusSessionOracle,
  resolveIsolatedHome
} from './helpers/real-pi-startup-hook-probe'
import { runProcess } from '../../src/shared/child-process/run-process'

const PROBE_ENABLED = process.env.ORCA_E2E_REAL_STARTUP_PROBE === '1'

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

test('real Pi worker startup hook probe (no prompt, no dispatch, no LLM)', async ({
  testRepoPath
}) => {
  test.skip(
    process.env.DISPLAY === PRODUCTION_XVFB_DISPLAY,
    'Refuses production Xvfb DISPLAY=:99; wrap with xvfb-run --auto-servernum'
  )
  test.skip(!PROBE_ENABLED, 'startup probe requires ORCA_E2E_REAL_STARTUP_PROBE=1')
  assertCleanRealAgentAmbientEnv()
  const binaryPath = await resolveBinary('pi')
  test.skip(!binaryPath, 'real pi binary not found on PATH')
  if (!binaryPath) {
    return
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-pi-startup-probe-'))
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    settingsOverrides: {
      agentCmdOverrides: { pi: buildFakeAgentCommandOverride(binaryPath) }
    },
    userDataParent: scratch
  })
  let agentHandle = ''
  try {
    assertRemoteValidationIsolation({ display: process.env.DISPLAY, userDataDir: host.userDataDir })
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    await assertAgentCliBoundToTestRuntime(host, { worktreeId })
    const created = await host.client.call<{ terminal: { handle: string } }>(
      'terminal.createAgentSession',
      {
        clientOperationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
        worktree: `id:${worktreeId}`,
        agent: 'pi',
        viewMode: 'terminal'
      }
    )
    agentHandle = created.result.terminal.handle
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    const isolatedHome = resolveIsolatedHome(host.userDataDir)
    const managed = inspectPiManagedExtensions(isolatedHome)
    const sessionOracle = readLastStatusSessionOracle(host.userDataDir)
    const agentStatus = extractTerminalAgentStatusObservation(
      (await host.client.call<unknown>('terminal.agentStatus', { terminal: agentHandle })).result
    )
    const running = extractIsRunningAgentObservation(
      (await host.client.call<unknown>('terminal.isRunningAgent', { terminal: agentHandle })).result
    )
    const hookRow = extractWorktreeHookRowObservation(
      (await host.client.call<unknown>('worktree.ps', {})).result,
      worktreeId
    )
    const screenRead = await host.client.call<unknown>('terminal.read', {
      terminal: agentHandle,
      screen: true
    })
    const loadErrors = classifyPiExtensionLoadErrors(
      readTailLinesFromTerminalRead(screenRead.result)
    )
    const flags = {
      managed,
      sessionOracle,
      agentStatus: { ...agentStatus, isRunningAgent: agentStatus.isRunningAgent || running },
      hookRow,
      loadErrors
    }
    writeFileSync('/tmp/opencode/pi-startup-hook-probe-result.json', `${JSON.stringify(flags)}\n`, {
      mode: 0o600
    })
    console.log(`[GATE-B-PI-HOOK] ${JSON.stringify(flags)}`)
    expect(managed.files['orca-agent-status.ts'].present).toBe(true)
    expect(managed.files['orca-agent-status.ts'].managedMarker).toBe(true)
  } finally {
    if (agentHandle) {
      await host.client.call('terminal.close', { terminal: agentHandle }).catch(() => undefined)
    }
    await host.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})
