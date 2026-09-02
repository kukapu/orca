/** @vitest-environment happy-dom */
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlaySlotGeometry } from './use-overlay-slot-geometry'
import type { OverlaySlotRect } from './overlay-slot-geometry'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createRect({
  top = 0,
  left = 0,
  width = 800,
  height = 600
}: Partial<Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>> = {}): DOMRect {
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({})
  }
}

let host: HTMLDivElement
let root: Root
let lastRect: OverlaySlotRect | null
let resizeCallbacks: ResizeObserverCallback[]
let mutationCallbacks: MutationCallback[]
let observedResizeElements: Element[]
let observedMutationRoots: Element[]
let disconnectedResize = 0
let disconnectedMutation = 0

class CapturingResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback)
  }
  observe(target: Element): void {
    if (!observedResizeElements.includes(target)) {
      observedResizeElements.push(target)
    }
  }
  unobserve(target: Element): void {
    observedResizeElements = observedResizeElements.filter((el) => el !== target)
  }
  disconnect(): void {
    disconnectedResize += 1
    observedResizeElements = []
  }
}

class CapturingMutationObserver {
  constructor(callback: MutationCallback) {
    mutationCallbacks.push(callback)
  }
  observe(target: Node): void {
    if (target instanceof Element && !observedMutationRoots.includes(target)) {
      observedMutationRoots.push(target)
    }
  }
  disconnect(): void {
    disconnectedMutation += 1
  }
}

function GeometryHarness({
  groupId,
  worktreeId,
  isSurfaceLaidOut = true
}: {
  groupId: string | undefined
  worktreeId?: string
  isSurfaceLaidOut?: boolean
}): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  lastRect = useOverlaySlotGeometry({
    overlayRef,
    groupId,
    worktreeId,
    isSurfaceLaidOut
  })
  return (
    <>
      <div data-testid="layout" />
      <div ref={overlayRef} data-testid="overlay" />
    </>
  )
}

function renderHarness(props: {
  groupId: string | undefined
  worktreeId?: string
  isSurfaceLaidOut?: boolean
}): void {
  act(() => {
    root.render(
      <GeometryHarness
        groupId={props.groupId}
        worktreeId={props.worktreeId}
        isSurfaceLaidOut={props.isSurfaceLaidOut}
      />
    )
  })
}

function layoutRoot(): HTMLElement {
  const layout = host.querySelector<HTMLElement>('[data-testid="layout"]')
  if (!layout) {
    throw new Error('layout root missing')
  }
  return layout
}

function mountBody(groupId: string, worktreeId: string, bodyRect: DOMRect): HTMLElement {
  const body = document.createElement('div')
  body.dataset.tabGroupBodyId = groupId
  body.dataset.worktreeId = worktreeId
  body.getBoundingClientRect = () => bodyRect
  layoutRoot().appendChild(body)
  return body
}

beforeEach(() => {
  lastRect = null
  resizeCallbacks = []
  mutationCallbacks = []
  observedResizeElements = []
  observedMutationRoots = []
  disconnectedResize = 0
  disconnectedMutation = 0
  vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
  vi.stubGlobal('MutationObserver', CapturingMutationObserver)
  vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback): number => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  host = document.createElement('div')
  host.getBoundingClientRect = () => createRect({ width: 1000, height: 800 })
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  document.querySelectorAll('[data-tab-group-body-id]').forEach((el) => el.remove())
  vi.unstubAllGlobals()
})

