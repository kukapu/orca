import { memo, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import EmulatorPane from './EmulatorPane'
import { measuredOverlaySlotBoxStyle } from '../tab-group/overlay-slot-geometry'
import { useOverlaySlotGeometry } from '../tab-group/use-overlay-slot-geometry'

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

type SimulatorOverlaySlotProps = {
  tab: Tab
  groupId: string | undefined
  worktreeId: string
  isActive: boolean
  isWorktreeActive: boolean
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}

const SimulatorOverlaySlot = memo(function SimulatorOverlaySlot({
  tab,
  groupId,
  worktreeId,
  isActive,
  isWorktreeActive,
  onFocusOwningGroup
}: SimulatorOverlaySlotProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const measuredRect = useOverlaySlotGeometry({
    overlayRef,
    groupId,
    worktreeId,
    isSurfaceLaidOut: isWorktreeActive
  })
  const style: React.CSSProperties = useMemo(
    () =>
      groupId
        ? {
            ...measuredOverlaySlotBoxStyle(measuredRect),
            zIndex: isActive ? 2 : 1,
            visibility: isActive ? 'visible' : 'hidden',
            pointerEvents: isActive ? 'auto' : 'none'
          }
        : { display: 'none' },
    [groupId, isActive, measuredRect]
  )

  return (
    <div
      ref={overlayRef}
      style={style}
      className="orca-emulator-overlay-slot min-h-0 min-w-0 overflow-hidden"
      data-overlay-geometry="measured"
      onPointerDownCapture={() => {
        if (groupId && onFocusOwningGroup) {
          onFocusOwningGroup(groupId)
        }
      }}
    >
      <EmulatorPane tab={tab} worktreeId={tab.worktreeId} isActive={isActive} />
    </div>
  )
})

const EmulatorPaneOverlayLayer = memo(function EmulatorPaneOverlayLayer({
  worktreeId,
  isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const { unifiedTabs, groups } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )

  const groupActiveTabById = useMemo(() => {
    const lookup: Record<string, string | null | undefined> = {}
    for (const group of groups) {
      lookup[group.id] = group.activeTabId
    }
    return lookup
  }, [groups])

  const simulatorTabs = useMemo(
    () => unifiedTabs.filter((t) => t.contentType === 'simulator'),
    [unifiedTabs]
  )

  return (
    <>
      {simulatorTabs.map((tab) => {
        const isActiveInGroup = groupActiveTabById[tab.groupId] === tab.id
        const isActive = Boolean(isWorktreeActive && isActiveInGroup)
        return (
          <SimulatorOverlaySlot
            key={tab.id}
            tab={tab}
            groupId={tab.groupId}
            worktreeId={worktreeId}
            isActive={isActive}
            isWorktreeActive={isWorktreeActive}
            onFocusOwningGroup={focusOwningGroup}
          />
        )
      })}
    </>
  )
})

export default EmulatorPaneOverlayLayer
