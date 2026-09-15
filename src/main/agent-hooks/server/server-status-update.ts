import {
  reconcileRemoteCodexState,
  markCodexLeadTurnInterrupted
} from '../../../shared/agent-hook-listener/providers/codex-state'
import {
  resolveAgentStatusIdentity,
  shouldSuppressInheritedTerminalStatus
} from '../../../shared/agent-status-identity'
import { INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS } from './server-constants'
import type { AgentHookObservedOptionsRow, EnrichedAgentHookEventPayload } from './server-types'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import type { AgentStatusObservationOrigin } from '../../../shared/agent-status-observation'
import {
  attachClaudeChildOnlyBoundary,
  attachClaudePermissionToolUseId,
  invalidateClaudeChildOnlyBoundary,
  shouldKeepClaudePermissionVisible
} from './server-claude-status-rules'
import { isStaleGrokTurnEnd } from './server-grok-status-rules'
import { isToolProgressWorkingAfterInterrupt } from './server-status-identity'
import { MAX_REMEMBERED_OBSERVED_OPTIONS } from './server-status-application'
import { AgentHookServerStatusEvidence } from './server-status-evidence'

export abstract class AgentHookServerStatusUpdate extends AgentHookServerStatusEvidence {
  protected applyNormalizedStatus(
    payload: AgentHookEventPayload,
    onAccepted?: () => void,
    origin: AgentStatusObservationOrigin = 'hook',
    observedAt?: number,
    mutationBefore?: EnrichedAgentHookEventPayload
  ): EnrichedAgentHookEventPayload {
    if (payload.hookEventName === 'UserPromptSubmit') {
      // Why: the prompt boundary is authoritative even when text is unchanged; its next OSC working row must not inherit the prior cron/background turn stamp.
      this.activeHookTurnCompletedAtByPaneKey.delete(payload.paneKey)
    }
    let previous = this.state.lastStatusByPaneKey.get(payload.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    const rowBefore = mutationBefore ?? previous
    const terminalHandle =
      payload.terminalHandle ??
      (previous?.terminalHandle && this.sameTerminalOwner(previous, payload)
        ? previous.terminalHandle
        : undefined)
    const terminalOwnedPayload =
      terminalHandle === payload.terminalHandle ? payload : { ...payload, terminalHandle }
    if (previous && isStaleGrokTurnEnd(previous, terminalOwnedPayload)) {
      // Why: Grok turn-end hooks may arrive after the next prompt, including across relay restart.
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    const connectionClearWatermark = terminalOwnedPayload.connectionId
      ? this.connectionTimestampWatermarkById.get(terminalOwnedPayload.connectionId)
      : undefined
    // Why: renderer ordering rejects older rows; live evidence must sort after reconnect clears and restored rows across clock rollback.
    const restoredStatusWatermark = previous?.restoredUnconfirmed ? previous.receivedAt : undefined
    const now = Math.max(
      Date.now(),
      (connectionClearWatermark ?? -1) + 1,
      (restoredStatusWatermark ?? -1) + 1
    )
    if (terminalOwnedPayload.connectionId) {
      this.connectionTimestampWatermarkById.set(terminalOwnedPayload.connectionId, now)
    }
    if (terminalOwnedPayload.providerSessionOnly) {
      // Why: identity-only rows survive replay but must not emit prompt telemetry or a fabricated status.
      onAccepted?.()
      this.recordSessionAuthorityOnAccept(payload)
      // Why: same fence and same ordering as the main branch — after the
      // authority recording so a legit next-session announcement never fences
      // itself, a superseded or foreign-generation session_start cannot
      // replace the live row.
      if (previous !== undefined && this.isSupersededProviderSession(payload)) {
        return previous
      }
      const enriched = {
        ...this.attachStatusTiming(terminalOwnedPayload, now),
        observation: this.stampObservation(terminalOwnedPayload, origin, now)
      }
      this.clearAssistantMessageRetry(enriched.paneKey)
      this.runtimeObservedStatusPaneKeys.delete(enriched.paneKey)
      // Why: a Pi session_start is this pane's next-session announcement; it must
      // fence the previous session's observed options even though it carries none.
      this.rememberObservedOptions(enriched)
      this.state.lastStatusByPaneKey.set(enriched.paneKey, enriched)
      this.commitStatusRowMutation(rowBefore, enriched)
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
      this.emitEnrichedStatus(enriched)
      return enriched
    }
    const stateReconciledPayload =
      terminalOwnedPayload.connectionId &&
      terminalOwnedPayload.payload.agentType === 'codex' &&
      terminalOwnedPayload.hookEventName
        ? {
            ...terminalOwnedPayload,
            payload: reconcileRemoteCodexState(
              this.state,
              terminalOwnedPayload.paneKey,
              terminalOwnedPayload.hookEventName,
              terminalOwnedPayload.toolAgentId,
              terminalOwnedPayload.payload,
              previous?.payload
            )
          }
        : terminalOwnedPayload
    const previousCodexRoot =
      stateReconciledPayload.payload.agentType === 'codex' &&
      stateReconciledPayload.toolAgentId &&
      previous?.payload.agentType === 'codex'
        ? previous
        : undefined
    const preservedProviderSession = !stateReconciledPayload.providerSession
      ? previousCodexRoot?.providerSession
      : undefined
    const preservedRootModel = !stateReconciledPayload.payload.model
      ? previousCodexRoot?.payload.model
      : undefined
    // Why: an SSH relay restart forgets root-only fields; child hooks must not erase durable resume/model identity.
    const rootContextPreservingPayload =
      preservedProviderSession || preservedRootModel
        ? {
            ...stateReconciledPayload,
            ...(preservedProviderSession ? { providerSession: preservedProviderSession } : {}),
            payload: preservedRootModel
              ? { ...stateReconciledPayload.payload, model: preservedRootModel }
              : stateReconciledPayload.payload
          }
        : stateReconciledPayload
    const boundaryReconciledPrevious = invalidateClaudeChildOnlyBoundary(
      previous,
      rootContextPreservingPayload
    )
    if (boundaryReconciledPrevious !== previous) {
      previous = boundaryReconciledPrevious
      if (previous) {
        this.state.lastStatusByPaneKey.set(previous.paneKey, previous)
        this.scheduleStatusPersist()
      }
    }
    const identity = resolveAgentStatusIdentity({
      existing: previous
        ? {
            agentType: previous.payload.agentType,
            state: previous.payload.state,
            updatedAt: previous.receivedAt,
            restoredUnconfirmed: previous.restoredUnconfirmed
          }
        : undefined,
      incoming: rootContextPreservingPayload.payload.agentType,
      now
    })
    if (
      previous &&
      shouldSuppressInheritedTerminalStatus({
        inheritedFromActivePane: identity.inheritedFromActivePane,
        incomingState: rootContextPreservingPayload.payload.state
      })
    ) {
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    const identityResolvedPayload =
      identity.agentType === rootContextPreservingPayload.payload.agentType
        ? rootContextPreservingPayload
        : {
            ...rootContextPreservingPayload,
            payload: { ...rootContextPreservingPayload.payload, agentType: identity.agentType }
          }
    const effectivePayload = attachClaudePermissionToolUseId(previous, identityResolvedPayload)
    const boundaryAwarePayload = attachClaudeChildOnlyBoundary(previous, effectivePayload)
    if (previous && shouldKeepClaudePermissionVisible(previous, effectivePayload)) {
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    // Why: some TUIs emit a delayed tool/working hook after Ctrl+C stopped the turn; don't let it resurrect the row.
    if (
      previous?.payload.state === 'done' &&
      previous.payload.interrupted === true &&
      effectivePayload.payload.state === 'done' &&
      previous.payload.agentType === effectivePayload.payload.agentType &&
      previous.payload.prompt === effectivePayload.payload.prompt &&
      Date.now() - previous.receivedAt <= INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS
    ) {
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    if (
      previous?.payload.state === 'done' &&
      previous.payload.interrupted === true &&
      effectivePayload.payload.state === 'working' &&
      previous.payload.agentType === effectivePayload.payload.agentType &&
      previous.payload.prompt === effectivePayload.payload.prompt &&
      (effectivePayload.isReplay === true ||
        isToolProgressWorkingAfterInterrupt(effectivePayload) ||
        (effectivePayload.hasExplicitPrompt !== true &&
          Date.now() - previous.receivedAt <= INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS))
    ) {
      if (effectivePayload.payload.agentType === 'codex') {
        markCodexLeadTurnInterrupted(this.state, effectivePayload.paneKey)
      }
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    if (
      effectivePayload.payload.state !== 'done' ||
      effectivePayload.payload.lastAssistantMessage
    ) {
      this.clearAssistantMessageRetry(effectivePayload.paneKey)
    }
    // Why: authority moves only on acceptance — replays, rejected rows and
    // other generations must not move it — and before the fence below so an
    // announcement or user-turn never fences itself.
    this.recordSessionAuthorityOnAccept(boundaryAwarePayload)
    // Why: a superseded session must not land at all — live straggler or
    // reconnect replay. Projecting the live session onto its content would
    // label A's prompt/model as B's, and letting a replay replace the row
    // would flip the pane's snapshot back to a dead generation. The live
    // session's own replays are never superseded, so rehydration is intact;
    // without a previous row the first row still lands with options fenced.
    if (previous !== undefined && this.isSupersededProviderSession(boundaryAwarePayload)) {
      this.commitStatusRowMutation(rowBefore, previous)
      return previous
    }
    onAccepted?.()
    if (!identity.inheritedFromActivePane) {
      this.maybeTrackAgentPromptSent(effectivePayload, previous)
    }
    // Why: the selector also reads status rows — strip a superseded session's
    // options there too, or the side-table fence leaves that leak open.
    const optionsFencedPayload = this.isSupersededProviderSession(boundaryAwarePayload)
      ? {
          ...boundaryAwarePayload,
          payload: {
            ...boundaryAwarePayload.payload,
            model: undefined,
            thinkingLevel: undefined,
            variant: undefined
          }
        }
      : boundaryAwarePayload
    // Why: a superseded row that still lands (no previous row to preserve)
    // keeps its own session identity — never relabeled as the authority's —
    // so workerRead cannot read A's content as B's session.
    const enriched = {
      ...this.attachStatusTiming(optionsFencedPayload, now, observedAt),
      observation: this.stampObservation(optionsFencedPayload, origin, observedAt ?? now)
    }
    if (
      typeof enriched.payload.turnCompletedAt === 'number' &&
      Number.isFinite(enriched.payload.turnCompletedAt)
    ) {
      this.activeHookTurnCompletedAtByPaneKey.set(
        enriched.paneKey,
        enriched.payload.turnCompletedAt
      )
    }
    // Why: an identity-matched event can still leave the aggregate backed only by another restored child; keep liveness reconciliation eligible.
    if (enriched.restoredUnconfirmed) {
      this.runtimeObservedStatusPaneKeys.delete(enriched.paneKey)
    } else {
      this.runtimeObservedStatusPaneKeys.add(enriched.paneKey)
    }
    this.rememberObservedOptions(enriched)
    this.state.lastStatusByPaneKey.set(enriched.paneKey, enriched)
    this.commitStatusRowMutation(rowBefore, enriched)
    // Why skipped for structured rows: the serializer drops them, so the whole walk and stringify
    // can only ever reproduce the last file — once per debounce window for a streaming chat.
    if (!enriched.structuredHost) {
      this.scheduleStatusPersist()
    }
    this.notifyStatusChangeListeners()
    this.emitEnrichedStatus(enriched)
    return enriched
  }

  /** Keep the newest options-carrying evidence per pane; only accepted events
   *  reach here, and suppressed events must not overwrite it. */
  protected rememberObservedOptions(enriched: EnrichedAgentHookEventPayload): void {
    // Why: a superseded session's late event must neither re-store its options
    // nor delete the live session's stored row (the fence runs before the check).
    if (this.isSupersededProviderSession(enriched)) {
      return
    }
    this.fenceObservedOptionsOnProviderSessionChange(enriched)
    const { model, thinkingLevel, variant, agentType } = enriched.payload
    if (
      agentType === undefined ||
      (model === undefined && thinkingLevel === undefined && variant === undefined)
    ) {
      return
    }
    const row: AgentHookObservedOptionsRow = {
      paneKey: enriched.paneKey,
      connectionId: enriched.connectionId,
      ...(enriched.launchToken ? { launchToken: enriched.launchToken } : {}),
      ...(enriched.providerSession ? { providerSessionId: enriched.providerSession.id } : {}),
      agentType,
      ...(model !== undefined ? { model } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(variant !== undefined ? { variant } : {}),
      origin: enriched.observation?.origin ?? 'hook',
      evidenceObservedAt: enriched.evidenceObservedAt ?? enriched.receivedAt,
      receivedAt: enriched.receivedAt,
      ...(enriched.observation ? { observation: enriched.observation } : {})
    }
    this.lastObservedOptionsByPaneKey.delete(enriched.paneKey)
    this.lastObservedOptionsByPaneKey.set(enriched.paneKey, row)
    while (this.lastObservedOptionsByPaneKey.size > MAX_REMEMBERED_OBSERVED_OPTIONS) {
      const oldest = this.lastObservedOptionsByPaneKey.keys().next().value
      if (typeof oldest !== 'string') {
        break
      }
      this.lastObservedOptionsByPaneKey.delete(oldest)
    }
  }

  /** A provider-session change in one pane (OpenCode /new, Pi session_start)
   *  ends the previous session's option evidence: option-less events of the SAME
   *  session must survive, but the next session must start with none. */
  private fenceObservedOptionsOnProviderSessionChange(
    enriched: EnrichedAgentHookEventPayload
  ): void {
    const sessionId = enriched.providerSession?.id
    if (!sessionId) {
      return
    }
    const stored = this.lastObservedOptionsByPaneKey.get(enriched.paneKey)
    if (stored?.providerSessionId && stored.providerSessionId !== sessionId) {
      this.lastObservedOptionsByPaneKey.delete(enriched.paneKey)
    }
  }
}
