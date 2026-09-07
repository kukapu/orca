import type { TuiAgent } from '../../../../shared/tui-agent'

type WorkerComposerRuntime = {
  waitForWorkerAgentComposerReady(
    handle: string,
    agent: TuiAgent,
    options?: { timeoutMs?: number }
  ): Promise<boolean>
}

export async function assertCreatedWorkerComposerReady(
  runtime: WorkerComposerRuntime,
  terminalHandle: string,
  agent: TuiAgent | undefined,
  reusedTerminal: string | undefined,
  remainingTimeoutMs: number
): Promise<void> {
  if (reusedTerminal || agent !== 'opencode') {
    return
  }
  const composerReady = await runtime.waitForWorkerAgentComposerReady(terminalHandle, agent, {
    timeoutMs: remainingTimeoutMs
  })
  if (!composerReady) {
    throw new Error('Agent composer did not become ready (startup render marker missing).')
  }
}
