import { createHash } from 'node:crypto'

import { isNewTurnEvent } from '../../../shared/agent-hook-listener/provider-event-routing'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import type { AgentType } from '../../../shared/agent-status-types'
import type { AgentHookSource } from '../../../shared/agent-hook-relay'
import {
  CLOSED_AGENT_STATUS_TAB_IDS_MAX,
  CLOSED_AGENT_STATUS_PANE_KEYS_MAX,
  RETIRED_PANE_FENCES_MAX
} from './server-constants'
import type { RetiredPaneAlias, RetiredPaneFence } from './server-types'
import {
  isFenceScopedSource,
  isProviderSessionAnnouncement,
  isProviderSessionUserTurn
} from './server-status-identity'
import { AgentHookServerStatusInference } from './server-status-inference'

export abstract class AgentHookServerStatusDisposition extends AgentHookServerStatusInference {
  /** The sanctioned session-change signals: a non-replay birth (SessionStart,
   *  identity-only session_start) or OpenCode user-turn. Everything else is
   *  content and may never supersede-land while a live session is known. */
  private isLegitimateLiveSessionChange(event: {
    isReplay?: boolean
    source?: AgentHookSource
    hookEventName?: string
    providerSessionOnly?: boolean
    hasExplicitPrompt?: boolean
  }): boolean {
    if (event.isReplay === true) {
      return false
    }
    return isProviderSessionAnnouncement(event) || isProviderSessionUserTurn(event)
  }

  protected markTabClosedForAgentStatus(tabId: string): void {
    // Delete-then-add keeps recently closed tabs most-recent so eviction sheds only the oldest ids.
    this.closedAgentStatusTabIds.delete(tabId)
    this.closedAgentStatusTabIds.add(tabId)
    while (this.closedAgentStatusTabIds.size > CLOSED_AGENT_STATUS_TAB_IDS_MAX) {
      const oldest = this.closedAgentStatusTabIds.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.closedAgentStatusTabIds.delete(oldest)
    }
  }

