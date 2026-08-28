import type { AppSettings, PetWindowSnapshot } from '../ipc/api-types'
import { MASCOT_STYLES, type MascotStyle } from '../constants/mascot'
import { PET_STATES, type PetState } from './types'

export type { PetWindowSnapshot } from '../ipc/api-types'

export const PET_WINDOW_QUERY = 'pet'
export const PET_WINDOW_WIDTH = 160
export const PET_WINDOW_HEIGHT = 208
export const PET_WINDOW_MARGIN = 16

export interface PetWindowPosition {
  x: number
  y: number
}

export const DEFAULT_PET_WINDOW_SNAPSHOT: PetWindowSnapshot = {
  style: 'none',
  state: 'idle',
  currentTool: null,
  active: false,
  enabled: false,
  animated: true,
  showStatus: true,
  theme: 'dark',
  accentColor: 'blue',
  customAccentColor: '#5b91f5',
  language: 'zh-CN'
}

const PET_WINDOW_THEMES = ['system', 'dark', 'light'] as const
const PET_WINDOW_LANGUAGES = ['auto', 'zh-CN', 'en-US'] as const
const PET_WINDOW_ACCENTS = [
  'blue',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'graphite',
  'custom'
] as const

export function isPetWindowSnapshot(value: unknown): value is PetWindowSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<PetWindowSnapshot>
  return (
    MASCOT_STYLES.includes(snapshot.style as MascotStyle) &&
    PET_STATES.includes(snapshot.state as PetState) &&
    (snapshot.currentTool === null ||
      (typeof snapshot.currentTool === 'string' && snapshot.currentTool.length <= 512)) &&
    typeof snapshot.active === 'boolean' &&
    typeof snapshot.enabled === 'boolean' &&
    typeof snapshot.animated === 'boolean' &&
    typeof snapshot.showStatus === 'boolean' &&
    PET_WINDOW_THEMES.includes(snapshot.theme as AppSettings['theme']) &&
    PET_WINDOW_ACCENTS.includes(snapshot.accentColor as AppSettings['accentColor']) &&
    typeof snapshot.customAccentColor === 'string' &&
    snapshot.customAccentColor.length <= 32 &&
    PET_WINDOW_LANGUAGES.includes(snapshot.language as AppSettings['language'])
  )
}

export function isPetWindowPosition(value: unknown): value is PetWindowPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as Partial<PetWindowPosition>
  return Number.isFinite(position.x) && Number.isFinite(position.y)
}

export function clampPetWindowPosition(
  position: PetWindowPosition,
  workArea: { x: number; y: number; width: number; height: number }
): PetWindowPosition {
  return {
    x: Math.round(
      Math.min(
        Math.max(position.x, workArea.x),
        workArea.x + Math.max(0, workArea.width - PET_WINDOW_WIDTH)
      )
    ),
    y: Math.round(
      Math.min(
        Math.max(position.y, workArea.y),
        workArea.y + Math.max(0, workArea.height - PET_WINDOW_HEIGHT)
      )
    )
  }
}
