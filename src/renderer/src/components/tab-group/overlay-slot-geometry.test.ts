// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  findTabGroupBodyElement,
  isMeasurableOverlayRect,
  measuredOverlaySlotBoxStyle,
  measureOverlaySlotRect,
  stabilizeOverlaySlotRect
} from './overlay-slot-geometry'

function rect(
  partial: Partial<DOMRect> & Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
): DOMRect {
  const top = partial.top
  const left = partial.left
  const width = partial.width
  const height = partial.height
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

describe('overlay slot geometry', () => {
  it('finds the tab-group body scoped by worktree when both attributes are set', () => {
    const other = document.createElement('div')
    other.dataset.tabGroupBodyId = 'group-a'
    other.dataset.worktreeId = 'wt-other'
    const body = document.createElement('div')
    body.dataset.tabGroupBodyId = 'group-a'
    body.dataset.worktreeId = 'wt-1'
    document.body.append(other, body)
    expect(findTabGroupBodyElement('group-a', 'wt-1')).toBe(body)
    expect(findTabGroupBodyElement('group-a', 'wt-missing')).toBeNull()
    expect(findTabGroupBodyElement('group-a')).toBe(other)
    expect(findTabGroupBodyElement('missing')).toBeNull()
    other.remove()
    body.remove()
  })

  it('accepts a fixture body that omits worktree id', () => {
    const body = document.createElement('div')
    body.dataset.tabGroupBodyId = 'group-fixture'
    document.body.append(body)
    expect(findTabGroupBodyElement('group-fixture', 'wt-1')).toBe(body)
    body.remove()
  })

  it('measures body geometry relative to the overlay parent', () => {
    const parent = document.createElement('div')
    const body = document.createElement('div')
    parent.getBoundingClientRect = () => rect({ top: 100, left: 40, width: 900, height: 700 })
    body.getBoundingClientRect = () => rect({ top: 136, left: 40, width: 450, height: 664 })
    expect(measureOverlaySlotRect(parent, body)).toEqual({
      top: 36,
      left: 0,
      width: 450,
      height: 664
    })
  })

  it('pins the overlay box to measured pixels instead of CSS anchors', () => {
    expect(measuredOverlaySlotBoxStyle({ top: 36, left: 12, width: 800, height: 600 })).toEqual({
      position: 'absolute',
      top: 36,
      left: 12,
      width: 800,
      height: 600
    })
    const unmeasured = measuredOverlaySlotBoxStyle(null)
    expect(unmeasured.top).toBe(36)
    expect(unmeasured.height).toBe('calc(100% - 36px)')
  })

  it('treats sub-pixel jitter as unchanged and zero boxes as unmeasurable', () => {
    const prev = { top: 32.1, left: 0.1, width: 799.1, height: 567.1 }
    expect(
      stabilizeOverlaySlotRect(prev, { top: 32.9, left: 0.9, width: 799.9, height: 567.9 })
    ).toBe(prev)
    expect(isMeasurableOverlayRect({ width: 0, height: 0 })).toBe(false)
    expect(isMeasurableOverlayRect({ width: 800, height: 600 })).toBe(true)
  })
})
