import {
  markClaudeLeadTurnInterrupted,
  clearClaudeAnsweredQuestionWait
} from '../../../shared/agent-hook-listener/providers/claude-roster-state'
import { markCodexLeadTurnInterrupted } from '../../../shared/agent-hook-listener/providers/codex-state'
import {
  isAgentInterruptInputIntent,
  type AgentInterruptInferenceRequest
} from '../../../shared/agent-interrupt-intent'
import {
  isAskUserQuestionTool,
  type AgentQuestionAnsweredInferenceRequest
} from '../../../shared/agent-question-answered-intent'
import { AGENT_STATUS_STALE_AFTER_MS, type AgentType } from '../../../shared/agent-status-types'
import type { AgentHookSource } from '../../../shared/agent-hook-relay'
import type { AnnouncedProviderSession, EnrichedAgentHookEventPayload } from './server-types'
import {
  equivalentInterruptAgentType,
  hashLaunchToken,
  isFenceScopedSource,
  isValidPaneKey
} from './server-status-identity'
import { AgentHookServerListeners } from './server-listeners'

/** The fields the session-authority fence reads; live hook payloads and the
 *  disposition's event view are both structural supersets of this shape. */
type SessionFenceEventView = {
  paneKey: string
  source?: AgentHookSource
  launchToken?: string
  providerSession?: { id: string }
  payload?: { agentType?: AgentType }
}

export abstract class AgentHookServerStatusInference extends AgentHookServerListeners {
  /** True only when the host registry positively knows this pane's live launch
   *  token and the given token differs: proof the event belongs to another
   *  Orca-mediated generation, not this pane's current process. Unknown
   *  (undefined) and tokenless (null) never prove anything, so SSH panes
   *  whose token was minted off-host and plain shells keep hook-data rules. */
  protected isForeignLaunchGeneration(paneKey: string, launchToken: string | undefined): boolean {
    const trimmed = launchToken?.trim()
    if (!trimmed || !this.liveLaunchTokenHashProvider) {
      return false
    }
    const liveHash = this.liveLaunchTokenHashProvider(paneKey)
    return typeof liveHash === 'string' && hashLaunchToken(trimmed) !== liveHash
  }

  /** The pane's live session: the last announcement, else the stored row's
   *  session (same agent only) so an evicted watermark still fails safe —
   *  a straggler can never re-assert its session as current. */
  protected resolveSessionAuthority(
    paneKey: string,
    incoming: SessionFenceEventView
  ): AnnouncedProviderSession | undefined {
    const announced = this.announcedProviderSessionByPaneKey.get(paneKey)
    if (announced !== undefined) {
      return announced
    }
    const stored = this.lastObservedOptionsByPaneKey.get(paneKey)
    if (
      stored?.providerSessionId === undefined ||
      stored.agentType === undefined ||
      incoming.payload?.agentType === undefined ||
      stored.agentType !== incoming.payload.agentType ||
      incoming.source === undefined
    ) {
      return undefined
    }
    return {
      sessionId: stored.providerSessionId,
      source: incoming.source,
      ...(stored.launchToken ? { launchToken: stored.launchToken } : {})
    }
  }

  /** True when the event's session is provably not the pane's live one.
   *  Identity only — no clock can prove this (a straggler is genuinely fresh,
   *  just from the old session). Host-registry rule first: a launch token the
   *  pane's connected pty never minted proves a foreign generation outright.
   *  Token rule: a tokenless authority names no generation, so a tokened
   *  event is admitted (disposition already vetted it — transfer/restart-strip
   *  case); every other mismatch is settled by session, and content from a
   *  foreign generation is always fenced. */
  protected isSupersededProviderSession(payload: SessionFenceEventView): boolean {
    const source = payload.source
    if (!isFenceScopedSource(source)) {
      return false
    }
    // Why: positive generation proof from the host's live PTY registry — an
    // event from another Orca-mediated generation is superseded regardless of
    // hook-data authority state (the live generation may not have spoken yet,
    // so the announcement watermark alone cannot distinguish them), and even
    // when the event names no session id.
    if (this.isForeignLaunchGeneration(payload.paneKey, payload.launchToken)) {
      return true
    }
    const sessionId = payload.providerSession?.id
    if (!sessionId) {
      return false
    }
    const authority = this.resolveSessionAuthority(payload.paneKey, payload)
    if (authority === undefined) {
      return false
    }
    if (authority.launchToken === undefined && payload.launchToken !== undefined) {
      return false
    }
    if (
      authority.launchToken !== undefined &&
      payload.launchToken !== undefined &&
      authority.launchToken !== payload.launchToken
    ) {
      return true
    }
    if (authority.source !== source) {
      return true
    }
    return authority.sessionId !== sessionId
  }

