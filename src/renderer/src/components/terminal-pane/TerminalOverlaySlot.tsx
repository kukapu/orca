import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store'
import { isProvenProcessExit } from '../../../../shared/terminal-exit-cause'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'
import { measuredOverlaySlotBoxStyle } from '../tab-group/overlay-slot-geometry'
import { useOverlaySlotGeometry } from '../tab-group/use-overlay-slot-geometry'
import type { ActivityTerminalPortalTarget } from '../activity/activity-terminal-portal'
import TerminalPane from './TerminalPane'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { shouldDeferParkedPtyExitTabClose } from './terminal-parked-tab-watchers'

const MIN_OVERLAY_FIT_WIDTH_PX = 48
const MIN_OVERLAY_FIT_HEIGHT_PX = 24

type TerminalOverlaySlotProps = {
  terminalTabId: string
  terminalGeneration: number | undefined
  worktreeId: string
  worktreePath: string
  startupCwd: string | undefined
  groupId: string | undefined
  isWorktreeActive: boolean
  isVisible: boolean
  isActive: boolean
  activityTerminalPortal: ActivityTerminalPortalTarget | null
  onFocusOwningGroup: ((groupId: string) => void) | undefined
  consumeSuppressedPtyExit: (ptyId: string) => boolean
  leaveWorktreeIfEmpty: () => void
}

export const TerminalOverlaySlot = memo(function TerminalOverlaySlot({
  terminalTabId,
  terminalGeneration,
  worktreeId,
  worktreePath,
  startupCwd,
  groupId,
  isWorktreeActive,
  isVisible,
  isActive,
  activityTerminalPortal,
  onFocusOwningGroup,
  consumeSuppressedPtyExit,
  leaveWorktreeIfEmpty
}: TerminalOverlaySlotProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const measuredRect = useOverlaySlotGeometry({
    overlayRef,
    groupId,
    worktreeId,
    isSurfaceLaidOut: isWorktreeActive
  })
  const [shouldMeasureHiddenStartup, setShouldMeasureHiddenStartup] = useState(
    () => useAppStore.getState().pendingStartupByTabId[terminalTabId] !== undefined
  )
  useLayoutEffect(() => {
    if (isVisible && shouldMeasureHiddenStartup) {
      setShouldMeasureHiddenStartup(false)
    }
  }, [isVisible, shouldMeasureHiddenStartup])
  useLayoutEffect(() => {
    if (!isVisible || !groupId) {
      return
    }
    const dispatchFitIfMeasurable = (): void => {
      const rect = overlayRef.current?.getBoundingClientRect()
      if (
        !rect ||
        rect.width < MIN_OVERLAY_FIT_WIDTH_PX ||
        rect.height < MIN_OVERLAY_FIT_HEIGHT_PX
      ) {
        return
      }
      window.dispatchEvent(new Event(SYNC_FIT_PANES_EVENT))
    }

    // Why: tab switches can resume visibility before the measured geometry
    // settles. Re-fit only after the overlay has real dimensions so the PTY
    // never stays pinned at a stale ~2-col width.
    const frameId = requestAnimationFrame(() => {
      dispatchFitIfMeasurable()
    })
    const retryId = window.setTimeout(() => {
      dispatchFitIfMeasurable()
    }, 50)
    const settledRetryId = window.setTimeout(() => {
      dispatchFitIfMeasurable()
    }, 150)
    return () => {
      cancelAnimationFrame(frameId)
      window.clearTimeout(retryId)
      window.clearTimeout(settledRetryId)
    }
  }, [groupId, isVisible, measuredRect])

  const style: React.CSSProperties = useMemo(
    () =>
      groupId
        ? {
            ...measuredOverlaySlotBoxStyle(measuredRect),
            display: isVisible || shouldMeasureHiddenStartup ? 'flex' : 'none',
            opacity: isVisible ? 1 : 0,
            pointerEvents: isVisible ? 'auto' : 'none'
          }
        : {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            display: 'none',
            pointerEvents: 'none'
          },
    [groupId, isVisible, measuredRect, shouldMeasureHiddenStartup]
  )
  const focusGroup = useCallback(() => {
    if (groupId !== undefined && onFocusOwningGroup) {
      onFocusOwningGroup(groupId)
    }
  }, [groupId, onFocusOwningGroup])

  const terminalPane = (
    <TerminalPane
      key={`${terminalTabId}-${terminalGeneration ?? 0}`}
      tabId={terminalTabId}
      worktreeId={worktreeId}
      cwd={startupCwd ?? worktreePath}
      isActive={isActive || activityTerminalPortal?.active === true}
      // Why: split-group changes reparent TabGroupPanel subtrees. Keeping the
      // TerminalPane mounted here preserves alt-screen TUI state while this
      // flag still lets hidden tabs throttle rendering.
      isVisible={isVisible || activityTerminalPortal !== null}
      isWorktreeActive={isWorktreeActive || activityTerminalPortal !== null}
      isolatedPaneKey={activityTerminalPortal?.paneKey ?? null}
      onPtyExit={(ptyId, exitCode) => {
        if (consumeSuppressedPtyExit(ptyId)) {
          return
        }
        // A synthetic host-loss exit is not evidence that the user closed the tab.
        if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
          useAppStore.getState().markUnverifiedPtyLoss(terminalTabId)
          return
        }
        // Why: a parked multi-leaf tab has no PaneManager to promote split
        // siblings, so closing the tab here would kill them; the reveal
        // remount handles dead PTYs per leaf instead.
        if (shouldDeferParkedPtyExitTabClose(terminalTabId, ptyId)) {
          return
        }
        closeTerminalTab(terminalTabId, {
          reason: 'pty-exit',
          lifecyclePtyId: ptyId,
          onClosed: leaveWorktreeIfEmpty
        })
      }}
      onCloseTab={() => {
        // Why: route through closeTerminalTab (not the raw store closeTab) so a
        // pinned tab hits the confirmation guard. The overlay's direct
        // store.closeTab was the path that closed pinned terminals silently.
        closeTerminalTab(terminalTabId, { onClosed: leaveWorktreeIfEmpty })
      }}
    />
  )

  if (activityTerminalPortal) {
    return createPortal(
      terminalPane,
      activityTerminalPortal.target,
      `activity-terminal-${terminalTabId}`
    )
  }

  return (
    <div
      ref={overlayRef}
      style={style}
      data-terminal-overlay-tab-id={terminalTabId}
      onPointerDown={focusGroup}
      onFocusCapture={focusGroup}
    >
      {terminalPane}
      {/* The chat/terminal toggle now lives in the pane header's action cluster
          (TerminalPaneHeaderOverlay), beside split/close — not as a separate
          floating overlay. */}
    </div>
  )
})
