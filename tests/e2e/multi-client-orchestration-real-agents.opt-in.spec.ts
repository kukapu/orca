/**
 * Opt-in REAL OpenCode/Pi smoke on the isolated host. Default skip; no LLM is
 * spent unless the coordinator opens both gates:
 *   ORCA_E2E_REAL_OPENCODE=1 / ORCA_E2E_REAL_PI=1 (real binaries available)
 *   ORCA_E2E_REAL_AGENT_LLM=1 (authorized bounded LLM spend)
 *   ORCA_E2E_REAL_OPENCODE_MODEL / ORCA_E2E_REAL_PI_MODEL (authorized model id)
 *   ORCA_E2E_REAL_AGENT_ENV_JSON (path to a JSON env file with agent
 *   credentials; allowlist-enforced, never logged, never shell-interpolated —
 *   it rides the runtime's agentDefaultEnv into the PTY env map)
 * Authorized families: GLM 5.3 and Grok 4.6 only. Grok on OpenCode is always
 * xai/grok-4.6. The observer clients are paired RPC connections, not desktop
 * apps; both stay connected and one reconnects mid-run.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { runProcess } from '../../src/shared/child-process/run-process'
import { assertAgentCliBoundToTestRuntime } from './helpers/agent-cli-runtime-identity'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { observedModelMatchesRequested } from './helpers/observed-model-match'
import { assertRealAgentEnvApplied, readRealAgentEnvFile } from './helpers/real-agent-credentials'
import { assertCleanRealAgentAmbientEnv } from './helpers/real-agent-ambient-env-guard'
import {
  deriveSmokeScreenFlags,
  persistSmokeObservation,
  shouldSampleWorkerScreen
} from './helpers/real-agent-smoke-screen-observer'
import { readTailLinesFromTerminalRead } from './helpers/real-agent-screen-evidence'
import {
  extractWorkerDispatchDiagnostics,
  extractWorkerStartReceiptDiagnostics,
  formatWorkerDispatchDiagnostics,
  formatWorkerStartReceiptDiagnostics
} from './helpers/real-agent-dispatch-diagnostics'
import {
  connectTwoPairedRpcObservers,
  reconnectPairedObserver,
  seedHostFolderWorkspace,
  unwrapRuntimeRpcResponse
} from './helpers/remote-validation-isolated-host'
import {
  PRODUCTION_XVFB_DISPLAY,
  assertRemoteValidationIsolation
} from './helpers/remote-validation-isolation-guards'

const mainPath = path.join(process.cwd(), 'out', 'main', 'index.js')
const REAL_OPENCODE = process.env.ORCA_E2E_REAL_OPENCODE === '1'
const REAL_PI = process.env.ORCA_E2E_REAL_PI === '1'
const REAL_LLM = process.env.ORCA_E2E_REAL_AGENT_LLM === '1'
const OPENCODE_MODEL = process.env.ORCA_E2E_REAL_OPENCODE_MODEL
const PI_MODEL = process.env.ORCA_E2E_REAL_PI_MODEL
const AGENT_ENV_JSON = process.env.ORCA_E2E_REAL_AGENT_ENV_JSON
const ALLOWED_MODEL_FAMILIES = ['glm-5.3', 'grok-4.6'] as const
const SMOKE_EVIDENCE_ROOT = path.join(os.tmpdir(), 'orca-gate-b-smoke-evidence')

test.skip(
  !existsSync(mainPath),
  'Requires an e2e-mode out/ build after the coordinator opens the build gate'
)
test.skip(!REAL_OPENCODE && !REAL_PI, 'Set ORCA_E2E_REAL_OPENCODE=1 and/or ORCA_E2E_REAL_PI=1')
test.skip(
  process.env.DISPLAY === PRODUCTION_XVFB_DISPLAY,
  'Refuses production Xvfb DISPLAY=:99; wrap with xvfb-run --auto-servernum'
)
// When the no-LLM startup probe runs, the spend-bearing smoke must not.
test.skip(
  process.env.ORCA_E2E_REAL_STARTUP_PROBE === '1',
  'Startup probe mode: spend-bearing smoke skipped'
)

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

function assertAuthorizedModel(model: string | undefined, agent: 'opencode' | 'pi'): string {
  if (!model) {
    test.skip(true, `ORCA_E2E_REAL_${agent.toUpperCase()}_MODEL not set`)
    throw new Error('unreachable')
  }
  const lowered = model.toLowerCase()
  if (!ALLOWED_MODEL_FAMILIES.some((family) => lowered.includes(family))) {
    throw new Error(
      `Model ${model} is outside the authorized families (GLM 5.3, Grok 4.6); refusing to launch`
    )
  }
  if (agent === 'opencode' && lowered.includes('grok') && model !== 'xai/grok-4.6') {
    throw new Error('Grok on OpenCode must be launched as xai/grok-4.6')
  }
  return model
}

type RealSmokeScenario = {
  agent: 'opencode' | 'pi'
  marker: string
  model: string
}

type TranscriptMessage = {
  blocks?: { text?: string; type: string }[]
  role?: string
}

async function runRealAgentSmoke(
  scenario: RealSmokeScenario,
  testRepoPath: string,
  scratch: string
): Promise<void> {
  // Gate B precondition: ambient XDG/OpenCode/Pi overrides would escape the
  // isolated HOME and point the real agent at live config/sessions.
  assertCleanRealAgentAmbientEnv()
  const binaryPath = await resolveBinary(scenario.agent)
  test.skip(!binaryPath, `real ${scenario.agent} binary not found on PATH`)
  if (!binaryPath) {
    return
  }
  const version = await runProcess({
    program: binaryPath,
    args: ['--version'],
    timeoutMs: 20_000
  })
  expect(version.code).toBe(0)
  expect(version.stdout.trim().length).toBeGreaterThan(0)
  // Credentials ride agentDefaultEnv (validated allowlist); the override only
  // pins the real binary path — no script, no interpolation, nothing logged.
  const credentialEnv = AGENT_ENV_JSON ? readRealAgentEnvFile(AGENT_ENV_JSON) : {}

  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    settingsOverrides: {
      agentCmdOverrides: { [scenario.agent]: buildFakeAgentCommandOverride(binaryPath) },
      agentDefaultEnv: { [scenario.agent]: credentialEnv }
    },
    userDataParent: scratch
  })
  assertRemoteValidationIsolation({ display: process.env.DISPLAY, userDataDir: host.userDataDir })
  let observerAClose: (() => void) | undefined
  let observerBClose: (() => void) | undefined
  try {
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    // Pre-LLM isolation precondition: the `orca` CLI inside this host's terminal
    // environment must resolve the isolated test runtime EXACTLY (runtimeId
    // equality, not a text match) or the smoke aborts before any agent spends.
    const cliIdentity = await assertAgentCliBoundToTestRuntime(host, { worktreeId })
    const coordinatorTerminal = await host.client.call<{ terminal: { handle: string } }>(
      'terminal.create',
      { worktree: `id:${worktreeId}` }
    )
    const from = coordinatorTerminal.result.terminal.handle
    const applied = await host.client.call<{
      settings?: {
        agentCmdOverrides?: Record<string, string>
        agentDefaultEnv?: Record<string, Record<string, string>>
      }
    }>('settings.get', {})
    expect(applied.result.settings?.agentCmdOverrides?.[scenario.agent]).toContain(
      binaryPath.split(path.sep).pop() ?? binaryPath
    )
    // Keys-only comparison: values must never reach assertion output.
    assertRealAgentEnvApplied(
      applied.result.settings?.agentDefaultEnv?.[scenario.agent],
      credentialEnv
    )

    const run = await host.client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: `Real ${scenario.agent} bounded smoke`,
      from
    })
    const connected = await connectTwoPairedRpcObservers(host)
    observerAClose = connected.clientA.close
    observerBClose = connected.clientB.close
    const pairingA = connected.clientA.identity.pairingUrl

    const task = await host.client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: `Smoke: first ask the coordinator "ready to proceed with smoke?" with options yes and wait for the answer (timeout 60s), then reply with exactly the token ${scenario.marker} and nothing else, then report worker_done as instructed in your preamble.`,
      run: run.result.run.id,
      callerTerminalHandle: from
    })
    const started = await host.client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from,
      agent: scenario.agent,
      model: scenario.model,
      timeoutMs: 60_000
    })
    const workerHandle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(workerHandle).toBeTruthy()
    const dispatch = await host.client.call<{
      dispatch: {
        id: string
        status: string
        capability_revoked_at?: string | null
      } | null
    }>('orchestration.dispatchShow', { task: task.result.task.id })
    // Bounded screen observability: sanitized in-memory flags persisted per
    // runtime/test OUTSIDE test-results, so smoke evidence survives cleanup.
    const runtimeId = cliIdentity.cliRuntimeId
    const smokeTestId = `real-${scenario.agent}-smoke`
    let lastScreenSampleAt = Number.NEGATIVE_INFINITY
    let screenSampleIndex = 0
    const observeWorkerScreen = async (step: string): Promise<void> => {
      if (!workerHandle) {
        return
      }
      const stepName = `${String(screenSampleIndex).padStart(2, '0')}-${step}`
      screenSampleIndex += 1
      try {
        const read = await host.client.call<unknown>('terminal.read', {
          terminal: workerHandle,
          screen: true
        })
        const flags = deriveSmokeScreenFlags(readTailLinesFromTerminalRead(read.result))
        persistSmokeObservation({
          evidenceRoot: SMOKE_EVIDENCE_ROOT,
          observation: {
            runtimeId,
            testId: smokeTestId,
            step: stepName,
            capturedAtMs: Date.now(),
            flags,
            screenReadFailed: false
          }
        })
        console.log(
          `[GATE-B-SCREEN-FLAGS] ${step} ${JSON.stringify({ ...flags, screenReadFailed: false })}`
        )
      } catch {
        persistSmokeObservation({
          evidenceRoot: SMOKE_EVIDENCE_ROOT,
          observation: {
            runtimeId,
            testId: smokeTestId,
            step: stepName,
            capturedAtMs: Date.now(),
            flags: deriveSmokeScreenFlags([]),
            screenReadFailed: true
          }
        })
        console.log(`[GATE-B-SCREEN-FLAGS] ${step} ${JSON.stringify({ screenReadFailed: true })}`)
      }
    }
    let stalledRecovery = false
    if (dispatch.result.dispatch?.status !== 'dispatched') {
      // Sanitized Gate B diagnostics: machine tokens only (states, stage,
      // exact known error token, typed refusal enums, presence flags) — raw
      // error text never reaches output.
      const shown = await host.client.call<unknown>('orchestration.workerShow', {
        dispatch: dispatch.result.dispatch?.id ?? ''
      })
      const workerDiagnostics = extractWorkerDispatchDiagnostics({
        dispatch: dispatch.result.dispatch,
        ...(shown.result as object)
      })
      const receiptDiagnostics = extractWorkerStartReceiptDiagnostics(started.result)
      console.log(
        formatWorkerDispatchDiagnostics(workerDiagnostics),
        formatWorkerStartReceiptDiagnostics(receiptDiagnostics)
      )
      await observeWorkerScreen('worker-start-failed')
      // #16095: agent_prompt_stalled is an unobserved turn start — delivery
      // of the prompt is not confirmed. When the worker stays live with its
      // capability retained, dispatch must NOT be resent or reset; the
      // bounded ask/completion observation below is the recovery verdict.
      stalledRecovery =
        receiptDiagnostics.lastErrorToken === 'agent_prompt_stalled' &&
        workerDiagnostics.observationStatus === 'live' &&
        !workerDiagnostics.capabilityRevoked
      expect(stalledRecovery).toBe(true)
    }

    // The worker opens with a bounded readiness ask. The question proves the
    // task is ACTIVE, so the client-A outage below happens mid-task by
    // construction — no arbitrary sleep, no completed-worker reconnect.
    type QuestionMessage = { body?: string; id: string }
    let questionId = ''
    await expect
      .poll(
        async () => {
          const mailbox = await host.client.call<{ messages: QuestionMessage[] }>(
            'orchestration.check',
            { terminal: from, all: true, types: 'question' }
          )
          const found = mailbox.result.messages.find((message) =>
            (message.body ?? '').includes('ready to proceed with smoke')
          )
          questionId = found?.id ?? ''
          // Bounded live sampling (>= 15s apart) while the worker runs; the
          // wait continues for the REAL ask/worker_done — no early cut on
          // working indicators.
          if (shouldSampleWorkerScreen({ lastSampleAtMs: lastScreenSampleAt, nowMs: Date.now() })) {
            lastScreenSampleAt = Date.now()
            await observeWorkerScreen('ask-poll-live')
          }
          return questionId
        },
        { timeout: 180_000 }
      )
      .not.toBe('')

    // Client A drops DURING the active task. Client B keeps observing.
    connected.clientA.close()
    observerAClose = undefined
    const replied = await host.client.call<{ question: { status: string } }>(
      'orchestration.reply',
      { id: questionId, body: 'yes', run: run.result.run.id, from }
    )
    expect(replied.result.question.status).toBe('answered')
    const reconnectedA = reconnectPairedObserver(pairingA)
    observerAClose = reconnectedA.close
    const runStillVisible = unwrapRuntimeRpcResponse(
      await reconnectedA.request<{ run: { id: string } | null }>('orchestration.runCurrent', {
        from
      })
    )
    expect(runStillVisible.run?.id).toBe(run.result.run.id)

    // Observed model must come from provider evidence, not the launch echo:
    // exact id match per agent (a last-segment match could accept a wrong
    // provider). The polled value never lands in assertion output. Every A
    // access below goes through the reconnected client, proving the new
    // connection carries reads end to end.
    await expect
      .poll(
        async () => {
          const shown = await reconnectedA.request<{
            observation: { observedOptions?: { model?: string; status: string } }
          }>('orchestration.workerShow', { dispatch: dispatch.result.dispatch!.id })
          if (!shown.ok) {
            return 'rpc-error'
          }
          const observed = shown.result.observation.observedOptions
          if (observed?.status !== 'observed') {
            return `status:${observed?.status ?? 'missing'}`
          }
          return observedModelMatchesRequested(scenario.agent, scenario.model, observed.model)
            ? 'matched'
            : 'model-mismatch'
        },
        { timeout: 120_000 }
      )
      .toBe('matched')

    // Bounded completion: the real agent reports worker_done itself.
    await expect
      .poll(
        async () => {
          const current = await host.client.call<{
            dispatch: { status: string } | null
          }>('orchestration.dispatchShow', { task: task.result.task.id })
          return current.result.dispatch?.status
        },
        { timeout: 240_000 }
      )
      .toBe('completed')

    // Structured provider transcript from the second client: an ASSISTANT
    // message carries the marker — the marker in the user prompt echo alone
    // never passes this check.
    const read = unwrapRuntimeRpcResponse(
      await connected.clientB.request<{
        fallbackReason: string | null
        source: string
        transcript?: { messages: TranscriptMessage[] }
      }>('orchestration.workerRead', { dispatch: dispatch.result.dispatch!.id })
    )
    expect(read.source).toBe('transcript')
    expect(read.fallbackReason).toBeNull()
    const messages = read.transcript?.messages ?? []
    const assistantMarkers = messages.filter(
      (message) =>
        message.role === 'assistant' &&
        (message.blocks ?? []).some(
          (block) => block.type === 'text' && (block.text ?? '').includes(scenario.marker)
        )
    )
    expect(assistantMarkers.length).toBeGreaterThan(0)

    const released = await host.client.call<{ state: string }>('orchestration.workerRelease', {
      dispatch: dispatch.result.dispatch!.id
    })
    expect(['released', 'already_released']).toContain(released.result.state)
  } finally {
    observerBClose?.()
    observerAClose?.()
    await host.dispose()
  }
}

test('real OpenCode worker completes a bounded task with an authorized model', async ({
  testRepoPath
}) => {
  test.skip(!REAL_OPENCODE, 'ORCA_E2E_REAL_OPENCODE=1 not set')
  test.skip(!REAL_LLM, 'ORCA_E2E_REAL_AGENT_LLM=1 not set (no LLM spend without the gate)')
  test.setTimeout(480_000)
  const model = assertAuthorizedModel(OPENCODE_MODEL, 'opencode')
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-opencode-smoke-'))
  try {
    await runRealAgentSmoke(
      { agent: 'opencode', marker: 'OPENCODE_SMOKE_OK', model },
      testRepoPath,
      scratch
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('real Pi worker completes a bounded task with an authorized model', async ({
  testRepoPath
}) => {
  test.skip(!REAL_PI, 'ORCA_E2E_REAL_PI=1 not set')
  test.skip(!REAL_LLM, 'ORCA_E2E_REAL_AGENT_LLM=1 not set (no LLM spend without the gate)')
  test.setTimeout(480_000)
  const model = assertAuthorizedModel(PI_MODEL, 'pi')
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-real-pi-smoke-'))
  try {
    await runRealAgentSmoke({ agent: 'pi', marker: 'PI_SMOKE_OK', model }, testRepoPath, scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
