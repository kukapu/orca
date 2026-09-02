import type { CSSProperties } from 'react'

// Why: worktree-level overlays must pin to the tab-group body with measured
// pixel boxes. CSS anchor() can paint a cut-off box while hit-testing the
// full body, so comparing getBoundingClientRect cannot recover.

export type OverlaySlotRect = {
  top: number
  left: number
  width: number
  height: number
}

export const OVERLAY_SLOT_RECT_MIN_CHANGE_PX = 1
export const OVERLAY_SLOT_MIN_MEASURABLE_EDGE_PX = 8
// Why: 4px drag strip (TabGroupSplitLayout) + 32px tab row (TabGroupPanel) —
// a fallback short of the real band clips the pane top AND bottom.
export const OVERLAY_SLOT_UNMEASURED_TOP_PX = 36
export const OVERLAY_SLOT_UNMEASURED_HEIGHT = 'calc(100% - 36px)'

function escapeCssAttrValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Locate the tab-group body; prefer a worktree-scoped match when available. */
export function findTabGroupBodyElement(groupId: string, worktreeId?: string): HTMLElement | null {
  const escapedGroupId = escapeCssAttrValue(groupId)
  if (!worktreeId) {
    return document.querySelector<HTMLElement>(`[data-tab-group-body-id="${escapedGroupId}"]`)
  }
  const escapedWorktreeId = escapeCssAttrValue(worktreeId)
  const scoped = document.querySelector<HTMLElement>(
    `[data-tab-group-body-id="${escapedGroupId}"][data-worktree-id="${escapedWorktreeId}"]`
  )
  if (scoped) {
    return scoped
  }
  // Why: fixtures may omit worktree id; never steal another worktree's body.
  for (const candidate of document.querySelectorAll<HTMLElement>(
    `[data-tab-group-body-id="${escapedGroupId}"]`
  )) {
    if (!candidate.dataset.worktreeId) {
      return candidate
    }
  }
  return null
}

export function measureOverlaySlotRect(parent: HTMLElement, body: HTMLElement): OverlaySlotRect {
  const parentRect = parent.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  return {
    top: bodyRect.top - parentRect.top,
    left: bodyRect.left - parentRect.left,
    width: bodyRect.width,
    height: bodyRect.height
  }
}

export function isMeasurableOverlayRect(
  rect: Pick<OverlaySlotRect, 'width' | 'height'>,
  minEdgePx = OVERLAY_SLOT_MIN_MEASURABLE_EDGE_PX
): boolean {
  return rect.width >= minEdgePx && rect.height >= minEdgePx
}

export function stabilizeOverlaySlotRect(
  prev: OverlaySlotRect | null,
  next: OverlaySlotRect
): OverlaySlotRect {
  if (
    prev &&
    Math.abs(prev.top - next.top) < OVERLAY_SLOT_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.left - next.left) < OVERLAY_SLOT_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.width - next.width) < OVERLAY_SLOT_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.height - next.height) < OVERLAY_SLOT_RECT_MIN_CHANGE_PX
  ) {
    return prev
  }
  return next
}

export function measuredOverlaySlotBoxStyle(
  rect: OverlaySlotRect | null
): Pick<CSSProperties, 'position' | 'top' | 'left' | 'width' | 'height'> {
  return {
    position: 'absolute',
    top: rect?.top ?? OVERLAY_SLOT_UNMEASURED_TOP_PX,
    left: rect?.left ?? 0,
    width: rect?.width ?? '100%',
    height: rect?.height ?? OVERLAY_SLOT_UNMEASURED_HEIGHT
  }
}
