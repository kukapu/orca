import type { TuiAgent } from '../../../../../../shared/tui-agent'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import {
  appendFederationSetupEffect,
  appendFederationTerminalEffects,
  type FederationEffect
} from './federation-effects'
import type { WorkerSetupReceipt } from '../worker/worker-topology'
import type { FederationAttachStartInput } from './federation-start-schema'
import type { WorkerStartLaunch } from '../worker/worker-start-validation'

/** Resolves the remote attachment's worktree, agent terminal and setup receipt:
 *  new-top-level creation with agent-first provisioning, or validation of a
 *  reused worktree/terminal on the execution host. */
export async function resolveFederationAttachTopology(args: {
  runtime: OrcaRuntimeService
  params: FederationAttachStartInput
  createsWorktree: boolean
  agent: TuiAgent | undefined
  launch: WorkerStartLaunch
  effects: FederationEffect[]
  onStage: (stage: string) => void
}): Promise<{
  worktree: { id: string }
  terminalHandle: string
  setup: WorkerSetupReceipt
}> {
  const { runtime, params, createsWorktree, agent, launch, effects } = args
  let terminalHandle = params.terminal
  const setupSource = createsWorktree
    ? (params.setupSource ?? (params.setup ? 'explicit_request' : 'orchestration_default'))
    : 'existing_worktree'
  let setup: WorkerSetupReceipt = {
    requested: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
    effective: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
    source: setupSource,
    hookFound: false,
    startupPolicy: 'start-immediately',
    state: createsWorktree ? 'not_configured' : 'not_applicable'
  }
  if (createsWorktree) {
    const db = runtime.getOrchestrationDb()
    db.recordRemoteAttachmentStage({
      dispatchId: params.dispatchId,
      stage: 'worktree_creating'
    })
    const setupDecision = params.setup ?? 'run'
    const created = await runtime.createManagedWorktree({
      repoSelector: params.repo as string,
      name: params.name as string,
      baseBranch: params.baseBranch,
      displayName: params.displayName,
      displayNameKind: params.displayNameKind,
      comment: params.comment,
      // setupDecision runs setup without the legacy runHooks activation side effect.
      runHooks: false,
      setupDecision,
      awaitTerminalProvisioning: true,
      observeSetupCompletion: true,
      createdWithAgent: agent as TuiAgent,
      startupAgent: agent as TuiAgent,
      ...(launch.preferences ? { startupLaunchPreferences: launch.preferences } : {}),
      activate: false,
      lineage: { noParent: true }
    })
    let worktree = created.worktree
    terminalHandle = created.startupTerminal?.handle
    effects.push({
      kind: 'worktree',
      action: 'created_top_level',
      id: created.worktree.id
    })
    setup = {
      requested: setupDecision,
      effective: setupDecision,
      source: setupSource,
      hookFound: created.setupReceipt?.hookFound ?? false,
      startupPolicy: created.setupReceipt?.startupPolicy ?? 'start-immediately',
      state: created.setupReceipt?.state ?? 'not_configured'
    }
    if (!terminalHandle) {
      throw new Error(created.warning ?? 'Agent-first worktree creation returned no terminal.')
    }
    const listed = await runtime.listTerminals(`id:${created.worktree.id}`, undefined, {
      includeVisualLayouts: false
    })
    appendFederationTerminalEffects(
      effects,
      listed.terminals,
      terminalHandle,
      created.setupReceipt?.terminalHandle
    )
    appendFederationSetupEffect(effects, setup)
    return { worktree, terminalHandle, setup }
  }
  const worktree = await runtime.showManagedTerminalWorkspace(params.worktree).catch(() => {
    throw new OrchestrationError(
      'worktree_not_found_on_server',
      `Worktree ${params.worktree} was not found on the selected worker server.`
    )
  })
  effects.push(
    { kind: 'worktree', action: 'reused', id: worktree.id },
    { kind: 'setup', action: 'not_applicable', state: 'not_applicable' }
  )
  if (terminalHandle) {
    const terminal = await runtime.showTerminal(terminalHandle)
    if (terminal.worktreeId !== worktree.id) {
      throw new OrchestrationError(
        'terminal_worktree_mismatch',
        `Terminal ${terminalHandle} does not belong to worktree ${worktree.id}.`
      )
    }
    if (!(await runtime.isTerminalRunningAgent(terminalHandle))) {
      throw new OrchestrationError(
        'agent_unconfigured',
        `Terminal ${terminalHandle} is not running a recognized agent.`
      )
    }
    effects.push({
      kind: 'terminal',
      role: 'agent',
      action: 'reused',
      id: terminalHandle
    })
    return { worktree, terminalHandle, setup }
  }
  args.onStage('terminal_create')
  const terminal = await runtime.createTerminal(`id:${worktree.id}`, {
    // Why: agent ids are not shell commands (`cursor` is the desktop app,
    // its CLI is `cursor-agent`); resolve through the TUI agent config.
    startupAgent: agent as TuiAgent,
    ...(launch.preferences ? { launchPreferences: launch.preferences } : {}),
    title: `worker-${params.taskId}`,
    presentation: 'background'
  })
  terminalHandle = terminal.handle
  effects.push({
    kind: 'terminal',
    role: 'agent',
    action: 'created',
    id: terminal.handle
  })
  return { worktree, terminalHandle, setup }
}
