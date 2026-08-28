import { describe, expect, it } from 'vitest'
import {
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  clampPetWindowPosition,
  isPetWindowPosition,
  isPetWindowSnapshot
} from './window'

describe('pet window geometry', () => {
  it('keeps a saved position inside the target display work area', () => {
    const workArea = { x: -1920, y: 0, width: 1920, height: 1080 }

    expect(clampPetWindowPosition({ x: -3000, y: 2000 }, workArea)).toEqual({
      x: -1920,
      y: 1080 - PET_WINDOW_HEIGHT
    })
    expect(clampPetWindowPosition({ x: 200, y: -20 }, workArea)).toEqual({
      x: -PET_WINDOW_WIDTH,
      y: 0
    })
  })

  it('rejects malformed persisted positions', () => {
    expect(isPetWindowPosition({ x: 12, y: 24 })).toBe(true)
    expect(isPetWindowPosition({ x: '12', y: 24 })).toBe(false)
    expect(isPetWindowPosition({ x: Number.NaN, y: 24 })).toBe(false)
  })

  it('accepts only complete desktop pet snapshots', () => {
    const snapshot = {
      style: 'knowledge',
      state: 'coding',
      currentTool: 'apply_patch',
      active: true,
      enabled: true,
      animated: true,
      showStatus: true,
      theme: 'dark',
      accentColor: 'blue',
      customAccentColor: '#5b91f5',
      language: 'zh-CN'
    }

    expect(isPetWindowSnapshot(snapshot)).toBe(true)
    expect(isPetWindowSnapshot({ ...snapshot, state: 'unknown' })).toBe(false)
    expect(isPetWindowSnapshot({ ...snapshot, enabled: 'yes' })).toBe(false)
  })
})
