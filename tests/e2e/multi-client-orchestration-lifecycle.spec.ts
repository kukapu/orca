/**
 * Isolated headless serve + two persistent paired RPC clients (not desktop apps).
 * Coordinator lives on the host local RuntimeClient and owns every mutation;
 * paired observers are read-only (the RemoteRuntimeRequestConnection carries no
 * orchestration envelope). Coverage: rpc-two-paired-clients. Web complement:
 * multi-client-navigation-isolation.spec.ts. Not executed until the coordinator
 * opens the build gate. Do not claim this passed from being written.
 *
 * Phases:
 *  1. two distinct paired clients observe the coordinator's Run
 *  2. worker continuity with BOTH clients disconnected during active work
 *  3. real ask (worker CLI + dispatch capability) / reply / answer round trip
 *  4. structured output (workerRead) + explicit observed-options absence
 *  5. stop/release and archived output recovery
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import {
  FAKE_HOOK_OBSERVED_MODEL,
  FAKE_HOOK_OBSERVED_THINKING,
  FAKE_ORCHESTRATION_AGENT_MARKER,
  writeFakeOpencodePiOrchestrationAgents
} from './helpers/fake-opencode-pi-orchestration-agents'
import { expectCleanFakeAgentLedger, type FakeAgentLedgerEntry } from './helpers/fake-agent-ledger'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  REMOTE_VALIDATION_COVERAGE,
  connectTwoPairedRpcObservers,
  encodeWorkerAskMarker,
  encodeWorkerDoneMarker,
  reconnectPairedObserver,
  seedHostFolderWorkspace,
  unwrapRuntimeRpcResponse
} from './helpers/remote-validation-isolated-host'
import {
  PRODUCTION_XVFB_DISPLAY,
  assertRemoteValidationIsolation
} from './helpers/remote-validation-isolation-guards'

const mainPath = path.join(process.cwd(), 'out', 'main', 'index.js')
const cliEntryPath = path.join(process.cwd(), 'out', 'cli', 'index.js')

test.skip(
  !existsSync(mainPath),
  'Requires an e2e-mode out/ build after the coordinator opens the build gate'
)
test.skip(
  !existsSync(cliEntryPath),
  'Requires the bundled CLI in out/cli for the fake worker orchestration calls'
)
test.skip(
  process.env.DISPLAY === PRODUCTION_XVFB_DISPLAY,
  'Refuses production Xvfb DISPLAY=:99; wrap with xvfb-run --auto-servernum at the gate'
)

function readLedger(ledgerPath: string): FakeAgentLedgerEntry[] {
  return expectCleanFakeAgentLedger(ledgerPath)
}

test('two paired RPC clients observe host-owned OpenCode/Pi fake-agent lifecycle', async ({
  testRepoPath
}) => {
  test.setTimeout(300_000)
  expect(REMOTE_VALIDATION_COVERAGE.rpcControlPlane).toBe('rpc-two-paired-clients')
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'orca-remote-validation-'))
  const ledgerPath = path.join(scratch, 'fake-agent-ledger.jsonl')
  // Must exist before the host launch: the serve process (and the PTYs it
  // spawns) inherits them, so the fake worker can call the real CLI.
  const savedCliEntry = process.env.ORCA_E2E_CLI_ENTRY
  const savedLedger = process.env.ORCA_E2E_FAKE_AGENT_LEDGER
  process.env.ORCA_E2E_CLI_ENTRY = cliEntryPath
  process.env.ORCA_E2E_FAKE_AGENT_LEDGER = ledgerPath
  const agents = writeFakeOpencodePiOrchestrationAgents(path.join(scratch, 'fake-agents'))
  // agentCmdOverrides must ride the initial profile: the client-facing
  // settings.update RPC does not accept them, and patching the file between
  // serve processes loses to the store's load timing.
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    settingsOverrides: { agentCmdOverrides: agents.overrides },
    userDataParent: scratch
  })
  assertRemoteValidationIsolation({
    display: process.env.DISPLAY,
    userDataDir: host.userDataDir
  })
  let clientAClose: (() => void) | undefined
  let clientBClose: (() => void) | undefined
  try {
    const settingsAsServeSees = await host.client.call<{
      settings?: { agentCmdOverrides?: Record<string, string> }
    }>('settings.get', {})
    expect(settingsAsServeSees.result.settings?.agentCmdOverrides).toEqual(agents.overrides)
    // A fresh isolated userData has no repo: seed a folder workspace (folders
    // are first-class; this is not a git worktree assumption).
    const { worktreeId } = await seedHostFolderWorkspace(host, testRepoPath)
    const coordinatorTerminal = await host.client.call<{ terminal: { handle: string } }>(
      'terminal.create',
      { worktree: `id:${worktreeId}` }
    )
    const from = coordinatorTerminal.result.terminal.handle
    const run = await host.client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Remote validation fake OpenCode/Pi lifecycle',
      from
    })
    const runId = run.result.run.id

    // ── Phase 1: two distinct paired clients observe the Run ──────────
    const connected = await connectTwoPairedRpcObservers(host)
    clientAClose = connected.clientA.close
    clientBClose = connected.clientB.close
    expect(connected.coordinator.role).toBe('host-coordinator')
    expect(connected.coordinator.userDataDir).toBe(host.userDataDir)
    const observedByA = unwrapRuntimeRpcResponse(
      await connected.clientA.request<{ run: { id: string } | null }>('orchestration.runCurrent', {
        from
      })
    )
    expect(observedByA.run?.id).toBe(runId)
    // Older-client surface variant: taskList by explicit run id instead of runCurrent.
    const observedByB = unwrapRuntimeRpcResponse(
      await connected.clientB.request<{ runId: string; tasks: unknown[] }>(
        'orchestration.taskList',
        {
          run: runId,
          callerTerminalHandle: from
        }
      )
    )
    expect(observedByB.runId).toBe(runId)
    const pairingA = connected.clientA.identity.pairingUrl
    const pairingB = connected.clientB.identity.pairingUrl

    // ── Phase 2: worker continuity with both clients disconnected ─────
    const task1 = await host.client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: `ACK, stay alive, then complete as fake opencode`,
      run: runId,
      callerTerminalHandle: from
    })
    const started1 = await host.client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task1.result.task.id,
      from,
      agent: 'opencode',
      timeoutMs: 20_000
    })
    const worker1 = started1.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(worker1).toBeTruthy()
    await expect
      .poll(async () => {
        const read = await host.client.call<{ terminal: { tail: string[] } }>('terminal.read', {
          terminal: worker1,
          limit: 80
        })
        return read.result.terminal.tail.join('\n')
      })
      .toContain('ACK')
    const dispatch1 = await host.client.call<{
      dispatch: { id: string; last_failure?: string | null; status: string } | null
    }>('orchestration.dispatchShow', { task: task1.result.task.id })
    if (dispatch1.result.dispatch && dispatch1.result.dispatch.status !== 'dispatched') {
      const worker1Show = await host.client.call<{
        worker?: { last_error?: string | null; stage?: string; state?: string }
      }>('orchestration.workerShow', { dispatch: dispatch1.result.dispatch!.id })
      console.error(
        '[lifecycle] dispatch1 failed:',
        JSON.stringify(dispatch1.result.dispatch),
        'worker:',
        JSON.stringify(worker1Show.result.worker)
      )
    }
    expect(dispatch1.result.dispatch?.status).toBe('dispatched')

    // Clients leave DURING active work: only after the worker acknowledged.
    connected.clientA.close()
    connected.clientB.close()
    clientAClose = undefined
    clientBClose = undefined

    // Worker keeps running with zero clients connected; the host coordinator
    // supervises: liveness verdict live, then completion while clients are out.
    const supervised = await host.client.call<{
      observation: { status: string }
    }>('orchestration.workerShow', { dispatch: dispatch1.result.dispatch!.id })
    expect(supervised.result.observation.status).toBe('live')
    await host.client.call('terminal.send', {
      terminal: worker1,
      text: `ORCA_E2E_WORKER_DONE:${encodeWorkerDoneMarker({
        coordinator: from,
        taskId: task1.result.task.id,
        dispatchId: dispatch1.result.dispatch!.id
      })}`,
      enter: true
    })
    await expect
      .poll(async () => {
        const current = await host.client.call<{
          dispatch: { status: string } | null
        }>('orchestration.dispatchShow', { task: task1.result.task.id })
        return current.result.dispatch?.status
      })
      .toBe('completed')

    // Both clients reconnect with their original pairing identities.
    const reconnectedA = reconnectPairedObserver(pairingA)
    const reconnectedB = reconnectPairedObserver(pairingB)
    clientAClose = reconnectedA.close
    clientBClose = reconnectedB.close
    const afterReconnectA = unwrapRuntimeRpcResponse(
      await reconnectedA.request<{ run: { id: string } | null }>('orchestration.runCurrent', {
        from
      })
    )
    expect(afterReconnectA.run?.id).toBe(runId)
    const seenByB = unwrapRuntimeRpcResponse(
      await reconnectedB.request<{ dispatch: { status: string } | null }>(
        'orchestration.dispatchShow',
        { task: task1.result.task.id }
      )
    )
    expect(seenByB.dispatch?.status).toBe('completed')

    // Structured output readable by both clients while the terminal is live.
    const read1A = unwrapRuntimeRpcResponse(
      await reconnectedA.request<{
        dispatchId: string
        fallbackReason: string | null
        source: string
        sourceIdentity: string
        terminal?: { tail: string[] }
      }>('orchestration.workerRead', { dispatch: dispatch1.result.dispatch!.id })
    )
    const read1B = unwrapRuntimeRpcResponse(
      await reconnectedB.request<{
        source: string
        sourceIdentity: string
        terminal?: { tail: string[] }
      }>('orchestration.workerRead', { dispatch: dispatch1.result.dispatch!.id })
    )
    expect(read1A.sourceIdentity).toBe(read1B.sourceIdentity)
    expect(read1A.source).toBe(read1B.source)
    // Fake agents report no provider session: the fallback must be explicit.
    expect(read1A.fallbackReason).not.toBeNull()
    expect((read1A.terminal?.tail ?? []).join('\n')).toContain(FAKE_ORCHESTRATION_AGENT_MARKER)

    // ── Phase 3: real ask / reply / answer with a second worker ───────
    const task2 = await host.client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: `ACK then ask the coordinator, then complete as fake pi`,
      run: runId,
      callerTerminalHandle: from
    })
    const started2 = await host.client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task2.result.task.id,
      from,
      agent: 'pi',
      timeoutMs: 20_000
    })
    const worker2 = started2.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(worker2).toBeTruthy()
    await expect
      .poll(async () => {
        const read = await host.client.call<{ terminal: { tail: string[] } }>('terminal.read', {
          terminal: worker2,
          limit: 80
        })
        return read.result.terminal.tail.join('\n')
      })
      .toContain('ACK')
    const dispatch2 = await host.client.call<{
      dispatch: { id: string; status: string } | null
    }>('orchestration.dispatchShow', { task: task2.result.task.id })
    expect(dispatch2.result.dispatch?.status).toBe('dispatched')

    await host.client.call('terminal.send', {
      terminal: worker2,
      text: `ORCA_E2E_WORKER_ASK:${encodeWorkerAskMarker({
        options: 'yes,no',
        question: `Confirm fake pi result path`,
        timeoutMs: 45_000,
        to: from
      })}`,
      enter: true
    })
    // The blocking ask runs inside the worker terminal; the coordinator's
    // mailbox receives the question, and paired client A can peek it too.
    type QuestionMessage = { id: string; type: string; body?: string }
    let questionId = ''
    await expect
      .poll(async () => {
        const mailbox = await host.client.call<{ messages: QuestionMessage[] }>(
          'orchestration.check',
          { terminal: from, all: true, types: 'question' }
        )
        const found = mailbox.result.messages.find(
          (message) => message.body === `Confirm fake pi result path`
        )
        questionId = found?.id ?? ''
        return questionId
      })
      .not.toBe('')
    const peekedByA = unwrapRuntimeRpcResponse(
      await reconnectedA.request<{ messages: QuestionMessage[] }>('orchestration.check', {
        terminal: from,
        peek: true,
        types: 'question'
      })
    )
    expect(peekedByA.messages.some((message) => message.id === questionId)).toBe(true)

    const replied = await host.client.call<{ question: { status: string } }>(
      'orchestration.reply',
      { id: questionId, body: 'yes', run: runId, from }
    )
    expect(replied.result.question.status).toBe('answered')
    // The worker's ask call resolves with the answer inside its terminal.
    await expect
      .poll(async () => {
        const read = await host.client.call<{ terminal: { tail: string[] } }>('terminal.read', {
          terminal: worker2,
          limit: 200
        })
        return read.result.terminal.tail.join('\n')
      })
      .toContain('ASK_ANSWER_RECEIVED:yes')
    await expect
      .poll(() => readLedger(ledgerPath).filter((entry) => entry.phase === 'ask'))
      .toEqual([
        expect.objectContaining({
          kind: 'pi',
          askOutcome: 'ASK_ANSWER_RECEIVED:yes',
          status: 0
        })
      ])
    // Task 2 stays active on purpose: Phase 5 stops this live worker.

    // ── Phase 4: observed model comes from hook evidence, not an echo ──
    const shownByB = unwrapRuntimeRpcResponse(
      await reconnectedB.request<{
        observation: {
          observedOptions?: {
            agent?: string
            model?: string
            status: string
            thinkingLevel?: string
          }
          status: string
        }
      }>('orchestration.workerShow', { dispatch: dispatch2.result.dispatch!.id })
    )
    expect(['live', 'exited']).toContain(shownByB.observation.status)
    // The fake worker reported its model through the REAL hook endpoint; the
    // observation must carry that evidence, never the launch selection.
    expect(shownByB.observation.observedOptions).toMatchObject({
      status: 'observed',
      agent: 'pi',
      model: FAKE_HOOK_OBSERVED_MODEL,
      thinkingLevel: FAKE_HOOK_OBSERVED_THINKING
    })

    // ── Phase 5: stop, release, and archived output recovery ──────────
    // workerStop reaches a still-active worker: its terminal must close.
    const stopped = await host.client.call<{ state: string }>('orchestration.workerStop', {
      dispatch: dispatch2.result.dispatch!.id
    })
    expect(stopped.result.state).toBe('stopped')
    await expect
      .poll(async () => {
        const listed = await host.client.call<{ terminals: { handle: string }[] }>(
          'terminal.list',
          {}
        )
        return listed.result.terminals.some((terminal) => terminal.handle === worker2)
      })
      .toBe(false)
    const released2 = await host.client.call<{ state: string }>('orchestration.workerRelease', {
      dispatch: dispatch2.result.dispatch!.id
    })
    expect(['released', 'already_released']).toContain(released2.result.state)

    // Worker 1 already reported completion: release closes its live terminal
    // and freezes the archive; client B recovers the output afterwards.
    const released1 = await host.client.call<{ state: string }>('orchestration.workerRelease', {
      dispatch: dispatch1.result.dispatch!.id
    })
    expect(released1.result.state).toBe('released')
    await expect
      .poll(async () => {
        const listed = await host.client.call<{ terminals: { handle: string }[] }>(
          'terminal.list',
          {}
        )
        return listed.result.terminals.some((terminal) => terminal.handle === worker1)
      })
      .toBe(false)
    const archivedRead = unwrapRuntimeRpcResponse(
      await reconnectedB.request<{
        archived?: boolean
        dispatchId: string
        source: string
        terminal?: { tail: string[] }
      }>('orchestration.workerRead', { dispatch: dispatch1.result.dispatch!.id })
    )
    expect(archivedRead.archived).toBe(true)
    expect((archivedRead.terminal?.tail ?? []).join('\n')).toContain(
      FAKE_ORCHESTRATION_AGENT_MARKER
    )

    // ── Phase 6: released workers never reappear, even with new handles ─
    // The real incident reappeared with NEW terminal handles, so handle
    // blacklisting is a false green: snapshot the base inventory, reconnect
    // BOTH clients, launch a third worker, and prove the inventory equals
    // base + exactly the third worker — never a resurrected old one.
    const baseInventory = (
      await host.client.call<{ terminals: { handle: string; title?: string }[] }>(
        'terminal.list',
        {}
      )
    ).result.terminals.map((terminal) => terminal.handle)
    expect(baseInventory).not.toContain(worker1)
    expect(baseInventory).not.toContain(worker2)
    for (const dispatchId of [dispatch1.result.dispatch!.id, dispatch2.result.dispatch!.id]) {
      const resurfaced = unwrapRuntimeRpcResponse(
        await reconnectedA.request<{ observation: { status: string } }>(
          'orchestration.workerShow',
          { dispatch: dispatchId }
        )
      )
      expect(resurfaced.observation.status).not.toBe('live')
    }
    reconnectedA.close()
    reconnectedB.close()
    const lateA = reconnectPairedObserver(pairingA)
    const lateB = reconnectPairedObserver(pairingB)
    clientAClose = lateA.close
    clientBClose = lateB.close
    const runVisibleLate = unwrapRuntimeRpcResponse(
      await lateA.request<{ run: { id: string } | null }>('orchestration.runCurrent', { from })
    )
    expect(runVisibleLate.run?.id).toBe(runId)
    const task3 = await host.client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: `ACK then complete as fake opencode after the releases`,
      run: runId,
      callerTerminalHandle: from
    })
    const started3 = await host.client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task3.result.task.id,
      from,
      agent: 'opencode',
      timeoutMs: 20_000
    })
    const worker3 = started3.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(worker3).toBeTruthy()
    expect([worker1, worker2]).not.toContain(worker3)
    await expect
      .poll(async () => {
        const read = await host.client.call<{ terminal: { tail: string[] } }>('terminal.read', {
          terminal: worker3,
          limit: 80
        })
        return read.result.terminal.tail.join('\n')
      })
      .toContain('ACK')
    const inventoryWithThird = (
      await host.client.call<{ terminals: { handle: string }[] }>('terminal.list', {})
    ).result.terminals.map((terminal) => terminal.handle)
    expect(inventoryWithThird.filter((handle) => !baseInventory.includes(handle))).toEqual([
      worker3
    ])
    const dispatch3 = await host.client.call<{
      dispatch: { id: string; status: string } | null
    }>('orchestration.dispatchShow', { task: task3.result.task.id })
    expect(dispatch3.result.dispatch?.status).toBe('dispatched')
    expect(dispatch3.result.dispatch!.id).not.toBe(dispatch1.result.dispatch!.id)
    expect(dispatch3.result.dispatch!.id).not.toBe(dispatch2.result.dispatch!.id)
    const thirdSeenByB = unwrapRuntimeRpcResponse(
      await lateB.request<{ dispatch: { status: string } | null }>('orchestration.dispatchShow', {
        task: task3.result.task.id
      })
    )
    expect(thirdSeenByB.dispatch?.status).toBe('dispatched')
    const stopped3 = await host.client.call<{ state: string }>('orchestration.workerStop', {
      dispatch: dispatch3.result.dispatch!.id
    })
    expect(stopped3.result.state).toBe('stopped')
    const released3 = await host.client.call<{ state: string }>('orchestration.workerRelease', {
      dispatch: dispatch3.result.dispatch!.id
    })
    expect(['released', 'already_released']).toContain(released3.result.state)
    await expect
      .poll(async () => {
        const listed = await host.client.call<{ terminals: { handle: string }[] }>(
          'terminal.list',
          {}
        )
        return listed.result.terminals.map((terminal) => terminal.handle)
      })
      .toEqual(baseInventory)

    // ── Phase 6b: stop on an already-registered close settles nothing ──
    // Dispatch 1 completed and released; a late stop must report the settled
    // receipt (alreadySettled, no terminal process changed), never claim a
    // fresh stop and never resurrect the terminal. The ptyKilled:false branch
    // itself stays unit-covered (worker-stop-liveness-verdict: "does not
    // settle a bare false close as stopped"); the fake agent never dies on
    // its own, so no E2E fixture can stage that branch honestly.
    const lateStop = await host.client.call<{
      alreadySettled: boolean
      processAction: string
      state: string
    }>('orchestration.workerStop', { dispatch: dispatch1.result.dispatch!.id })
    expect(lateStop.result.alreadySettled).toBe(true)
    expect(lateStop.result.processAction).toBe('none')
    const inventoryAfterLateStop = (
      await host.client.call<{ terminals: { handle: string }[] }>('terminal.list', {})
    ).result.terminals.map((terminal) => terminal.handle)
    expect(inventoryAfterLateStop).toEqual(baseInventory)
  } finally {
    if (savedCliEntry === undefined) {
      delete process.env.ORCA_E2E_CLI_ENTRY
    } else {
      process.env.ORCA_E2E_CLI_ENTRY = savedCliEntry
    }
    if (savedLedger === undefined) {
      delete process.env.ORCA_E2E_FAKE_AGENT_LEDGER
    } else {
      process.env.ORCA_E2E_FAKE_AGENT_LEDGER = savedLedger
    }
    clientBClose?.()
    clientAClose?.()
    await host.dispose()
    rmSync(scratch, { recursive: true, force: true })
  }
})
