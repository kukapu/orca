/**
 * Gate B bracketed-paste/focus discrimination probe (authorized, NO Enter /
 * NO LLM): one session, ordered inputs — (S1) SHORT bracketed paste (single
 * line, marker A) before any other key; (S2) short ASCII control; (S3)
 * another short bracketed paste (marker B). In a parallel terminal of the
 * same run: VT focus-in (ESC[I, PTY protocol only) before a short bracketed
 * paste (marker C). If S3 renders while S1 did not, the composer needed
 * activation/focus, not a bracket-less strategy. Typed receipts and
 * sanitized drafts are captured; no submits, no window/OS focus calls.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { expect, test } from './helpers/orca-app'
import { buildAgentPromptPasteBytes } from '../../src/shared/agent-prompt-injection'
import { assertCleanRealAgentAmbientEnv } from './helpers/real-agent-ambient-env-guard'
import { readRealAgentEnvFile } from './helpers/real-agent-credentials'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { seedHostFolderWorkspace } from './helpers/remote-validation-isolated-host'
import { assertRemoteValidationIsolation } from './helpers/remote-validation-isolation-guards'
import { assertAgentCliBoundToTestRuntime } from './helpers/agent-cli-runtime-identity'
import {
  extractTerminalSendReceipt,
  readTailLinesFromTerminalRead,
  redactTerminalEvidenceLines,
  type TerminalSendReceiptEvidence
} from './helpers/real-agent-screen-evidence'
import { runProcess } from '../../src/shared/child-process/run-process'

const PROBE_ENABLED = process.env.ORCA_E2E_REAL_STARTUP_PROBE === '1'
const MODEL = process.env.ORCA_E2E_REAL_OPENCODE_MODEL ?? 'zai-coding-plan/glm-5.3'
const MARKER_A = 'BMARK1X'
const MARKER_B = 'BMARK3Y'
const MARKER_C = 'FMARK4Z'
const CONTROL = 'ZQCTRL2'

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

type Host = Awaited<ReturnType<typeof launchHeadlessPairedRuntimeHost>>

async function readScreenTail(host: Host, handle: string): Promise<string[]> {
  const read = await host.client.call<unknown>('terminal.read', {
    terminal: handle,
    screen: true
  })
  return readTailLinesFromTerminalRead(read.result)
}

async function sendText(
  host: Host,
  handle: string,
  text: string
): Promise<TerminalSendReceiptEvidence> {
  const send = await host.client.call<unknown>('terminal.send', {
    terminal: handle,
    text,
    enter: false
  })
  return extractTerminalSendReceipt(send.result, handle)
}

async function pollMarkerVisible(
  host: Host,
  handle: string,
  marker: string,
  timeoutMs: number
): Promise<{ seen: boolean; tail: string[] }> {
  const deadline = Date.now() + timeoutMs
  let tail: string[] = []
  while (Date.now() < deadline) {
    tail = await readScreenTail(host, handle)
    if (tail.some((line) => line.includes(marker))) {
      return { seen: true, tail }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  tail = await readScreenTail(host, handle)
  return { seen: tail.some((line) => line.includes(marker)), tail }
}

async function createAgentTerminal(host: Host, worktreeId: string): Promise<string> {
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
  return created.result.terminal.handle
}

test('real OpenCode bracketed paste focus discrimination probe (no submit, no LLM)', async ({
  testRepoPath
}, testInfo) => {
  test.skip(!PROBE_ENABLED, 'paste probe requires ORCA_E2E_REAL_STARTUP_PROBE=1')
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
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-focus-probe-'))
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    settingsOverrides: {
      agentCmdOverrides: { opencode: buildFakeAgentCommandOverride(binaryPath) },
      agentDefaultEnv: { opencode: credentialEnv }
    },
    userDataParent: scratch
  })
  let handleA = ''
  let handleB = ''
  try {
    assertRemoteValidationIsolation({ display: process.env.DISPLAY, userDataDir: host.userDataDir })
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    await assertAgentCliBoundToTestRuntime(host, { worktreeId })
    handleA = await createAgentTerminal(host, worktreeId)
    handleB = await createAgentTerminal(host, worktreeId)
    await new Promise((resolve) => setTimeout(resolve, 15_000))

    // Terminal A: ordered inputs, same session.
    const receiptA1 = await sendText(host, handleA, buildAgentPromptPasteBytes(MARKER_A))
    const step1 = await pollMarkerVisible(host, handleA, MARKER_A, 6_000)
    const receiptA2 = await sendText(host, handleA, `${CONTROL} `)
    const step2 = await pollMarkerVisible(host, handleA, CONTROL, 6_000)
    const receiptA3 = await sendText(host, handleA, buildAgentPromptPasteBytes(MARKER_B))
    const step3 = await pollMarkerVisible(host, handleA, MARKER_B, 6_000)

    // Terminal B: VT focus-in (PTY protocol only) BEFORE the bracketed paste.
    const receiptFocus = await sendText(host, handleB, '\x1b[I')
    const receiptB1 = await sendText(host, handleB, buildAgentPromptPasteBytes(MARKER_C))
    const stepFocus = await pollMarkerVisible(host, handleB, MARKER_C, 6_000)

    const report = {
      markerA: MARKER_A,
      markerB: MARKER_B,
      markerC: MARKER_C,
      control: CONTROL,
      s1BracketedBeforeAnyKey: { receipt: receiptA1, seen: step1.seen },
      s2AsciiControl: { receipt: receiptA2, seen: step2.seen },
      s3BracketedAfterControl: { receipt: receiptA3, seen: step3.seen },
      focusInThenBracketed: { receiptFocus, receipt: receiptB1, seen: stepFocus.seen }
    }
    console.log(`[GATE-B-FOCUS] ${JSON.stringify(report)}`)
    await testInfo.attach('terminal-a-redacted', {
      body: redactTerminalEvidenceLines(step3.tail, credentialValues).join('\n'),
      contentType: 'text/plain'
    })
    await testInfo.attach('terminal-b-focus-redacted', {
      body: redactTerminalEvidenceLines(stepFocus.tail, credentialValues).join('\n'),
      contentType: 'text/plain'
    })
    // Observation valid when every write was accepted by the contract.
    expect(receiptA1.accepted).toBe(true)
    expect(receiptA2.accepted).toBe(true)
    expect(receiptA3.accepted).toBe(true)
    expect(receiptB1.accepted).toBe(true)
  } finally {
    for (const handle of [handleA, handleB]) {
      if (handle) {
        await host.client.call('terminal.close', { terminal: handle }).catch(() => undefined)
      }
    }
    await host.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})
