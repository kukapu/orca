/**
 * Gate B controlled chip+submit probe (msg_5cf5b0cfaa40): isolated TUI, same
 * model. ONE benign multi-line paste (no Enter) -> confirm the REAL
 * `[Pasted ~N lines]` chip + typed receipt -> ONE authorized CR -> bounded
 * 90s observation distinguishing dialogs / submit errors / working /
 * assistant reply. READY also appears in the prompt text, so the assistant
 * verdict requires the chip to be GONE (composer cleared) plus new content,
 * never a bare regex. Full sanitized screens are written to a stable path
 * under /tmp/opencode BEFORE cleanup. If a dialog guards the submit, capture
 * and stop — no bypass, no retries.
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  classifySubmitScreen,
  extractTerminalSendReceipt,
  findPastedChipLineIndex,
  readTailLinesFromTerminalRead,
  redactTerminalEvidenceLines
} from './helpers/real-agent-screen-evidence'
import { runProcess } from '../../src/shared/child-process/run-process'

const PROBE_ENABLED = process.env.ORCA_E2E_REAL_STARTUP_PROBE === '1'
const MODEL = process.env.ORCA_E2E_REAL_OPENCODE_MODEL ?? 'zai-coding-plan/glm-5.3'
const MARKER = 'XPROBE8R'
const EVIDENCE_DIR = '/tmp/opencode/orca-gate-b-chip-submit-evidence'

const DRAFT = [
  `${MARKER} diagnostic draft (e2e probe).`,
  'Benign multi-line paste of representative preamble length.',
  'No secrets; no tools required.',
  'Task: reply with exactly READY and nothing else.',
  'Padding lines to approximate a dispatch preamble size:',
  '- context: isolated e2e fixture, single bounded turn',
  '- action: none beyond replying READY',
  '- expected reply: READY',
  '- line 9 padding for paste-size parity',
  '- line 10 padding for paste-size parity',
  '- line 11 padding for paste-size parity',
  '- line 12 padding for paste-size parity'
].join('\n')

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

function snapshotName(step: string): string {
  return path.join(EVIDENCE_DIR, `${step}.txt`)
}

test('real OpenCode chip then single submit probe (one authorized turn)', async ({
  testRepoPath
}, testInfo) => {
  test.skip(!PROBE_ENABLED, 'chip probe requires ORCA_E2E_REAL_STARTUP_PROBE=1')
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
  mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 })
  const persist = (step: string, lines: readonly string[]): void => {
    writeFileSync(
      snapshotName(step),
      `${redactTerminalEvidenceLines(lines, credentialValues).join('\n')}\n`,
      { mode: 0o600 }
    )
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-chip-probe-'))
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
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    const before = await readScreenTail(host, agentHandle)
    persist('01-before-paste', before)

    // Phase 1: multi-line paste, NO Enter. The oracle is the REAL chip label.
    const pasteSend = await host.client.call<unknown>('terminal.send', {
      terminal: agentHandle,
      text: buildAgentPromptPasteBytes(DRAFT),
      enter: false
    })
    const pasteReceipt = extractTerminalSendReceipt(pasteSend.result, agentHandle)
    let chipIndex = -1
    let afterPaste: string[] = []
    const chipDeadline = Date.now() + 15_000
    while (Date.now() < chipDeadline) {
      afterPaste = await readScreenTail(host, agentHandle)
      chipIndex = findPastedChipLineIndex(afterPaste)
      if (chipIndex >= 0) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    persist('02-after-paste', afterPaste)
    console.log(
      `[GATE-B-CHIP] ${JSON.stringify({ pasteReceipt, chipIndex, lines: afterPaste.length })}`
    )
    // No chip with the REAL oracle -> stop (no Enter, no bypass).
    expect(pasteReceipt.accepted).toBe(true)
    expect(chipIndex).toBeGreaterThanOrEqual(0)

    // Phase 2: ONE authorized CR, then bounded observation.
    const tEnter = Date.now()
    const enterSend = await host.client.call<unknown>('terminal.send', {
      terminal: agentHandle,
      text: '\r',
      enter: false
    })
    const enterReceipt = extractTerminalSendReceipt(enterSend.result, agentHandle)
    console.log(`[GATE-B-ENTER-RECEIPT] ${JSON.stringify(enterReceipt)}`)
    let verdict = 'timeout'
    let detail: string | null = null
    let finalTail: string[] = []
    const submitDeadline = Date.now() + 90_000
    let pollCount = 0
    while (Date.now() < submitDeadline) {
      finalTail = await readScreenTail(host, agentHandle)
      const classification = classifySubmitScreen(finalTail)
      const chipGone = findPastedChipLineIndex(finalTail) < 0
      const hasReady = finalTail.some((line) => /\bREADY\b/.test(line))
      const newContent =
        finalTail.length > afterPaste.length ||
        finalTail.some((line, i) => (afterPaste[i] ?? '') !== line && !line.includes(MARKER))
      if (classification.state === 'possible-dialog') {
        verdict = 'dialog-capture-and-stop'
        detail = classification.detail
        break
      }
      if (classification.state === 'error-toast') {
        verdict = 'submit-error-toast'
        detail = classification.detail
        break
      }
      // READY in the prompt echo is NOT an assistant reply: require the chip
      // gone (composer cleared) plus content that is not the pasted draft.
      if (hasReady && chipGone && newContent) {
        verdict = 'assistant-reply-ready'
        detail = `ms=${Date.now() - tEnter}`
        break
      }
      if (classification.state === 'working') {
        verdict = 'working'
        detail = classification.detail
        persist(`03-working-poll-${pollCount}`, finalTail)
        pollCount += 1
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    persist('04-final', finalTail.length > 0 ? finalTail : afterPaste)
    console.log(`[GATE-B-SUBMIT] ${JSON.stringify({ verdict, detail })}`)
    await testInfo.attach('final-screen-redacted', {
      body: redactTerminalEvidenceLines(
        finalTail.length > 0 ? finalTail : afterPaste,
        credentialValues
      ).join('\n'),
      contentType: 'text/plain'
    })
    expect(enterReceipt.accepted).toBe(true)
    // The deliverable is the classified observation; only a dialog is an
    // authorized hard stop before the turn outcome is known.
    expect(verdict).not.toBe('dialog-capture-and-stop')
  } finally {
    if (agentHandle) {
      await host.client.call('terminal.close', { terminal: agentHandle }).catch(() => undefined)
    }
    await host.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})