describe('useOverlaySlotGeometry', () => {
  it('measures after a worktree body mounts under the split layout', () => {
    renderHarness({ groupId: 'g-late', worktreeId: 'wt-1' })
    expect(lastRect).toBeNull()
    expect(observedMutationRoots).toContain(layoutRoot())
    expect(observedMutationRoots).not.toContain(host.querySelector('[data-testid="overlay"]'))

    const body = mountBody(
      'g-late',
      'wt-1',
      createRect({ top: 40, left: 100, width: 400, height: 500 })
    )
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })

    expect(observedResizeElements).toContain(body)
    expect(lastRect).toEqual({
      top: 40,
      left: 100,
      width: 400,
      height: 500
    })
  })

  it('re-observes a replaced body', () => {
    renderHarness({ groupId: 'g-rep', worktreeId: 'wt-1' })
    const first = mountBody(
      'g-rep',
      'wt-1',
      createRect({ top: 10, left: 0, width: 300, height: 400 })
    )
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(observedResizeElements).toContain(first)

    first.remove()
    const second = mountBody(
      'g-rep',
      'wt-1',
      createRect({ top: 20, left: 50, width: 350, height: 450 })
    )
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })

    expect(observedResizeElements).toContain(second)
    expect(observedResizeElements).not.toContain(first)
    expect(lastRect).toEqual({
      top: 20,
      left: 50,
      width: 350,
      height: 450
    })
  })

  it('does not observe another worktree body with the same group id', () => {
    renderHarness({ groupId: 'g-scope', worktreeId: 'wt-1' })
    const foreign = document.createElement('div')
    foreign.dataset.tabGroupBodyId = 'g-scope'
    foreign.dataset.worktreeId = 'wt-foreign'
    foreign.getBoundingClientRect = () => createRect({ width: 900, height: 700 })
    document.body.appendChild(foreign)
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(observedResizeElements).not.toContain(foreign)
    expect(lastRect).toBeNull()

    const local = mountBody(
      'g-scope',
      'wt-1',
      createRect({ top: 30, left: 10, width: 200, height: 300 })
    )
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(observedResizeElements).toContain(local)
    expect(lastRect?.width).toBe(200)
    foreign.remove()
  })

  it('remeasures when a hidden surface is revealed after the body grew', () => {
    let bodyRect = createRect({ width: 0, height: 0 })
    renderHarness({ groupId: 'g-reveal', worktreeId: 'wt-1', isSurfaceLaidOut: false })
    const body = mountBody('g-reveal', 'wt-1', bodyRect)
    body.getBoundingClientRect = () => bodyRect
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(lastRect).toBeNull()

    bodyRect = createRect({ top: 36, left: 0, width: 900, height: 700 })
    renderHarness({ groupId: 'g-reveal', worktreeId: 'wt-1', isSurfaceLaidOut: true })
    expect(lastRect).toEqual({
      top: 36,
      left: 0,
      width: 900,
      height: 700
    })
  })

  it('disconnects observers on unmount', () => {
    renderHarness({ groupId: 'g-clean', worktreeId: 'wt-1' })
    mountBody('g-clean', 'wt-1', createRect({ width: 100, height: 100 }))
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(disconnectedResize).toBe(0)

    act(() => {
      root.unmount()
    })
    expect(disconnectedResize).toBeGreaterThanOrEqual(1)
    expect(disconnectedMutation).toBeGreaterThanOrEqual(1)
  })

  it('keeps the last good rect across a group change until the new body mounts', () => {
    renderHarness({ groupId: 'g-move-a', worktreeId: 'wt-1' })
    mountBody('g-move-a', 'wt-1', createRect({ top: 36, left: 0, width: 900, height: 700 }))
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(lastRect?.width).toBe(900)

    renderHarness({ groupId: 'g-move-b', worktreeId: 'wt-1' })
    expect(lastRect?.width).toBe(900)

    mountBody('g-move-b', 'wt-1', createRect({ top: 36, left: 450, width: 450, height: 700 }))
    act(() => {
      // Why: the group change re-ran the effect, so only the newest observer is live.
      mutationCallbacks.at(-1)?.([], {} as MutationObserver)
    })
    expect(lastRect).toEqual({
      top: 36,
      left: 450,
      width: 450,
      height: 700
    })
  })

  it('clears the rect when the group goes away entirely', () => {
    renderHarness({ groupId: 'g-gone', worktreeId: 'wt-1' })
    mountBody('g-gone', 'wt-1', createRect({ top: 36, left: 0, width: 900, height: 700 }))
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    expect(lastRect).not.toBeNull()

    renderHarness({ groupId: undefined, worktreeId: 'wt-1' })
    expect(lastRect).toBeNull()
  })

  it('remeasures when the document becomes visible again', () => {
    renderHarness({ groupId: 'g-visible', worktreeId: 'wt-1' })
    expect(lastRect).toBeNull()

    // Why: body mounts without firing the (stubbed) MutationObserver — only a
    // foreground refresh should pick it up, mirroring a backgrounded web client.
    mountBody('g-visible', 'wt-1', createRect({ top: 36, left: 0, width: 800, height: 600 }))
    expect(lastRect).toBeNull()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(lastRect).toEqual({
      top: 36,
      left: 0,
      width: 800,
      height: 600
    })
  })

  it('does not re-render on sub-pixel jitter', () => {
    renderHarness({ groupId: 'g-jitter', worktreeId: 'wt-1' })
    const body = mountBody(
      'g-jitter',
      'wt-1',
      createRect({ top: 32.1, left: 0.1, width: 799.1, height: 567.1 })
    )
    act(() => {
      mutationCallbacks[0]?.([], {} as MutationObserver)
    })
    const first = lastRect
    expect(first?.top).toBe(32.1)

    body.getBoundingClientRect = () =>
      createRect({ top: 32.9, left: 0.9, width: 799.9, height: 567.9 })
    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver)
    })
    expect(lastRect).toBe(first)
  })
})
