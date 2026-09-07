import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PI_MANAGED_EXTENSION_MARKER,
  classifyPiExtensionLoadErrors,
  extractLastStatusSessionOracle,
  extractObservedOptionsObservation,
  extractTerminalAgentStatusObservation,
  extractWorktreeHookRowObservation,
  inspectPiManagedExtensions
} from './real-pi-startup-hook-probe'

describe('extractObservedOptionsObservation', () => {
  it('reports status/reason, not object presence', () => {
    expect(
      extractObservedOptionsObservation({
        observation: {
          observedOptions: { origin: 'hook', status: 'unavailable', reason: 'no_status_row' }
        }
      })
    ).toEqual({ status: 'unavailable', reason: 'no_status_row', agent: null })
    expect(
      extractObservedOptionsObservation({
        observation: {
          observedOptions: {
            origin: 'agent-hook',
            status: 'observed',
            agent: 'pi',
            model: 'secret'
          }
        }
      })
    ).toEqual({ status: 'observed', reason: null, agent: 'pi' })
    expect(extractObservedOptionsObservation({ observation: {} })).toEqual({
      status: null,
      reason: null,
      agent: null
    })
  })

  it('throws on unknown reason instead of treating it as absence', () => {
    expect(() =>
      extractObservedOptionsObservation({
        observation: {
          observedOptions: { status: 'unavailable', reason: 'made_up', model: 'grok-secret' }
        }
      })
    ).toThrow('unexpected_observed-options-reason_shape')
  })
})

describe('extractLastStatusSessionOracle', () => {
  it('treats Pi providerSessionOnly as session_start without ids or paths', () => {
    const result = extractLastStatusSessionOracle({
      version: 2,
      entries: {
        'pane-secret': {
          providerSessionOnly: true,
          agentType: 'pi',
          providerSession: { key: 'session_id', id: 'sess-1', transcriptPath: '/tmp/pi.jsonl' }
        }
      }
    })
    expect(result).toEqual({
      fileStatus: 'read',
      sessionStartObserved: true,
      providerSessionOnly: true,
      agent: 'pi'
    })
    expect(
      extractLastStatusSessionOracle({
        version: 2,
        entries: { pane: { providerSessionOnly: true } }
      }).sessionStartObserved
    ).toBe(true)
    expect(JSON.stringify(result)).not.toContain('pane-secret')
    expect(JSON.stringify(result)).not.toContain('sess-1')
    expect(JSON.stringify(result)).not.toContain('/tmp/pi.jsonl')
  })

  it('does not claim session_start from a non-identity status row', () => {
    expect(
      extractLastStatusSessionOracle({
        entries: { pane: { providerSessionOnly: false, agentType: 'pi', state: 'working' } }
      })
    ).toEqual({
      fileStatus: 'read',
      sessionStartObserved: false,
      providerSessionOnly: false,
      agent: 'pi'
    })
    expect(extractLastStatusSessionOracle({ entries: {} }).fileStatus).toBe('empty')
    expect(() => extractLastStatusSessionOracle({ version: 2 })).toThrow(
      'unexpected_last-status-entries_shape'
    )
  })
})

