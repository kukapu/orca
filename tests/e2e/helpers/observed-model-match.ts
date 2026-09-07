export type ObservedModelAgent = 'opencode' | 'pi'

/**
 * Exact hook-evidence vs launch-selection comparison for the real-agent smoke.
 *
 * OpenCode: the status plugin reports the session model id from assistant
 * message parts, which is the configured id verbatim.
 * Pi: the agent-status extension reads ctx.model per event, the running id.
 * In both cases a last-segment or case-insensitive match could accept a
 * wrong provider, so only an exact match (after trimming transport
 * whitespace) counts as observed. If a provider ever canonicalizes ids, the
 * smoke must fail honestly and the rule must be revisited with evidence —
 * never silently loosened.
 */
export function normalizeObservedModelId(model: string): string {
  return model.trim()
}

export function observedModelMatchesRequested(
  agent: ObservedModelAgent,
  requested: string,
  observed: string | undefined
): boolean {
  void agent
  if (observed === undefined) {
    return false
  }
  return normalizeObservedModelId(observed) === normalizeObservedModelId(requested)
}
