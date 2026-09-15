import { AgentHookServerStatusApplication } from './server-status-application'
import type { EnrichedAgentHookEventPayload } from './server-types'

export abstract class AgentHookServerStatusEvidence extends AgentHookServerStatusApplication {
  protected refreshTerminalStatusEvidence(
    previous: EnrichedAgentHookEventPayload,
    mutationBefore?: EnrichedAgentHookEventPayload,
    emitEnrichedStatus = false
  ): void {
    const connectionClearWatermark = previous.connectionId
      ? this.connectionTimestampWatermarkById.get(previous.connectionId)
      : undefined
    const now = Math.max(Date.now(), (connectionClearWatermark ?? -1) + 1)
    if (previous.connectionId) {
      this.connectionTimestampWatermarkById.set(previous.connectionId, now)
    }
    const {
      receivedAt: _receivedAt,
      evidenceObservedAt: _evidenceObservedAt,
      stateStartedAt,
      observation: _observation,
      restoredUnconfirmed: _restoredUnconfirmed,
      isReplay: _isReplay,
      ...payload
    } = previous
    const refreshed: EnrichedAgentHookEventPayload = {
      ...payload,
      receivedAt: now,
      evidenceObservedAt: now,
      stateStartedAt,
      observation: this.stampObservation(payload, 'osc', now)
    }
    const firstRuntimeObservation = !this.runtimeObservedStatusPaneKeys.has(refreshed.paneKey)
    this.runtimeObservedStatusPaneKeys.add(refreshed.paneKey)
    this.state.lastStatusByPaneKey.set(refreshed.paneKey, refreshed)
    this.commitStatusRowMutation(mutationBefore ?? previous, refreshed)
    this.scheduleStatusPersist()
    // User-hidden resume identity must not renew awake or mobile freshness leases.
    if (refreshed.providerSessionOnly === true) {
      return
    }
    if (firstRuntimeObservation) {
      this.notifyStatusChangeListeners()
    }
    this.emitStatusFreshnessObservation({
      paneKey: refreshed.paneKey,
      state: refreshed.payload.state,
      receivedAt: refreshed.receivedAt,
      observedInCurrentRuntime: true,
      ...(refreshed.worktreeId ? { worktreeId: refreshed.worktreeId } : {}),
      ...(refreshed.terminalHandle ? { terminalHandle: refreshed.terminalHandle } : {})
    })
    if (emitEnrichedStatus) {
      this.emitEnrichedStatus(refreshed)
    }
  }

  // Every status emit must reach plugins as well as the main-window fanout.
  protected emitEnrichedStatus(enriched: EnrichedAgentHookEventPayload): void {
    this.onAgentStatus?.(enriched)
    for (const listener of this.enrichedStatusListeners) {
      try {
        listener(enriched)
      } catch (err) {
        console.error('[agent-hooks] enriched status listener threw', err)
      }
    }
  }
}
