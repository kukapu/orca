/**
 * Typed, non-secret extractors for the no-prompt Pi startup probe.
 * Status/reason tokens only — never tails, pane keys, session ids, paths, or
 * model ids. Contracts: WorkerObservedOptionsObservation, last-status.json
 * (Pi session_start is providerSessionOnly), terminal.agentStatus, worktree.ps.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { locateLastStatusFile } from './last-status-file-location'

export const PI_MANAGED_EXTENSION_FILES = [
  'orca-agent-status.ts',
  'orca-prefill.ts',
  'orca-titlebar-spinner.ts'
] as const

export const PI_MANAGED_EXTENSION_MARKER = '@orca-managed-pi-extension'
export const PI_AGENT_DIR_RELATIVE = path.join('.pi', 'agent')
export const PI_EXTENSIONS_DIR_RELATIVE = path.join('.pi', 'agent', 'extensions')

const OBSERVED_OPTIONS_STATUSES = ['observed', 'unavailable'] as const
const OBSERVED_OPTIONS_REASONS = [
  'no_status_row',
  'status_without_options',
  'worker_identity_not_exact',
  'no_supervised_worker'
] as const
const HOOK_ROW_STATES = ['working', 'blocked', 'waiting', 'done'] as const
const TUI_STATUSES = ['working', 'permission', 'idle'] as const
const WELL_KNOWN_AGENTS = ['pi', 'opencode', 'omp', 'prime-agent'] as const

export type ObservedOptionsStatus = (typeof OBSERVED_OPTIONS_STATUSES)[number]
export type ObservedOptionsReason = (typeof OBSERVED_OPTIONS_REASONS)[number]
export type HookRowState = (typeof HOOK_ROW_STATES)[number]
export type TuiAgentStatus = (typeof TUI_STATUSES)[number]
export type WellKnownAgent = (typeof WELL_KNOWN_AGENTS)[number]
export type PiManagedExtensionFile = (typeof PI_MANAGED_EXTENSION_FILES)[number]

export type ObservedOptionsObservation = {
  status: ObservedOptionsStatus | null
  reason: ObservedOptionsReason | null
  agent: WellKnownAgent | 'other' | null
}

export type PiManagedExtensionFlags = {
  isolatedHomePresent: boolean
  agentDirPresent: boolean
  extensionsDirPresent: boolean
  files: Record<PiManagedExtensionFile, { present: boolean; managedMarker: boolean }>
  unmanagedFileCount: number
}

export type LastStatusSessionOracle = {
  fileStatus: 'missing' | 'invalid' | 'empty' | 'read' | 'ambiguous'
  sessionStartObserved: boolean
  providerSessionOnly: boolean
  agent: WellKnownAgent | 'other' | null
}

export type WorktreeHookRowObservation = {
  status: 'absent' | 'observed'
  agent: WellKnownAgent | 'other' | null
  state: HookRowState | null
}

export type TerminalAgentStatusObservation = {
  isRunningAgent: boolean
  status: TuiAgentStatus | null
}

export type PiExtensionLoadErrorFlags = {
  loadError:
    | 'none'
    | 'extension-load-failed'
    | 'extension-syntax-error'
    | 'extension-jiti-failed'
    | 'managed-extension-module-missing'
  managedFile: PiManagedExtensionFile | null
}

function unexpectedShape(kind: string): never {
  throw new Error(`unexpected_${kind}_shape`)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requireRecord(value: unknown, kind: string): Record<string, unknown> {
  return asRecord(value) ?? unexpectedShape(kind)
}

function allowlisted<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function classifyAgent(value: unknown): WellKnownAgent | 'other' | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  return (WELL_KNOWN_AGENTS as readonly string[]).includes(value)
    ? (value as WellKnownAgent)
    : 'other'
}

function classifyManagedFile(text: string): PiManagedExtensionFile | null {
  return PI_MANAGED_EXTENSION_FILES.find((file) => text.includes(file)) ?? null
}

/** Maps workerShow.observation.observedOptions to status/reason — never presence. */
export function extractObservedOptionsObservation(payload: unknown): ObservedOptionsObservation {
  const root = requireRecord(payload, 'observed-options-root')
  const observation = requireRecord(root.observation, 'observed-options-observation')
  if (!('observedOptions' in observation) || observation.observedOptions == null) {
    return { status: null, reason: null, agent: null }
  }
  const options = requireRecord(observation.observedOptions, 'observed-options')
  const status = allowlisted(options.status, OBSERVED_OPTIONS_STATUSES)
  if (status == null) {
    unexpectedShape('observed-options-status')
  }
  const reason =
    options.reason === undefined ? null : allowlisted(options.reason, OBSERVED_OPTIONS_REASONS)
  if (options.reason !== undefined && reason == null) {
    unexpectedShape('observed-options-reason')
  }
  return {
    status,
    reason,
    agent: options.agent === undefined ? null : classifyAgent(options.agent)
  }
}

export function extractTerminalAgentStatusObservation(
  payload: unknown
): TerminalAgentStatusObservation {
  const agentStatus = requireRecord(
    requireRecord(payload, 'agent-status-root').agentStatus,
    'agent-status'
  )
  if (typeof agentStatus.handle !== 'string' || agentStatus.handle.length === 0) {
    unexpectedShape('agent-status-handle')
  }
  if (typeof agentStatus.isRunningAgent !== 'boolean') {
    unexpectedShape('agent-status-running')
  }
  if (!('status' in agentStatus)) {
    unexpectedShape('agent-status-status')
  }
  const status = agentStatus.status === null ? null : allowlisted(agentStatus.status, TUI_STATUSES)
  if (agentStatus.status !== null && status == null) {
    unexpectedShape('agent-status-status')
  }
  return { isRunningAgent: agentStatus.isRunningAgent, status }
}

