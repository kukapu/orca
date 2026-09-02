import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  findTabGroupBodyElement,
  isMeasurableOverlayRect,
  measureOverlaySlotRect,
  stabilizeOverlaySlotRect,
  type OverlaySlotRect
} from './overlay-slot-geometry'

const MAX_UNMEASURABLE_RETRIES = 60

function overlaySlotLayoutRoot(parent: HTMLElement | null): Element | null {
  if (!parent) {
    return null
  }
  // Why: WorktreeSplitSurface's first child is TabGroupSplitLayout. Observing
  // that subtree sees body mount/replace without xterm/webview mutations.
  return parent.firstElementChild ?? parent
}

function startOverlaySlotGeometryTracking(args: {
  groupId: string
  worktreeId?: string
  overlayRef: RefObject<HTMLElement | null>
  isSurfaceLaidOutRef: RefObject<boolean>
  onMeasuredRect: (next: OverlaySlotRect) => void
  registerRefresh: (refresh: () => void) => void
}): () => void {
  let observedBody: Element | null = null
  let observedParent: Element | null = null
  let observedLayoutRoot: Element | null = null
  let rafId = 0
  let retryRafId = 0
  let retryCount = 0
  let cancelled = false

  const resizeObserver = new ResizeObserver(() => {
    // Why: observer events are fresh layout evidence — re-arm the retry budget
    // so an exhausted slot cannot stay pinned to the fallback box forever.
    retryCount = 0
    update()
  })
  const mutationObserver = new MutationObserver(() => {
    retryCount = 0
    update()
  })

  const syncResizeObservation = (body: Element | null, parent: Element | null): void => {
    if (body !== observedBody) {
      if (observedBody) {
        resizeObserver.unobserve(observedBody)
      }
      if (body) {
        resizeObserver.observe(body)
      }
      observedBody = body
    }
    if (parent !== observedParent) {
      if (observedParent) {
        resizeObserver.unobserve(observedParent)
      }
      if (parent) {
        resizeObserver.observe(parent)
      }
      observedParent = parent
    }
  }

  const syncMutationObservation = (layoutRoot: Element | null): void => {
    if (layoutRoot === observedLayoutRoot) {
      return
    }
    mutationObserver.disconnect()
    observedLayoutRoot = null
    if (layoutRoot) {
      mutationObserver.observe(layoutRoot, { childList: true, subtree: true })
      observedLayoutRoot = layoutRoot
    }
  }

  const scheduleRetry = (): void => {
    if (cancelled || retryRafId !== 0 || retryCount >= MAX_UNMEASURABLE_RETRIES) {
      return
    }
    if (!args.isSurfaceLaidOutRef.current) {
      return
    }
    retryRafId = requestAnimationFrame(() => {
      retryRafId = 0
      retryCount += 1
      update()
    })
  }

  const update = (): void => {
    if (cancelled) {
      return
    }
    const overlay = args.overlayRef.current
    const parent = overlay?.parentElement ?? null
    const body = findTabGroupBodyElement(args.groupId, args.worktreeId)
    syncResizeObservation(body, parent)
    syncMutationObservation(overlaySlotLayoutRoot(parent))
    if (!parent || !body) {
      scheduleRetry()
      return
    }
    const next = measureOverlaySlotRect(parent, body)
    if (!isMeasurableOverlayRect(next)) {
      scheduleRetry()
      return
    }
    retryCount = 0
    args.onMeasuredRect(next)
  }

  // Why: the surface-laid-out transition must both re-arm the retry budget
  // (hidden surfaces exhaust it legitimately) and measure immediately.
  const refreshMeasurements = (): void => {
    retryCount = 0
    update()
  }

  // Why: backgrounded remote web clients pause rAF, so retries stall and the
  // rect goes stale; re-measure synchronously when the page returns.
  const handleForegrounded = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    refreshMeasurements()
  }

  args.registerRefresh(refreshMeasurements)
  update()
  rafId = requestAnimationFrame(() => {
    update()
  })
  window.addEventListener('resize', update)
  window.addEventListener('focus', handleForegrounded)
  document.addEventListener('visibilitychange', handleForegrounded)

  return () => {
    cancelled = true
    cancelAnimationFrame(rafId)
    if (retryRafId !== 0) {
      cancelAnimationFrame(retryRafId)
    }
    window.removeEventListener('resize', update)
    window.removeEventListener('focus', handleForegrounded)
    document.removeEventListener('visibilitychange', handleForegrounded)
    mutationObserver.disconnect()
    resizeObserver.disconnect()
    observedBody = null
    observedParent = null
    observedLayoutRoot = null
    args.registerRefresh(() => {})
  }
}

/**
 * Tracks tab-group body geometry for a worktree-level overlay slot.
 * Always returns measured parent-relative pixels — CSS anchors are not used.
 */
export function useOverlaySlotGeometry(args: {
  overlayRef: RefObject<HTMLElement | null>
  groupId: string | undefined
  worktreeId?: string
  /** False while the worktree surface is `hidden`; skip retries that would spin. */
  isSurfaceLaidOut?: boolean
}): OverlaySlotRect | null {
  const [measuredRect, setMeasuredRect] = useState<OverlaySlotRect | null>(null)
  const isSurfaceLaidOutRef = useRef(args.isSurfaceLaidOut !== false)
  const refreshRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    if (!args.groupId) {
      setMeasuredRect(null)
      return () => {}
    }

    // Why: keep the last good rect across group moves — clearing it here makes
    // the slot paint the approximate fallback band (clipped top+bottom) until
    // the new body measures, which can lag on throttled remote clients.
    return startOverlaySlotGeometryTracking({
      groupId: args.groupId,
      worktreeId: args.worktreeId,
      overlayRef: args.overlayRef,
      isSurfaceLaidOutRef,
      onMeasuredRect: (next) => {
        setMeasuredRect((prev) => stabilizeOverlaySlotRect(prev, next))
      },
      registerRefresh: (refresh) => {
        refreshRef.current = refresh
      }
    })
  }, [args.groupId, args.overlayRef, args.worktreeId])

  useLayoutEffect(() => {
    isSurfaceLaidOutRef.current = args.isSurfaceLaidOut !== false
    if (args.isSurfaceLaidOut !== false) {
      refreshRef.current()
    }
  }, [args.isSurfaceLaidOut])

  return measuredRect
}
