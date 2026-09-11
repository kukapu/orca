import { z } from 'zod'
import { ORCHESTRATION_WORKER_READ_SOURCES } from '../../../../../../shared/orchestration-worker-output'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { RemoteDispatchAttachmentRow } from '../../../../orchestration/types'
import { defineMethod, type RpcMethod } from '../../../core'
import { OptionalFiniteNumber, requiredString } from '../../../schemas'
import { mapWithConcurrency } from '../../../../../../shared/map-with-concurrency'
import { orchestrationTimestampToMs, readExactWorkerOutput } from '../worker/worker-output'
import {
  buildWorkerObservedOptionsObservation,
  workerIdentityNotExactObservedOptions
} from '../../../../orchestration/worker-observed-options'
import { inspectRemoteAttachment, requireHomeAttachment } from './federation-attachment-observation'
import {
  readRemoteAttachmentArchive,
  releaseRemoteAttachment
} from './federated-worker-release-host'
import { ORCHESTRATION_FEDERATION_STOP_METHODS } from './federation-control-stop'

const FederationDispatchParams = z.object({
  dispatchId: requiredString('Missing Dispatch ID')
})
const FederationReadParams = FederationDispatchParams.extend({
  cursor: OptionalFiniteNumber,
  limit: OptionalFiniteNumber
})
const FederationOutputReadParams = FederationDispatchParams.extend({
  cursor: z.union([z.number().int().nonnegative(), z.string().min(1).max(2_048)]).optional(),
  limit: OptionalFiniteNumber,
  source: z.enum(ORCHESTRATION_WORKER_READ_SOURCES).optional()
})
const FederationFleetSnapshotParams = z.object({
  dispatchIds: z.array(requiredString('Missing Dispatch ID')).min(1).max(100)
})

