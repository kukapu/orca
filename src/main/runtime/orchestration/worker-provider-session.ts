import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import type { ExactWorkerProviderSession } from '../../../shared/orchestration-worker-output'
import {
  isWslHookRelayConnectionId,
  wslHookRelayConnectionId
} from '../../../shared/wsl-hook-relay-contract'

/** Minimal row shape the exact-window filter needs; live status rows and the
 *  hook server's observed-options side rows both satisfy it structurally. */
export type ExactWorkerStatusRow = {
  paneKey: string
  connectionId: string | null
  launchToken?: string
  providerSessionOnly?: boolean
  receivedAt: number
}

function attestedWslDistro(
  connectionId: string | null,
  expectedDistro: string | null | undefined
): string | undefined {
  const distro = expectedDistro?.trim()
  return distro && connectionId === wslHookRelayConnectionId(distro) ? distro : undefined
}

function connectionMatches(
  entryConnectionId: string | null,
  expectedConnectionId: string | null | undefined,
  wslDistro: string | null | undefined
): boolean {
  if (expectedConnectionId === undefined || entryConnectionId === expectedConnectionId) {
    return true
  }
  // WSL hook relays stamp their distro on the event, while the host PTY stays
  // local (connectionId null). Require the PTY's known distro to avoid mixing
  // same-pane events from another WSL transport.
  return (
    expectedConnectionId === null &&
    typeof wslDistro === 'string' &&
    wslDistro.trim().length > 0 &&
    isWslHookRelayConnectionId(entryConnectionId) &&
    entryConnectionId === wslHookRelayConnectionId(wslDistro.trim())
  )
}

/** Exact-window status rows for one worker process, newest first. Shared by
 *  every exact-worker status read (provider session, observed options) so the
 *  identity fencing cannot diverge between consumers. */
export function selectExactWorkerStatusRows<R extends ExactWorkerStatusRow>(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  wslDistro?: string | null
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly R[]
}): R[] {
  return args.statuses
    .filter(
      (entry) =>
        entry.paneKey === args.paneKey &&
        connectionMatches(entry.connectionId, args.connectionId, args.wslDistro) &&
        (!args.launchToken || entry.launchToken === args.launchToken) &&
        entry.providerSessionOnly !== true &&
        entry.receivedAt >= args.observedAfter
    )
    .sort((left, right) => right.receivedAt - left.receivedAt)
}

export function selectExactWorkerProviderSession(args: {
  paneKey: string
  processIncarnation: string
  connectionId: string | null | undefined
  wslDistro?: string | null
  launchToken: string | null | undefined
  observedAfter: number
  statuses: readonly AgentStatusIpcPayload[]
}): ExactWorkerProviderSession | null {
  const status = selectExactWorkerStatusRows(args).find(
    (entry) => entry.providerSession !== undefined && entry.agentType !== undefined
  )
  if (!status?.providerSession || !status.agentType) {
    return null
  }
  const wslDistro = attestedWslDistro(status.connectionId, args.wslDistro)
  return {
    paneKey: args.paneKey,
    processIncarnation: args.processIncarnation,
    connectionId: status.connectionId,
    ...(wslDistro ? { wslDistro } : {}),
    agent: status.agentType,
    providerSession: { ...status.providerSession },
    observedAt: status.receivedAt
  }
}
