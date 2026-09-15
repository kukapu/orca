import { parseFederatedWorkerReportOutcome } from '../../../../orchestration/db/federated-worker-report-outcome'
import { defineMethod } from '../../../core'
import { FederationDispatchParams } from '../../../../../../shared/rpc-contract/orchestration-federation-control-params'
import { describeUnconfirmedAgentStop } from '../../../../../../shared/pty-liveness-verdict'
import { inspectRemoteAttachment, requireHomeAttachment } from './federation-attachment-observation'

export const ORCHESTRATION_FEDERATION_STOP_METHODS = [
  defineMethod({
    name: 'orchestration.federationStop',
    params: FederationDispatchParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      const attachment = requireHomeAttachment(
        runtime,
        params.dispatchId,
        authenticatedCallerFingerprint
      )
      const db = runtime.getOrchestrationDb()
      // Why: a worker whose prompt went unobserved may have finished and queued its own
      // report before the Run home asked to stop it. That first-hand report outranks the
      // stop request; closing the terminal would strand the queued settlement. Only a
      // retained capability can have queued one, so the authority reading applies here.
      if (db.isUnobservedPromptAttachment(attachment, { requireRetainedCapability: true })) {
        const pendingReport = db
          .listPendingFederationRelay(params.dispatchId, 'to_home')
          .find((item) => item.kind === 'worker_done')
        const pendingOutcome = pendingReport
          ? parseFederatedWorkerReportOutcome(pendingReport.payload)
          : undefined
        if (pendingOutcome) {
          return {
            dispatchId: params.dispatchId,
            state: pendingOutcome,
            alreadySettled: false,
            processAction: 'none'
          }
        }
      }
      const begun = db.beginRemoteAttachmentStop(params.dispatchId)
      if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(begun.state)) {
        return {
          dispatchId: params.dispatchId,
          state: begun.state,
          alreadySettled: true,
          processAction: 'none'
        }
      }
      const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
      if (!observation.exact || !observation.terminal) {
        const attachment = db.markRemoteAttachmentStopUnknown(
          params.dispatchId,
          `The recorded worker process is ${observation.status}; no terminal was closed.`
        )
        return {
          dispatchId: params.dispatchId,
          state: attachment.state,
          alreadySettled: false,
          processAction: 'none',
          lastError: attachment.last_error
        }
      }
      try {
        const close = await runtime.closeTerminal(observation.terminal.handle)
        if (!close.ptyKilled) {
          // The tab is retired but the process was never confirmed stopped, so
          // the coordinator must not be told this dispatch reached 'stopped'.
          const attachment = db.markRemoteAttachmentStopUnknown(
            params.dispatchId,
            describeUnconfirmedAgentStop(close)
          )
          return {
            dispatchId: params.dispatchId,
            state: attachment.state,
            alreadySettled: false,
            processAction: 'closed_agent_terminal',
            lastError: attachment.last_error,
            close
          }
        }
        const attachment = db.settleRemoteAttachmentStop(params.dispatchId)
        return {
          dispatchId: params.dispatchId,
          state: attachment.state,
          alreadySettled: false,
          processAction: 'closed_agent_terminal',
          close
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const attachment = db.markRemoteAttachmentStopUnknown(params.dispatchId, reason)
        return {
          dispatchId: params.dispatchId,
          state: attachment.state,
          alreadySettled: false,
          processAction: 'unknown',
          lastError: reason
        }
      }
    }
  })
]
