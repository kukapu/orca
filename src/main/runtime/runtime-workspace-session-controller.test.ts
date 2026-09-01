import { describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { RuntimeWorkspaceSessionController } from './runtime-workspace-session-controller'

const WORKTREE_ID = 'id:repo-1::/home/user/repo'

function sessionWithWorktrees(worktreeIds: string[]): WorkspaceSessionState {
  return {
    tabsByWorktree: Object.fromEntries(
      worktreeIds.map((worktreeId) => [worktreeId, [{ id: 'tab-1' }]])
    )
  } as unknown as WorkspaceSessionState
}

function buildStore(
  overrides: {
    sessions?: Partial<Record<ExecutionHostId, WorkspaceSessionState>>
    hostIds?: ExecutionHostId[]
    repo?: Repo | null
    folderWorkspaces?: FolderWorkspace[]
  } = {}
) {
  const sessions = new Map<ExecutionHostId, WorkspaceSessionState>(
    Object.entries(overrides.sessions ?? {}) as [ExecutionHostId, WorkspaceSessionState][]
  )
  const setWorkspaceSession = vi.fn()
  return {
    store: {
      getWorkspaceSession: (hostId: ExecutionHostId) => sessions.get(hostId) ?? null,
      getWorkspaceSessionHostIds: () =>
        overrides.hostIds ?? ([...sessions.keys()] as ExecutionHostId[]),
      setWorkspaceSession,
      getRepo: () =>
        overrides.repo === undefined
          ? ({ id: 'repo-1', connectionId: null, executionHostId: 'local' } as unknown as Repo)
          : overrides.repo,
      getFolderWorkspaces: () => overrides.folderWorkspaces ?? []
    },
    sessions,
    setWorkspaceSession
  }
}

function buildController(store: unknown) {
  return new RuntimeWorkspaceSessionController({
    getStore: () => store as never,
    resolveFolderConnectionId: () => null,
    hasRuntimeOwnedPtyCandidate: () => false
  })
}

describe('RuntimeWorkspaceSessionController durable host resolution (#11803)', () => {
  it('routes reads to the unique durable owner when the catalog partition is stale', () => {
    const { store } = buildStore({
      repo: { id: 'repo-1', connectionId: null, executionHostId: 'runtime:old' } as unknown as Repo,
      sessions: {
        'runtime:old': sessionWithWorktrees(['id:repo-1::/other/worktree']),
        local: sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBe(store.getWorkspaceSession('local'))
  })

  it('writes back to the same durable owner partition it read from', () => {
    const { store, setWorkspaceSession } = buildStore({
      repo: { id: 'repo-1', connectionId: null, executionHostId: 'runtime:old' } as unknown as Repo,
      sessions: {
        'runtime:old': sessionWithWorktrees([]),
        local: sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    const session = controller.get(WORKTREE_ID)!
    controller.set(WORKTREE_ID, session)
    expect(setWorkspaceSession).toHaveBeenCalledWith(session, 'local')
  })

  it('keeps the catalog host when its partition owns the worktree', () => {
    const { store } = buildStore({
      repo: { id: 'repo-1', connectionId: null, executionHostId: 'runtime:old' } as unknown as Repo,
      sessions: {
        'runtime:old': sessionWithWorktrees([WORKTREE_ID]),
        local: sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBe(store.getWorkspaceSession('runtime:old'))
  })

  it('keeps the catalog host when persisted ownership is ambiguous', () => {
    const { store } = buildStore({
      repo: { id: 'repo-1', connectionId: null, executionHostId: 'runtime:new' } as unknown as Repo,
      sessions: {
        'runtime:new': sessionWithWorktrees([]),
        'runtime:old': sessionWithWorktrees([WORKTREE_ID]),
        local: sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBe(store.getWorkspaceSession('runtime:new'))
  })

  it('prefers the stale runtime partition when it is the unique durable owner', () => {
    const { store } = buildStore({
      repo: { id: 'repo-1', connectionId: null, executionHostId: 'runtime:new' } as unknown as Repo,
      sessions: {
        'runtime:new': sessionWithWorktrees([]),
        'runtime:old': sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBe(store.getWorkspaceSession('runtime:old'))
  })

  it('does not reroute ssh catalog hosts even when a unique local owner exists', () => {
    const { store } = buildStore({
      repo: { id: 'repo-1', connectionId: 'target-a', executionHostId: null } as unknown as Repo,
      sessions: {
        'ssh:target-a': sessionWithWorktrees([]),
        local: sessionWithWorktrees([WORKTREE_ID])
      }
    })
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBe(store.getWorkspaceSession('ssh:target-a'))
  })

  it('keeps the catalog host when the store cannot enumerate partitions', () => {
    const repo = {
      id: 'repo-1',
      connectionId: null,
      executionHostId: 'runtime:old'
    } as unknown as Repo
    const store = {
      getWorkspaceSession: () => null,
      getRepo: () => repo,
      getFolderWorkspaces: () => []
    }
    const controller = buildController(store)
    expect(controller.get(WORKTREE_ID)).toBeNull()
  })

  it('still throws folder_workspace_not_found for a missing folder workspace', () => {
    const { store } = buildStore({ folderWorkspaces: [] })
    const controller = buildController(store)
    expect(() => controller.getHostId('folder:missing')).toThrow('folder_workspace_not_found')
  })

  it('reroutes a stale runtime catalog host for folder workspaces too', () => {
    const { store } = buildStore({
      folderWorkspaces: [
        { id: 'fw-1', executionHostId: 'runtime:old' } as unknown as FolderWorkspace
      ],
      sessions: {
        'runtime:old': sessionWithWorktrees([]),
        local: sessionWithWorktrees(['folder:fw-1'])
      }
    })
    const controller = buildController(store)
    expect(controller.get('folder:fw-1')).toBe(store.getWorkspaceSession('local'))
  })
})
