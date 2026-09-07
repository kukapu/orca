import type { TuiAgent } from '../../../../../../shared/tui-agent'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { assertCreatedWorkerComposerReady } from './worker-composer-gate'
import {
  assertWorkerTuiIdleSatisfied,
  persistGatedSetupSpawnFailure,
  persistWorkerReadinessStage,
  persistWorkerSetupWaitOutcome,
  type WorkerSetupStageArgs
} from './worker-setup-gate'

/** Terminal-born workers pass the whole readiness gauntlet — gated spawn,
 *  TUI idle, and the OpenCode composer marker — inside one shared budget.
 *  Structured sessions skip it: they are ready on attach. */
export async function runWorkerTerminalReadinessGate(args: {
  runtime: OrcaRuntimeService
  setupStage: WorkerSetupStageArgs
  structuredSession: unknown
  agent: TuiAgent | undefined
  reusedTerminal: string | undefined
  timeoutMs: number
  onStage: (stage: string) => void
}): Promise<void> {
  const { setupStage } = args
  if (persistGatedSetupSpawnFailure(setupStage)) {
    args.onStage('setup_start')
    throw new Error('Setup terminal failed to start before the gated agent launch.')
  }
  persistWorkerReadinessStage(setupStage)
  args.onStage('agent_readiness')
  // Structured sessions are ready on attach; only terminal agents need a TUI idle check.
  if (args.structuredSession) {
    return
  }
  const readinessStartedAt = Date.now()
  const wait = await args.runtime.waitForTerminal(setupStage.terminalHandle, {
    condition: 'tui-idle',
    timeoutMs: args.timeoutMs
  })
  persistWorkerSetupWaitOutcome({ ...setupStage, wait })
  assertWorkerTuiIdleSatisfied(wait, setupStage.setup, () => {
    args.onStage('setup_wait')
  })
  const remainingMs = Math.max(0, args.timeoutMs - (Date.now() - readinessStartedAt))
  await assertCreatedWorkerComposerReady(
    args.runtime,
    setupStage.terminalHandle,
    args.agent,
    args.reusedTerminal,
    remainingMs
  )
}
