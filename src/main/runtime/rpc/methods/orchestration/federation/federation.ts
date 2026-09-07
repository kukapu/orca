import { buildDispatchPreamble } from '../../../../orchestration/preamble'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { defineMethod, type RpcMethod } from '../../../core'
import { assertOrchestrationWorktreeCreationSupported } from '../worker/folder-worktree-placement'
import type { FederationEffect } from './federation-effects'
import { resolveFederationAttachTopology } from './federation-attach-topology'
import type { WorkerSetupReceipt } from '../worker/worker-topology'
import {
  monitorFederatedSetup,
  persistFederatedReadinessStage,
  persistFederatedSetupSpawnFailure,
  persistFederatedSetupWaitOutcome
} from './federation-setup'
import { FederationAttachStartParams } from './federation-start-schema'
import { failFederatedAttachmentWithReceipt } from './federation-start-receipt'
import { prepareFederationAttachmentWorkerStart } from '../worker/worker-start-validation'
import {
  isWorkerStartTimeoutWithinTimerLimit,
  resolveWorkerStartReadinessTimeoutMs
} from '../../../../../../shared/orchestration-timing-budgets'
import { assertWorkerStartTaskSpecWithinPromptBudget } from '../worker/worker-start-prompt-budget'

export const ORCHESTRATION_FEDERATION_ATTACH_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.federationAttachStart',
    params: FederationAttachStartParams,
    handler: async (params, { runtime, orchestrationMutation }) => {
      if (!orchestrationMutation) {
        throw new OrchestrationError(
          'invalid_argument',
          'Federated worker attachment requires a durable retry request.'
        )
      }
      await assertWorkerStartTaskSpecWithinPromptBudget(params.taskSpec)
      if (!isWorkerStartTimeoutWithinTimerLimit(params.timeoutMs)) {
        throw new OrchestrationError(
          'invalid_argument',
          '--timeout-ms is too large for worker-start transport grace; the derived timeout must fit within the timer limit.'
        )
      }
      const readinessTimeoutMs = resolveWorkerStartReadinessTimeoutMs(params.timeoutMs)
      if (params.worktree === 'current' || params.worktree === 'new-child') {
        throw new OrchestrationError(
          'invalid_argument',
          'A remote worker requires an exact existing worktree or new-top-level.'
        )
      }
      const createsWorktree = params.worktree === 'new-top-level'
      const { agent, launch } = prepareFederationAttachmentWorkerStart({
        params,
        createsWorktree,
        runtime
      })
      if (createsWorktree) {
        await assertOrchestrationWorktreeCreationSupported({
          runtime,
          repoSelector: params.repo as string,
          existingPlacement: 'an exact existing folder workspace'
        })
      }

      if (agent && !params.terminal) {
        // Fence on the execution host before creating the remote attachment (#17943).
        if (createsWorktree) {
          await runtime.assertAgentLaunchableOnRepoHost(agent, params.repo as string)
        } else if (params.worktree) {
          await runtime.assertAgentLaunchableOnWorkspaceHost(agent, params.worktree)
        }
      }

      const db = runtime.getOrchestrationDb()
      db.createRemoteDispatchAttachment({
        dispatchId: params.dispatchId,
        taskId: params.taskId,
        homePeerFingerprint: orchestrationMutation.callerFingerprint,
        protocolVersion: params.protocolVersion,
        runtimeEpoch: runtime.getRuntimeId(),
        depth: params.depth,
        mutationReceipt: orchestrationMutation
      })
      const effects: FederationEffect[] = []
      let failedStage = createsWorktree ? 'worktree_create' : 'worktree_resolve'
      let setup: WorkerSetupReceipt = {
        requested: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
        effective: createsWorktree ? (params.setup ?? 'run') : 'not_applicable',
        source: createsWorktree
          ? (params.setupSource ?? (params.setup ? 'explicit_request' : 'orchestration_default'))
          : 'existing_worktree',
        hookFound: false,
        startupPolicy: 'start-immediately',
        state: createsWorktree ? 'not_configured' : 'not_applicable'
      }
      try {
        const topology = await resolveFederationAttachTopology({
          runtime,
          params,
          createsWorktree,
          agent,
          launch,
          effects,
          onStage: (stage) => {
            failedStage = stage
          }
        })
        const { worktree, terminalHandle } = topology
        setup = topology.setup
        const setupStage = {
          db,
          dispatchId: params.dispatchId,
          worktreeId: worktree.id,
          terminalHandle,
          setup,
          effects
        }
        if (persistFederatedSetupSpawnFailure(setupStage)) {
          failedStage = 'setup_start'
          throw new Error('Setup terminal failed to start before the gated agent launch.')
        }
        persistFederatedReadinessStage(setupStage)
        failedStage = 'agent_readiness'
        const wait = await runtime.waitForTerminal(terminalHandle, {
          condition: 'tui-idle',
          timeoutMs: readinessTimeoutMs
        })
        persistFederatedSetupWaitOutcome({ ...setupStage, wait })
        if (!wait.satisfied) {
          if (setup.state === 'failed') {
            failedStage = 'setup_wait'
          }
          throw new Error(
            wait.blockedReason
              ? `Agent startup blocked: ${wait.blockedReason}`
              : `Agent did not become ready (${wait.status}).`
          )
        }
        const authority = runtime.getOrchestrationDispatchAuthority(terminalHandle)
        const paneKey = authority?.paneKey ?? runtime.getTerminalPaneKey(terminalHandle)
        const processIncarnation =
          authority?.processIncarnation ?? runtime.getTerminalProcessIncarnation(terminalHandle)
        if (!paneKey || !processIncarnation) {
          throw new Error('stable_pane_required')
        }
        const capability = db.prepareRemoteAttachmentAuthority({
          dispatchId: params.dispatchId,
          paneKey,
          processIncarnation,
          worktreeId: worktree.id,
          terminalHandle,
          setupState: setup.state,
          effects,
          hostScope: authority?.hostScope ? JSON.stringify(authority.hostScope) : null,
          terminalOwnership: params.terminal ? 'external' : 'created'
        })
        failedStage = 'dispatch_input'
        const prompt = await runtime.sendTerminalAgentPrompt(
          terminalHandle,
          buildDispatchPreamble({
            taskId: params.taskId,
            dispatchId: params.dispatchId,
            taskSpec: params.taskSpec,
            coordinatorHandle: 'Run home (relayed by Orca)',
            workerHandle: terminalHandle,
            dispatchCapability: capability,
            devMode: params.devMode,
            // Why the worker host's own setting: enforcement runs here, with this
            // host's code, against this host's cap.
            canDispatchSubWorkers: (params.depth ?? 1) < runtime.getNestedWorkerMaxDepth(),
            cliCommand: runtime.getTerminalOrchestrationCliCommand(terminalHandle)
          }),
          {
            acceptQueued: true,
            observationTimeoutMs: 0,
            requestId: orchestrationMutation.requestId
          }
        )
        effects.push({
          kind: 'dispatch_input',
          role: 'agent',
          id: terminalHandle,
          state: 'accepted'
        })
        const attachment = db.markRemoteAttachmentReady(params.dispatchId, effects)
        monitorFederatedSetup({ ...setupStage, runtime })
        return {
          dispatchId: params.dispatchId,
          state: attachment.state,
          stage: attachment.stage,
          runtimeEpoch: runtime.getRuntimeId(),
          worktreeId: worktree.id,
          terminalHandle,
          setup,
          launch: launch.receipt,
          effects,
          ...(prompt.prompt ? { prompt: prompt.prompt } : {}),
          residualResources: []
        }
      } catch (error) {
        return failFederatedAttachmentWithReceipt({
          db,
          dispatchId: params.dispatchId,
          runtimeEpoch: runtime.getRuntimeId(),
          failedStage,
          error,
          setup,
          launch: launch.receipt
        })
      }
    }
  })
]