export const ORCHESTRATION_FEDERATION_CONTROL_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.federationFleetSnapshot',
    params: FederationFleetSnapshotParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      const items = await mapWithConcurrency(params.dispatchIds, 16, async (dispatchId) => {
        requireHomeAttachment(runtime, dispatchId, authenticatedCallerFingerprint)
        const observation = await inspectRemoteAttachment(runtime, dispatchId)
        return {
          dispatchId,
          observation: {
            status:
              observation.status === 'live' || observation.status === 'exited'
                ? observation.status
                : 'unverifiable',
            exactWorker: observation.exact,
            ...(observation.reason ? { reason: observation.reason } : {})
          }
        }
      })
      return { runtimeEpoch: runtime.getRuntimeId(), items }
    }
  }),
  defineMethod({
    name: 'orchestration.federationRelease',
    params: FederationDispatchParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      const attachment = requireHomeAttachment(
        runtime,
        params.dispatchId,
        authenticatedCallerFingerprint
      )
      const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
      return releaseRemoteAttachment({ runtime, attachment, observation })
    }
  }),
  defineMethod({
    name: 'orchestration.federationShow',
    params: FederationDispatchParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      const attachment = requireHomeAttachment(
        runtime,
        params.dispatchId,
        authenticatedCallerFingerprint
      )
      const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
      // Why: evaluated here on the executing host — the one that owns the terminal
      // and received the hook events — never on the Run home or a desktop client.
      const observedOptions =
        observation.exact && attachment.terminal_handle
          ? buildWorkerObservedOptionsObservation({
              selection: runtime.getExactWorkerObservedOptions(
                attachment.terminal_handle,
                orchestrationTimestampToMs(attachment.created_at)
              )
            })
          : workerIdentityNotExactObservedOptions()
      return {
        dispatchId: params.dispatchId,
        runtimeEpoch: runtime.getRuntimeId(),
        attachment: exposeRemoteAttachment(attachment),
        terminal: observation.exact ? observation.terminal : null,
        observation: {
          status: observation.status,
          exactWorker: observation.exact,
          ...(observation.reason ? { reason: observation.reason } : {}),
          ...(observation.agentWait !== undefined ? { agentWait: observation.agentWait } : {}),
          observedOptions
        }
      }
    }
  }),
  defineMethod({
    name: 'orchestration.federationRead',
    params: FederationReadParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      requireHomeAttachment(runtime, params.dispatchId, authenticatedCallerFingerprint)
      const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
      // Why `=== 'exited'` rather than `!== 'live'`: the other non-live
      // statuses are already covered by the two guards, and an unverifiable
      // terminal is still readable — losing stop-contact is not an exit.
      if (!observation.exact || !observation.terminal || observation.status === 'exited') {
        throw new OrchestrationError(
          'worker_identity_changed',
          `Remote Dispatch ${params.dispatchId} no longer resolves to its exact process.`
        )
      }
      return {
        dispatchId: params.dispatchId,
        runtimeEpoch: runtime.getRuntimeId(),
        terminal: await runtime.readTerminal(observation.terminal.handle, {
          cursor: params.cursor,
          limit: params.limit
        })
      }
    }
  }),
  defineMethod({
    name: 'orchestration.federationReadOutput',
    params: FederationOutputReadParams,
    handler: async (params, { runtime, authenticatedCallerFingerprint }) => {
      const attachment = requireHomeAttachment(
        runtime,
        params.dispatchId,
        authenticatedCallerFingerprint
      )
      const storedArchive = runtime
        .getOrchestrationDb()
        .getWorkerTerminalArchive(attachment.dispatch_id)
      if (storedArchive) {
        const archivedObservation =
          attachment.stage === 'released'
            ? null
            : await inspectRemoteAttachment(runtime, params.dispatchId)
        const output = await readRemoteAttachmentArchive({
          runtime,
          attachment,
          source: params.source,
          cursor: params.cursor,
          limit: params.limit,
          liveness:
            attachment.stage === 'released' || archivedObservation?.status === 'exited'
              ? 'exited'
              : archivedObservation?.exact && archivedObservation.terminal
                ? archivedObservation.status === 'live'
                  ? 'live'
                  : 'unverifiable'
                : 'unverifiable'
        })
        if (output) {
          return {
            dispatchId: params.dispatchId,
            runtimeEpoch: runtime.getRuntimeId(),
            output
          }
        }
      }
      const observation = await inspectRemoteAttachment(runtime, params.dispatchId)
      if (!observation.exact || !observation.terminal) {
        throw new OrchestrationError(
          'worker_identity_changed',
          `Remote Dispatch ${params.dispatchId} no longer resolves to its exact process.`
        )
      }
      const output = await readExactWorkerOutput({
        runtime,
        dispatchId: params.dispatchId,
        terminalHandle: observation.terminal.handle,
        workerState: attachment.state,
        terminalStatus:
          observation.status === 'exited'
            ? 'exited'
            : observation.status === 'unverifiable'
              ? 'unknown'
              : 'running',
        terminalLiveness:
          observation.status === 'unverifiable'
            ? 'unverifiable'
            : observation.status === 'exited'
              ? 'exited'
              : 'live',
        attachedAt: attachment.created_at,
        source: params.source,
        cursor: params.cursor,
        limit: params.limit
      })
      const afterRead = await inspectRemoteAttachment(runtime, params.dispatchId)
      if (!afterRead.exact) {
        throw new OrchestrationError(
          'worker_identity_changed',
          `Remote Dispatch ${params.dispatchId} changed process while output was read.`
        )
      }
      return {
        dispatchId: params.dispatchId,
        runtimeEpoch: runtime.getRuntimeId(),
        output
      }
    }
  }),
  ...ORCHESTRATION_FEDERATION_STOP_METHODS
]

function exposeRemoteAttachment(attachment: RemoteDispatchAttachmentRow) {
  return {
    ...attachment,
    effects: JSON.parse(attachment.effects) as unknown[],
    residualResources: JSON.parse(attachment.residual_resources) as unknown[]
  }
}
