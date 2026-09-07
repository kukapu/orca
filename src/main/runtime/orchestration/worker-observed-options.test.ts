import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../../shared/agent-status-types'
import { selectExactWorkerObservedOptions } from './worker-observed-options'

function status(
  paneKey: string,
  overrides: Partial<AgentStatusIpcPayload> = {}
): AgentStatusIpcPayload {
  return {
    paneKey,
    connectionId: null,
    receivedAt: 200,
    stateStartedAt: 190,
    state: 'working',
    prompt: '',
    agentType: 'pi',
    ...overrides
  }
}

describe('exact worker observed options selection', () => {
  it('publishes the newest row that carries observed options, with the evidence clock', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: 'launch-1',
      observedAfter: 100,
      statuses: [
        status('tab:worker', {
          launchToken: 'launch-1',
          model: 'zai/glm-5.3',
          thinkingLevel: 'high',
          receivedAt: 150,
          evidenceObservedAt: 140
        }),
        status('tab:worker', { launchToken: 'launch-1', receivedAt: 300 }),
        status('tab:worker', {
          launchToken: 'launch-1',
          model: 'xai/grok-4.6',
          variant: 'code',
          receivedAt: 250,
          evidenceObservedAt: 240
        })
      ]
    })

    expect(selection).toEqual({
      kind: 'observed',
      evidence: {
        origin: 'hook',
        agent: 'pi',
        model: 'xai/grok-4.6',
        variant: 'code',
        observedAt: 240
      }
    })
  })

  it('falls back to the delivery clock when the host stamps no evidence clock', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: [status('tab:worker', { model: 'zai/glm-5.3', receivedAt: 320 })]
    })
    expect(selection?.kind === 'observed' && selection.evidence.observedAt).toBe(320)
  })

  it('does not present options evidence older than the Dispatch window as current', () => {
    // Why: a relay replay restamps receivedAt but must not rejuvenate the evidence
    // clock — evidence observed before this Dispatch belongs to a prior one.
    const selection = selectExactWorkerObservedOptions({
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 200,
      statuses: [
        status('tab:worker', { model: 'zai/glm-5.3', receivedAt: 500, evidenceObservedAt: 150 }),
        status('tab:worker', { receivedAt: 400 })
      ]
    })
    expect(selection).toEqual({ kind: 'rows_without_options', lastReceivedAt: 500 })
  })

  it('reports explicit rows_without_options when the pane reports but no row carries options', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: [
        status('tab:worker', { receivedAt: 200 }),
        status('tab:worker', { receivedAt: 280 })
      ]
    })
    expect(selection).toEqual({ kind: 'rows_without_options', lastReceivedAt: 280 })
  })

  it('returns null when no exact-window row exists (hook missing or new session not yet reporting)', () => {
    expect(
      selectExactWorkerObservedOptions({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation',
        connectionId: null,
        launchToken: undefined,
        observedAfter: 300,
        statuses: [status('tab:worker', { model: 'zai/glm-5.3', receivedAt: 200 })]
      })
    ).toBeNull()
    expect(
      selectExactWorkerObservedOptions({
        paneKey: 'tab:other',
        processIncarnation: 'pty:incarnation',
        connectionId: null,
        launchToken: undefined,
        observedAfter: 0,
        statuses: [status('tab:worker', { model: 'zai/glm-5.3' })]
      })
    ).toBeNull()
  })

  it('never attributes another launch token or connection to the worker', () => {
    expect(
      selectExactWorkerObservedOptions({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation',
        connectionId: null,
        launchToken: 'launch-current',
        observedAfter: 0,
        statuses: [status('tab:worker', { launchToken: 'launch-prior', model: 'zai/glm-5.3' })]
      })
    ).toBeNull()

    expect(
      selectExactWorkerObservedOptions({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation',
        connectionId: 'ssh-a',
        launchToken: undefined,
        observedAfter: 0,
        statuses: [status('tab:worker', { connectionId: 'ssh-b', model: 'zai/glm-5.3' })]
      })
    ).toBeNull()
  })

  it('keeps a custom profile model verbatim without catalog validation', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey: 'tab:worker',
      processIncarnation: 'pty:incarnation',
      connectionId: null,
      launchToken: undefined,
      observedAfter: 0,
      statuses: [
        status('tab:worker', {
          agentType: 'opencode',
          model: 'custom-internal/fine-tune-x',
          receivedAt: 500
        })
      ]
    })
    expect(selection).toEqual({
      kind: 'observed',
      evidence: {
        origin: 'hook',
        agent: 'opencode',
        model: 'custom-internal/fine-tune-x',
        observedAt: 500
      }
    })
  })

  it('ignores resume-identity-only rows', () => {
    expect(
      selectExactWorkerObservedOptions({
        paneKey: 'tab:worker',
        processIncarnation: 'pty:incarnation',
        connectionId: null,
        launchToken: undefined,
        observedAfter: 0,
        statuses: [
          status('tab:worker', {
            providerSessionOnly: true,
            model: 'zai/glm-5.3',
            receivedAt: 400
          })
        ]
      })
    ).toBeNull()
  })
})
