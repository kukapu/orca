import { memo, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import { useAppStore } from '@/store'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import { getActiveRuntimeTarget, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { measuredOverlaySlotBoxStyle } from '../tab-group/overlay-slot-geometry'
import { useOverlaySlotGeometry } from '../tab-group/use-overlay-slot-geometry'
import NativeChatView from './NativeChatView'

type StructuredAgentSessionTab = Tab & {
  contentType: 'agent-session'
  agentSessionAgent: NonNullable<Tab['agentSessionAgent']>
}

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

const StructuredAgentSessionOverlaySlot = memo(function StructuredAgentSessionOverlaySlot({
  tab,
  groupId,
  worktreeId,
  isActive,
  isWorktreeActive,
  target,
  allowFileUriLinks,
  onFocusOwningGroup
}: {
  tab: StructuredAgentSessionTab
  groupId: string | undefined
  worktreeId: string
  isActive: boolean
  isWorktreeActive: boolean
  target: RuntimeClientTarget
  allowFileUriLinks: boolean
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const measuredRect = useOverlaySlotGeometry({
    overlayRef,
    groupId,
    worktreeId,
    isSurfaceLaidOut: isWorktreeActive
  })
  const style = useMemo<React.CSSProperties>(
    () =>
      groupId
        ? {
            ...measuredOverlaySlotBoxStyle(measuredRect),
            display: isActive ? 'flex' : 'none',
            pointerEvents: isActive ? 'auto' : 'none'
          }
        : { display: 'none' },
    [groupId, isActive, measuredRect]
  )
  const focusOwningGroup = useCallback(() => {
    if (groupId !== undefined && onFocusOwningGroup) {
      onFocusOwningGroup(groupId)
    }
  }, [groupId, onFocusOwningGroup])

  return (
    <div
      ref={overlayRef}
      style={style}
      className="native-chat-pane-shell z-10 min-h-0 min-w-0"
      data-structured-agent-session-overlay-tab-id={tab.id}
      data-overlay-geometry="measured"
      aria-hidden={!isActive}
      onPointerDown={focusOwningGroup}
      onFocusCapture={focusOwningGroup}
    >
      <NativeChatView
        mode="structured"
        tabId={tab.id}
        sessionId={tab.entityId}
        agent={tab.agentSessionAgent}
        isVisible={isActive}
        target={target}
        allowFileUriLinks={allowFileUriLinks}
      />
    </div>
  )
})

const StructuredAgentSessionPaneOverlayLayer = memo(
  function StructuredAgentSessionPaneOverlayLayer({
    worktreeId,
    isWorktreeActive
  }: {
    worktreeId: string
    isWorktreeActive: boolean
  }): React.JSX.Element {
    const { unifiedTabs, groups, runtimeEnvironmentId, allowFileUriLinks } = useAppStore(
      useShallow((state) => ({
        unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
        groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
        runtimeEnvironmentId: getRuntimeEnvironmentIdForWorktree(state, worktreeId),
        allowFileUriLinks: getExecutionHostIdForWorktree(state, worktreeId) === 'local'
      }))
    )
    const focusGroup = useAppStore((state) => state.focusGroup)
    const target = useMemo(
      () => getActiveRuntimeTarget({ activeRuntimeEnvironmentId: runtimeEnvironmentId }),
      [runtimeEnvironmentId]
    )
    const focusOwningGroup = useCallback(
      (groupId: string) => focusGroup(worktreeId, groupId),
      [focusGroup, worktreeId]
    )
    const groupActiveTabById = useMemo(
      () => new Map(groups.map((group) => [group.id, group.activeTabId] as const)),
      [groups]
    )
    const structuredTabs = useMemo(
      () =>
        unifiedTabs.filter(
          (tab): tab is StructuredAgentSessionTab =>
            tab.contentType === 'agent-session' &&
            isAgentSessionHandleProvider(tab.agentSessionAgent)
        ),
      [unifiedTabs]
    )

    return (
      <>
        {structuredTabs.map((tab) => (
          <StructuredAgentSessionOverlaySlot
            key={tab.id}
            tab={tab}
            groupId={tab.groupId}
            worktreeId={worktreeId}
            isActive={Boolean(isWorktreeActive && groupActiveTabById.get(tab.groupId) === tab.id)}
            isWorktreeActive={isWorktreeActive}
            target={target}
            allowFileUriLinks={allowFileUriLinks}
            onFocusOwningGroup={focusOwningGroup}
          />
        ))}
      </>
    )
  }
)

export default StructuredAgentSessionPaneOverlayLayer
