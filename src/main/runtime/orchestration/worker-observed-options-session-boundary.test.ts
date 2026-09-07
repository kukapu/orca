import { describe, expect, it } from 'vitest'
import {
  selectExactWorkerObservedOptions,
  type WorkerObservedOptionsCandidateRow
} from './worker-observed-options'

/**
 * Simulated regression for the OBS residual flagged for run 197-2 block 4:
 * a session-A hook event queued before worker B existed can be DELIVERED
 * (receivedAt) after B's boundary. When the pane has no launch-token fence,
 * the exact-window filter admits it on delivery time alone and reinserts
 * session A's options as worker B's observed evidence.
 *
 * This file is deliberately test-only: no src change ships from block 4
 * without coordinator approval.
 */
describe('observed options session boundary (OBS residual)', () => {
  const paneKey = 'tab-1:leaf-1'
  const boundaryB = 1_000

  function sessionARow(): WorkerObservedOptionsCandidateRow {
    return {
      paneKey,
      connectionId: null,
      agentType: 'opencode',
      model: 'provider-a/glm-session-a',
      // Delivered after B's boundary, observed by session A before it.
      receivedAt: 1_200,
      evidenceObservedAt: 800,
      observation: { origin: 'hook' }
    }
  }

  it('does not resurrect session A options delivered after worker B boundary', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey,
      processIncarnation: 'incarnation-b',
      connectionId: null,
      launchToken: null,
      observedAfter: boundaryB,
      statuses: [sessionARow()]
    })
    // Honest outcomes: no exact-window row, or rows without options. Session A
    // evidence must never surface as worker B's observed model.
    expect(selection === null || selection.kind === 'rows_without_options').toBe(true)
  })

  it('keeps session A rows out when the launch token fences the pane', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey,
      processIncarnation: 'incarnation-b',
      connectionId: null,
      launchToken: 'launch-token-b',
      observedAfter: boundaryB,
      statuses: [{ ...sessionARow(), launchToken: 'launch-token-a' }]
    })
    expect(selection).toBeNull()
  })

  it('keeps genuine worker B evidence observed after the boundary', () => {
    const selection = selectExactWorkerObservedOptions({
      paneKey,
      processIncarnation: 'incarnation-b',
      connectionId: null,
      launchToken: 'launch-token-b',
      observedAfter: boundaryB,
      statuses: [
        {
          paneKey,
          connectionId: null,
          launchToken: 'launch-token-b',
          agentType: 'opencode',
          model: 'provider-b/glm-session-b',
          receivedAt: 1_500,
          evidenceObservedAt: 1_400,
          observation: { origin: 'hook' }
        }
      ]
    })
    expect(selection).toMatchObject({
      kind: 'observed',
      evidence: { model: 'provider-b/glm-session-b' }
    })
  })
})
