/**
 * No-LLM coverage for the pre-agent CLI isolation precondition: inside a
 * terminal of the isolated paired host, `orca status --json` must resolve the
 * SAME runtime (exact runtimeId equality through the explicit ready contract)
 * before any real-agent smoke is allowed to spend. Runs no agent and reads no
 * credentials.
 */
import { expect, test } from './helpers/orca-app'
import { assertAgentCliBoundToTestRuntime } from './helpers/agent-cli-runtime-identity'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { seedHostFolderWorkspace } from './helpers/remote-validation-isolated-host'
import {
  PRODUCTION_XVFB_DISPLAY,
  assertRemoteValidationIsolation
} from './helpers/remote-validation-isolation-guards'

test('agent CLI environment resolves the isolated host runtime exactly', async ({
  testRepoPath
}) => {
  expect(process.env.DISPLAY ?? 'none').not.toBe(PRODUCTION_XVFB_DISPLAY)
  const host = await launchHeadlessPairedRuntimeHost()
  try {
    assertRemoteValidationIsolation({ display: process.env.DISPLAY, userDataDir: host.userDataDir })
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    const probe = await assertAgentCliBoundToTestRuntime(host, { worktreeId })
    expect(probe.cliRuntimeId).toBe(probe.hostRuntimeId)
    expect(probe.cliRuntimeId.length).toBeGreaterThan(0)
  } finally {
    await host.dispose()
  }
})