  inferInterrupt(request: AgentInterruptInferenceRequest): boolean {
    if (!isValidPaneKey(request.paneKey)) {
      return false
    }
    if (!isAgentInterruptInputIntent(request.intent)) {
      return false
    }
    const existing = this.state.lastStatusByPaneKey.get(request.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!existing) {
      return false
    }
    if (existing.providerSessionOnly) {
      return false
    }
    // Why: inference must not fabricate a `done` onto a row whose `working` was never confirmed this runtime.
    if (existing.restoredUnconfirmed) {
      return false
    }
    const payload = existing.payload
    const agentType: AgentType | undefined = payload.agentType
    // Why: Droid's Ctrl+C exits the CLI (handled by PTY lifecycle) rather than interrupting the current turn.
    if (agentType === 'droid' && request.intent === 'ctrl-c') {
      return false
    }
    // Why: these agents use the first Escape as a TUI cancel that can leave the turn running; only a double Escape infers an interrupt.
    if (
      (agentType === 'opencode' || agentType === 'copilot') &&
      request.intent === 'plain-escape' &&
      request.inputCount !== 2
    ) {
      return false
    }
    const dismissesClaudeQuestion =
      agentType === 'claude' &&
      request.intent === 'plain-escape' &&
      payload.state === 'waiting' &&
      isAskUserQuestionTool(payload.toolName)
    if (dismissesClaudeQuestion) {
      return this.inferQuestionAnswered(request)
    }
    // Why: inference is a fallback for a missing final hook; a strict baseline match keeps a delayed timer from clobbering any newer hook.
    if (
      payload.state !== 'working' ||
      !equivalentInterruptAgentType(agentType, request.baselineAgentType) ||
      payload.prompt !== request.baselinePrompt ||
      existing.receivedAt !== request.baselineUpdatedAt ||
      existing.stateStartedAt !== request.baselineStateStartedAt ||
      Date.now() - existing.receivedAt > AGENT_STATUS_STALE_AFTER_MS
    ) {
      return false
    }
    // Why: a 'working' pane can be child-driven; Ctrl+C doesn't stop background children, so inferring done would retire live child rows.
    if (payload.subagents?.some((subagent) => subagent.state !== 'idle')) {
      return false
    }
    // Why: Escape/Ctrl+C at Claude's idle prompt does not stop provider-owned shells or session crons.
    if (
      agentType === 'claude' &&
      (this.state.claudeRunningNonAgentTaskPaneKeys.has(existing.paneKey) ||
        this.state.claudeActiveSessionCronPaneKeys.has(existing.paneKey))
    ) {
      return false
    }
    // Why: keep the Claude lead-turn record in sync, or a later child event re-emits the stale 'working' state and resurrects the cancelled pane.
    if (agentType === 'claude') {
      markClaudeLeadTurnInterrupted(this.state, existing.paneKey)
    }
    if (agentType === 'codex') {
      markCodexLeadTurnInterrupted(this.state, existing.paneKey)
    }
    const inferred = this.applyNormalizedStatus({
      paneKey: existing.paneKey,
      tabId: existing.tabId,
      worktreeId: existing.worktreeId,
      connectionId: existing.connectionId,
      providerSession: existing.providerSession,
      payload: {
        state: 'done',
        prompt: payload.prompt,
        agentType,
        ...(payload.model ? { model: payload.model } : {}),
        interrupted: true,
        // Why: idle children are display state; dropping them on an inferred interrupt blanks rows a later hook would restore.
        ...(payload.subagents ? { subagents: payload.subagents } : {})
      }
    })
    console.debug('[agent-hooks] inferred interrupted agent status', {
      paneKey: inferred.paneKey,
      agentType,
      intent: request.intent
    })
    return true
  }

  /** Guarded fallback for the hook Claude omits after answering or dismissing AskUserQuestion. */
  inferQuestionAnswered(request: AgentQuestionAnsweredInferenceRequest): boolean {
    if (!isValidPaneKey(request.paneKey)) {
      return false
    }
    const existing = this.state.lastStatusByPaneKey.get(request.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!existing) {
      return false
    }
    // Why: inference must not fabricate a transition onto a row whose state was never confirmed this runtime.
    if (existing.restoredUnconfirmed) {
      return false
    }
    const payload = existing.payload
    // Why: only Claude's interactive question clears on typed input — tool name (not hook event) discriminates; real permission waits stay sticky.
    if (
      payload.agentType !== 'claude' ||
      payload.state !== 'waiting' ||
      !isAskUserQuestionTool(payload.toolName)
    ) {
      return false
    }
    if (
      payload.agentType !== request.baselineAgentType ||
      payload.prompt !== request.baselinePrompt ||
      existing.receivedAt !== request.baselineUpdatedAt ||
      existing.stateStartedAt !== request.baselineStateStartedAt ||
      Date.now() - existing.receivedAt > AGENT_STATUS_STALE_AFTER_MS
    ) {
      return false
    }
    // Why: sync the listener's lead-turn record too, or a later child event re-emits the stale waiting state and resurrects the card.
    const restored = clearClaudeAnsweredQuestionWait(this.state, existing.paneKey)
    const inferred = this.applyNormalizedStatus({
      paneKey: existing.paneKey,
      tabId: existing.tabId,
      worktreeId: existing.worktreeId,
      connectionId: existing.connectionId,
      providerSession: existing.providerSession,
      payload: {
        state: restored.state,
        ...(restored.workingMode ? { workingMode: restored.workingMode } : {}),
        prompt: payload.prompt,
        agentType: payload.agentType,
        ...(restored.state === 'done' && restored.interrupted ? { interrupted: true } : {}),
        ...(restored.turnCompletedAt !== undefined
          ? { turnCompletedAt: restored.turnCompletedAt }
          : {}),
        ...(payload.subagents ? { subagents: payload.subagents } : {})
      }
    })
    console.debug('[agent-hooks] inferred resolved question status', {
      paneKey: inferred.paneKey,
      state: inferred.payload.state
    })
    return true
  }
}