export function extractIsRunningAgentObservation(payload: unknown): boolean {
  const root = requireRecord(payload, 'is-running-agent')
  if (typeof root.isRunningAgent !== 'boolean') {
    unexpectedShape('is-running-agent')
  }
  return root.isRunningAgent
}

export function extractWorktreeHookRowObservation(
  payload: unknown,
  worktreeId: string
): WorktreeHookRowObservation {
  const root = requireRecord(payload, 'worktree-ps')
  if (!Array.isArray(root.worktrees) || typeof root.totalCount !== 'number') {
    unexpectedShape('worktree-ps')
  }
  const summary = root.worktrees
    .map((row) => requireRecord(row, 'worktree-summary'))
    .find((row) => row.worktreeId === worktreeId)
  if (!summary) {
    unexpectedShape('worktree-summary')
  }
  if (!Array.isArray(summary.agents)) {
    unexpectedShape('worktree-agents')
  }
  const agents = summary.agents.map((row) => requireRecord(row, 'worktree-agent'))
  const agent = agents.find((row) => classifyAgent(row.agentType) === 'pi') ?? agents[0]
  if (!agent) {
    return { status: 'absent', agent: null, state: null }
  }
  const state = allowlisted(agent.state, HOOK_ROW_STATES)
  if (state == null) {
    unexpectedShape('worktree-agent-state')
  }
  return {
    status: 'observed',
    agent: classifyAgent(agent.agentType),
    state
  }
}

export function extractLastStatusSessionOracle(payload: unknown): LastStatusSessionOracle {
  const root = requireRecord(payload, 'last-status')
  const entries = asRecord(root.entries)
  if (entries == null) {
    unexpectedShape('last-status-entries')
  }
  const values = Object.values(entries).map((entry) => requireRecord(entry, 'last-status-entry'))
  if (values.length === 0) {
    return {
      fileStatus: 'empty',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: null
    }
  }
  const record = values.find((entry) => entry.providerSessionOnly === true) ?? values[0]
  const providerSessionOnly = record.providerSessionOnly === true
  return {
    fileStatus: 'read',
    sessionStartObserved: providerSessionOnly,
    providerSessionOnly,
    agent: record.agentType === undefined ? null : classifyAgent(record.agentType)
  }
}

export function readLastStatusSessionOracle(userDataDir: string): LastStatusSessionOracle {
  const location = locateLastStatusFile(userDataDir)
  if (location.status === 'missing') {
    return {
      fileStatus: 'missing',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: null
    }
  }
  if (location.status === 'ambiguous') {
    return {
      fileStatus: 'ambiguous',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: null
    }
  }
  try {
    return extractLastStatusSessionOracle(JSON.parse(readFileSync(location.filePath, 'utf8')))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('unexpected_')) {
      throw error
    }
    return {
      fileStatus: 'invalid',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: null
    }
  }
}

export function inspectPiManagedExtensions(isolatedHome: string): PiManagedExtensionFlags {
  const agentDir = path.join(isolatedHome, '.pi', 'agent')
  const extensionsDir = path.join(agentDir, 'extensions')
  const isolatedHomePresent = existsSync(isolatedHome)
  const agentDirPresent = existsSync(agentDir)
  const extensionsDirPresent = existsSync(extensionsDir)
  const listed = extensionsDirPresent
    ? readdirSync(extensionsDir).filter((name) => {
        try {
          return statSync(path.join(extensionsDir, name)).isFile()
        } catch {
          return false
        }
      })
    : []
  const files = Object.fromEntries(
    PI_MANAGED_EXTENSION_FILES.map((file) => {
      const filePath = path.join(extensionsDir, file)
      const present = listed.includes(file)
      let managedMarker = false
      if (present) {
        try {
          managedMarker = readFileSync(filePath, 'utf8')
            .slice(0, 200)
            .includes(PI_MANAGED_EXTENSION_MARKER)
        } catch {
          managedMarker = false
        }
      }
      return [file, { present, managedMarker }]
    })
  ) as PiManagedExtensionFlags['files']
  return {
    isolatedHomePresent,
    agentDirPresent,
    extensionsDirPresent,
    files,
    unmanagedFileCount: listed.filter(
      (name) => !(PI_MANAGED_EXTENSION_FILES as readonly string[]).includes(name)
    ).length
  }
}

export function resolveIsolatedHome(userDataDir: string): string {
  return realpathSync.native(path.join(userDataDir, 'home'))
}

export function classifyPiExtensionLoadErrors(lines: readonly string[]): PiExtensionLoadErrorFlags {
  const joined = lines.join('\n')
  const managedFile = classifyManagedFile(joined)
  if (/cannot find module/i.test(joined) && managedFile) {
    return { loadError: 'managed-extension-module-missing', managedFile }
  }
  if (/jiti/i.test(joined) && /error|failed/i.test(joined)) {
    return { loadError: 'extension-jiti-failed', managedFile }
  }
  if (/syntaxerror/i.test(joined) && /extension/i.test(joined)) {
    return { loadError: 'extension-syntax-error', managedFile }
  }
  if (/failed to load extension|error loading extension/i.test(joined)) {
    return { loadError: 'extension-load-failed', managedFile }
  }
  return { loadError: 'none', managedFile: null }
}
