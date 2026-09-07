import type { TuiAgent } from '../../shared/tui-agent'
import './agent-prompt-submission-runtime-test-mocks'
import { OrcaRuntimeService } from './orca-runtime'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'

export const AGENT_PROMPT_TEST_WORKTREE_PATH = '/tmp/worktree-a'
export const AGENT_PROMPT_TEST_WORKTREE_ID = 'repo-1::/tmp/worktree-a'

export type AgentPromptSubmissionControllerOverrides = {
  getForegroundProcess?: (ptyId: string) => Promise<string | null>
  spawn?: () => Promise<{ id: string }>
}

export async function createAgentPromptSubmissionRuntime(
  onWrite: (runtime: OrcaRuntimeService, data: string, writeIndex: number) => void,
  launchAgent: TuiAgent = 'aider',
  overrides: AgentPromptSubmissionControllerOverrides = {}
): Promise<{ runtime: OrcaRuntimeService; handle: string; writes: string[] }> {
  const runtime = new OrcaRuntimeService(makeStore() as never)
  const writes: string[] = []
  runtime.setPtyController({
    spawn: overrides.spawn ?? (async () => ({ id: 'pty-prompt' })),
    write: (_ptyId, data) => {
      writes.push(data)
      onWrite(runtime, data, writes.length)
      return true
    },
    kill: () => true,
    getForegroundProcess: overrides.getForegroundProcess ?? (async () => null)
  })
  const terminal = await runtime.createTerminal(`path:${AGENT_PROMPT_TEST_WORKTREE_PATH}`, {
    launchAgent
  })
  return { runtime, handle: terminal.handle, writes }
}
