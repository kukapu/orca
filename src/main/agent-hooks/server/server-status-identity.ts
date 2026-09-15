import { createHash } from 'node:crypto'

import type { AgentKind } from '../../../shared/telemetry-events'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import type { AgentHookSource } from '../../../shared/agent-hook-relay'
import {
  getAgentResumeArgv,
  type AgentProviderSessionMetadata
} from '../../../shared/agent-session-resume'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import type { AgentStatusIpcPayload, AgentType } from '../../../shared/agent-status-types'
import type { EnrichedAgentHookEventPayload } from './server-types'
import { AGENT_PROMPT_SENT_AGENT_KINDS, TOOL_PROGRESS_HOOK_EVENTS } from './server-constants'
import { MAX_PANE_KEY_LEN } from '../../../shared/agent-hook-listener/listener-limits'

/** Sources whose observed options are session-fenced: each can both announce its
 *  session and be announced away. mimo-code/omp events are dropped before ever
 *  announcing, so fencing them would have no lift path. */
const OBSERVED_OPTIONS_SESSION_FENCE_SOURCES: ReadonlySet<AgentHookSource> = new Set([
  'opencode',
  'pi',
  'prime-agent'
])

export function isFenceScopedSource(source: AgentHookSource | undefined): boolean {
  return source !== undefined && OBSERVED_OPTIONS_SESSION_FENCE_SOURCES.has(source)
}

export function isObservedOptionsSessionFenceScoped(
  payload: AgentHookEventPayload | EnrichedAgentHookEventPayload
): boolean {
  return isFenceScopedSource(payload.source)
}

/** Fields the session-boundary predicates read; live hook payloads and the
 *  disposition's event view are both structural supersets of this shape. */
export type ProviderSessionBoundaryView = {
  source?: AgentHookSource
  hookEventName?: string
  providerSessionOnly?: boolean
  hasExplicitPrompt?: boolean
}

/** A session announcement, not turn content: OpenCode's SessionStart row and Pi's
 *  identity-only session_start. Only session.created emits SessionStart — a
 *  resume never re-emits it — so announcements alone cannot track resumes;
 *  see isProviderSessionUserTurn for the resume signal. */
export function isProviderSessionAnnouncement(payload: ProviderSessionBoundaryView): boolean {
  return payload.hookEventName === 'SessionStart' || payload.providerSessionOnly === true
}

/** OpenCode's real resume signal: it emits no UserPromptSubmit and a resumed
 *  session never re-emits SessionStart, so the role=user MessagePart (admitted
 *  by the normalizer as the new turn — same predicate the retired-pane revive
 *  reuses) is what proves the session live again. Pi resumes re-emit
 *  session_start instead, so turn content alone never moves Pi authority. */
export function isProviderSessionUserTurn(payload: ProviderSessionBoundaryView): boolean {
  return (
    payload.source === 'opencode' &&
    payload.hookEventName === 'MessagePart' &&
    payload.hasExplicitPrompt === true
  )
}

export function agentTypeToPromptSentAgentKind(agentType: AgentType | undefined): AgentKind {
  const normalized = agentType?.trim().toLowerCase()
  if (!normalized || normalized === 'unknown') {
    return 'other'
  }
  if (normalized === 'claude') {
    return 'claude-code'
  }
  return AGENT_PROMPT_SENT_AGENT_KINDS.has(normalized as AgentKind)
    ? (normalized as AgentKind)
    : 'other'
}

export function equivalentInterruptAgentType(
  actual: AgentType | undefined,
  baseline: AgentType | undefined
): boolean {
  const normalizedActual = actual === 'unknown' ? undefined : actual
  const normalizedBaseline = baseline === 'unknown' ? undefined : baseline
  return normalizedActual === normalizedBaseline
}

// Why: validate the durable `${tabId}:${leafUuid}` leaf suffix at write/hydrate so legacy numeric rows fail closed.
export function isValidPaneKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_PANE_KEY_LEN && parsePaneKey(value) !== null
  )
}

// Why: remote metadata-only rows are currently a Pi contract; user-dismissed rows use an internal persisted marker instead.
export function isValidPiProviderSessionOnly(
  providerSession: AgentProviderSessionMetadata | undefined,
  agentType: AgentType | undefined
): boolean {
  return Boolean(providerSession && agentType === 'pi' && getAgentResumeArgv('pi', providerSession))
}

export function toAgentStatusIpcPayload(
  entry: EnrichedAgentHookEventPayload
): AgentStatusIpcPayload {
  return {
    paneKey: entry.paneKey,
    ...(entry.launchToken ? { launchToken: entry.launchToken } : {}),
    tabId: entry.tabId,
    worktreeId: entry.worktreeId,
    connectionId: entry.connectionId,
    receivedAt: entry.receivedAt,
    // Why: consumers must measure staleness with the evidence clock, not the
    // restamped delivery clock — a replayed row would otherwise read as fresh.
    ...(entry.evidenceObservedAt !== undefined
      ? { evidenceObservedAt: entry.evidenceObservedAt }
      : {}),
    stateStartedAt: entry.stateStartedAt,
    ...(entry.providerSession ? { providerSession: entry.providerSession } : {}),
    ...(entry.providerSessionOnly ? { providerSessionOnly: true } : {}),
    ...(entry.promptInteractionKey ? { promptInteractionKey: entry.promptInteractionKey } : {}),
    ...(entry.restoredUnconfirmed ? { restoredUnconfirmed: true } : {}),
    ...(entry.observation ? { observation: entry.observation } : {}),
    ...(entry.structuredHost ? { structuredHost: entry.structuredHost } : {}),
    ...(entry.terminalHandle ? { terminalHandle: entry.terminalHandle } : {}),
    ...entry.payload
  }
}

export function isToolProgressWorkingAfterInterrupt(next: AgentHookEventPayload): boolean {
  if (next.payload.state !== 'working') {
    return false
  }
  if (next.payload.agentType !== 'claude' && next.payload.agentType !== 'codex') {
    return false
  }
  // Why: a same-prompt retry is another UserPromptSubmit, while late post-Ctrl+C progress arrives as tool lifecycle work.
  return next.hookEventName !== undefined && TOOL_PROGRESS_HOOK_EVENTS.has(next.hookEventName)
}

export function paneCacheKeyTabId(key: string): string | null {
  const paneKey = key.split('\0', 1)[0] ?? key
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

export function paneCacheKeyMatchesTab(key: string, tabId: string): boolean {
  return paneCacheKeyTabId(key) === tabId
}

export function hashLaunchToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