  protected getAgentStatusDisposition(
    paneKey: string,
    event?: {
      source?: AgentHookSource
      /** Raw wire value, so the gate can tell "field absent" from "field present but unknown". */
      rawSource?: unknown
      hookEventName?: string
      isReplay?: boolean
      hasExplicitPrompt?: boolean
      launchToken?: string
      /** Normalized provider session, when the ingress already has one. */
      providerSession?: { id: string }
      /** Identity-only marker (Pi-family session_start announcements). */
      providerSessionOnly?: boolean
      /** Normalized status payload, when the ingress already has one — feeds
       *  the side-row fallback's agentType match. */
      payload?: { agentType?: AgentType }
    }
  ): 'accept' | 'restart' | 'suppress' {
    const ownerPaneKey = this.resolvePaneKeyAlias(paneKey)
    const paneRetired =
      this.closedAgentStatusPaneKeys.has(paneKey) ||
      this.closedAgentStatusPaneKeys.has(ownerPaneKey)
    const tabId = parsePaneKey(ownerPaneKey)?.tabId
    if (tabId && this.closedAgentStatusTabIds.has(tabId)) {
      return 'suppress'
    }
    if (!paneRetired) {
      // Why: the host's live PTY registry is the generation authority — an
      // event whose launch token the pane's connected pty never minted is
      // foreign to this pane's current process, so it must not land even as a
      // first row. Fence-scoped sources only (the session fence's domain);
      // unknown/tokenless registry answers prove nothing and stay admitted.
      if (
        event &&
        isFenceScopedSource(event.source) &&
        this.isForeignLaunchGeneration(ownerPaneKey, event.launchToken)
      ) {
        return 'suppress'
      }
      // Why: stale-session invariant — while the pane holds a valid authority
      // or side-row evidence for session B, no content from another session
      // may land just because no previous row exists (post-clear), live or
      // replay. Legitimate non-replay announcements and user-turns still pass:
      // they are the sanctioned session-change mechanism (authority moves on
      // accept, resuming A for real stays possible), and registry-foreign
      // births were suppressed above so a dead generation cannot revive.
      if (
        event &&
        isFenceScopedSource(event.source) &&
        !this.isLegitimateLiveSessionChange(event) &&
        this.isSupersededProviderSession({
          paneKey: ownerPaneKey,
          source: event.source,
          launchToken: event.launchToken,
          providerSession: event.providerSession,
          payload: event.payload
        })
      ) {
        return 'suppress'
      }
      const tokenFence = this.restartedStatusLaunchTokenHashByPaneKey.get(ownerPaneKey)
      // Why: deferred retirement lets a new process start in a still-authorized pane, so
      // its tokened SessionStart re-fences; prompts recur, so a stale process would win.
      if (
        event?.hookEventName === 'SessionStart' &&
        event.isReplay !== true &&
        tokenFence !== undefined
      ) {
        const startedLaunchToken = event.launchToken?.trim()
        if (startedLaunchToken) {
          this.restartedStatusLaunchTokenHashByPaneKey.set(
            ownerPaneKey,
            createHash('sha256').update(startedLaunchToken).digest('hex')
          )
          return 'accept'
        }
      }
      if (event && tokenFence) {
        const launchToken = event.launchToken?.trim()
        if (!launchToken || createHash('sha256').update(launchToken).digest('hex') !== tokenFence) {
          return 'suppress'
        }
      }
      return 'accept'
    }
    // Why: command completion retires launch authority but leaves its shell pane reusable.
    // A live new-turn event proves a new agent process owns the retired pane just like a
    // fresh prompt does — without it, a session resumed in a reused pane stays rowless (STA-3386).
    // Why the classifier, not literals: only 5 of 18 sources name their boundary
    // `UserPromptSubmit`/`SessionStart`; the rest stayed retired forever.
    // Why four branches: `source` collapses to undefined when an older relay omits the field,
    // when a newer host sends an unknown string, and when the wire value is malformed. Only an
    // unknown string is valid future-provider evidence. Unreachable from the local path, which
    // 404s an unresolvable source.
    const isNewTurn =
      event?.source !== undefined
        ? isNewTurnEvent(event.source, event.hookEventName)
        : typeof event?.rawSource === 'string' && event.rawSource.trim().length > 0
          ? // Why fail OPEN for an unknown provider: its boundary event is unknowable here, and
            // the costs are asymmetric — a stranded pane is invisible and permanent with no user
            // recovery, while a spurious revive decays after AGENT_STATUS_STALE_AFTER_MS.
            true
          : event?.rawSource === undefined
            ? // Why literals here: an older relay omits `source` entirely. Legacy shim only — it
              // cannot revive a provider whose boundary event is named anything else.
              event?.hookEventName === 'UserPromptSubmit' || event?.hookEventName === 'SessionStart'
            : false
    // Why in addition to the classifier: the OpenCode family carries its mid-session boundary in
    // an explicit-prompt MessagePart, which isNewTurnEvent cannot name — and mimo-code has no
    // SessionStart at all, so without this its retired panes never come back.
    const freshOpenCodeFamilyPrompt =
      (event?.source === 'opencode' || event?.source === 'mimo-code') &&
      event.hookEventName === 'MessagePart' &&
      event.hasExplicitPrompt === true
    // Why the token is minted here: a revive proves a live lifecycle, and fencing follow-up
    // status on that launch token stops a stale process reclaiming the pane's row without
    // restoring retired orchestration authority.
    if ((isNewTurn || freshOpenCodeFamilyPrompt) && event?.isReplay !== true) {
      this.closedAgentStatusPaneKeys.delete(paneKey)
      this.closedAgentStatusPaneKeys.delete(ownerPaneKey)
      const launchToken = event?.launchToken?.trim()
      if (launchToken) {
        this.restartedStatusLaunchTokenHashByPaneKey.set(
          ownerPaneKey,
          createHash('sha256').update(launchToken).digest('hex')
        )
      } else {
        this.restartedStatusLaunchTokenHashByPaneKey.delete(ownerPaneKey)
      }
      return 'restart'
    }
    return 'suppress'
  }

  // Why: a fence can span tabs (a pane detached into another tab), and legacy numeric
  // keys never parse as stable ones — resolve both forms so neither slips the tab check.
  protected isClosedAgentStatusTabForPaneKey(paneKey: string): boolean {
    const tabId =
      parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? undefined
    return tabId !== undefined && this.closedAgentStatusTabIds.has(tabId)
  }

  protected recordRetiredPaneFence(
    paneKeys: ReadonlySet<string>,
    aliases: readonly RetiredPaneAlias[]
  ): void {
    const fence: RetiredPaneFence = { paneKeys: [...paneKeys], aliases }
    for (const key of paneKeys) {
      // Delete-then-set keeps the newest fence most-recent so eviction sheds only the oldest.
      this.retiredPaneFencesByKey.delete(key)
      this.retiredPaneFencesByKey.set(key, fence)
    }
    while (this.retiredPaneFencesByKey.size > RETIRED_PANE_FENCES_MAX) {
      const oldest = this.retiredPaneFencesByKey.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.retiredPaneFencesByKey.delete(oldest)
    }
  }

  protected markPaneClosedForAgentStatus(paneKey: string): void {
    this.closedAgentStatusPaneKeys.delete(paneKey)
    this.closedAgentStatusPaneKeys.add(paneKey)
    while (this.closedAgentStatusPaneKeys.size > CLOSED_AGENT_STATUS_PANE_KEYS_MAX) {
      const oldest = this.closedAgentStatusPaneKeys.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.closedAgentStatusPaneKeys.delete(oldest)
    }
  }
}
