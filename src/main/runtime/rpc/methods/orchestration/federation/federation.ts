import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { defineMethod } from '../../../core'
import { assertOrchestrationWorktreeCreationSupported } from '../worker/folder-worktree-placement'
import { FederationAttachStartParams } from './federation-start-schema'
import { prepareFederationAttachmentWorkerStart } from '../worker/worker-start-validation'
import {
  isWorkerStartTimeoutWithinTimerLimit,
  resolveWorkerStartReadinessTimeoutMs
} from '../../../../../../shared/orchestration-timing-budgets'
import { assertWorkerStartTaskSpecWithinPromptBudget } from '../worker/worker-start-prompt-budget'
import { completeFederatedAttachStart } from './federation-attach-start'

export const ORCHESTRATION_FEDERATION_ATTACH_METHODS = [
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
        // The worker execution host must validate availability before creating an attachment.
        if (createsWorktree) {
          await runtime.assertAgentLaunchableOnRepoHost(agent, params.repo as string)
        } else if (params.worktree) {
          await runtime.assertAgentLaunchableOnWorkspaceHost(agent, params.worktree)
        }
      }

      const db = runtime.getOrchestrationDb()
      db.createRemoteDispatchAttachment({
        runId: params.runId,
        dispatchId: params.dispatchId,
        taskId: params.taskId,
        homePeerFingerprint: orchestrationMutation.callerFingerprint,
        protocolVersion: params.protocolVersion,
        runtimeEpoch: runtime.getRuntimeId(),
        depth: params.depth,
        mutationReceipt: orchestrationMutation
      })
      return completeFederatedAttachStart({
        runtime,
        db,
        params,
        createsWorktree,
        agent,
        launch,
        orchestrationMutation,
        readinessTimeoutMs
      })
    }
  })
]