describe('extractTerminalAgentStatusObservation / extractWorktreeHookRowObservation', () => {
  it('allowlists TUI status and ignores handles', () => {
    const result = extractTerminalAgentStatusObservation({
      agentStatus: { handle: 'term-secret', isRunningAgent: true, status: 'idle' }
    })
    expect(result).toEqual({ isRunningAgent: true, status: 'idle' })
    expect(JSON.stringify(result)).not.toContain('term-secret')
    expect(() =>
      extractTerminalAgentStatusObservation({ agentStatus: { status: 'busy' } })
    ).toThrow('unexpected_agent-status-handle_shape')
    expect(() =>
      extractTerminalAgentStatusObservation({
        agentStatus: { handle: 'term-secret', isRunningAgent: true, status: 'busy' }
      })
    ).toThrow('unexpected_agent-status-status_shape')
  })

  it('reports worktree hook rows without prompt or path text', () => {
    const result = extractWorktreeHookRowObservation(
      {
        worktrees: [
          {
            worktreeId: 'wt-1',
            path: '/secret/repo',
            agents: [{ agentType: 'pi', state: 'waiting', prompt: 'do not leak' }]
          }
        ],
        totalCount: 1,
        truncated: false
      },
      'wt-1'
    )
    expect(result).toEqual({ status: 'observed', agent: 'pi', state: 'waiting' })
    expect(JSON.stringify(result)).not.toContain('do not leak')
    expect(JSON.stringify(result)).not.toContain('/secret/repo')
    expect(
      extractWorktreeHookRowObservation(
        { worktrees: [{ worktreeId: 'wt-1', agents: [] }], totalCount: 1, truncated: false },
        'wt-1'
      )
    ).toEqual({ status: 'absent', agent: null, state: null })
    expect(() =>
      extractWorktreeHookRowObservation(
        { worktrees: [{ worktreeId: 'wt-1' }], totalCount: 1 },
        'wt-1'
      )
    ).toThrow('unexpected_worktree-agents_shape')
    expect(() => extractWorktreeHookRowObservation({ summaries: [] }, 'wt-1')).toThrow(
      'unexpected_worktree-ps_shape'
    )
  })
})

describe('classifyPiExtensionLoadErrors', () => {
  it('maps load failures to tokens and names only the managed file', () => {
    expect(
      classifyPiExtensionLoadErrors([
        'Failed to load extension orca-agent-status.ts: boom at /home/x'
      ])
    ).toEqual({ loadError: 'extension-load-failed', managedFile: 'orca-agent-status.ts' })
    expect(classifyPiExtensionLoadErrors(['SyntaxError in extension orca-prefill.ts'])).toEqual({
      loadError: 'extension-syntax-error',
      managedFile: 'orca-prefill.ts'
    })
    expect(classifyPiExtensionLoadErrors(['jiti error loading orca-titlebar-spinner.ts'])).toEqual({
      loadError: 'extension-jiti-failed',
      managedFile: 'orca-titlebar-spinner.ts'
    })
    expect(
      classifyPiExtensionLoadErrors(["Cannot find module './orca-agent-status.ts' from /secret"])
    ).toEqual({
      loadError: 'managed-extension-module-missing',
      managedFile: 'orca-agent-status.ts'
    })
    expect(classifyPiExtensionLoadErrors(['pi ready'])).toEqual({
      loadError: 'none',
      managedFile: null
    })
  })
})

describe('inspectPiManagedExtensions', () => {
  it('reports relative managed files and marker without file bodies', () => {
    const isolatedHome = mkdtempSync(path.join(os.tmpdir(), 'orca-pi-ext-'))
    const extensionsDir = path.join(isolatedHome, '.pi', 'agent', 'extensions')
    mkdirSync(extensionsDir, { recursive: true })
    writeFileSync(
      path.join(extensionsDir, 'orca-agent-status.ts'),
      `// ${PI_MANAGED_EXTENSION_MARKER}\nexport default function () {}`
    )
    writeFileSync(path.join(extensionsDir, 'user-extra.ts'), 'secret-body')
    const flags = inspectPiManagedExtensions(isolatedHome)
    expect(flags.isolatedHomePresent).toBe(true)
    expect(flags.agentDirPresent).toBe(true)
    expect(flags.extensionsDirPresent).toBe(true)
    expect(flags.files['orca-agent-status.ts']).toEqual({ present: true, managedMarker: true })
    expect(flags.files['orca-prefill.ts']).toEqual({ present: false, managedMarker: false })
    expect(flags.unmanagedFileCount).toBe(1)
    expect(JSON.stringify(flags)).not.toContain('secret-body')
    expect(JSON.stringify(flags)).not.toContain('user-extra')
  })
})
