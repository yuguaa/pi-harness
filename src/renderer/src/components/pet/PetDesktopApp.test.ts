import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetWindowSnapshot } from '@shared/ipc/api-types'
import PetDesktopApp from './PetDesktopApp.vue'

const { snapshot } = vi.hoisted(() => ({
  snapshot: {
    style: 'knowledge',
    state: 'idle',
    currentTool: null,
    active: false,
    enabled: true,
    animated: true,
    showStatus: true,
    theme: 'dark',
    accentColor: 'blue',
    customAccentColor: '#5b91f5',
    language: 'zh-CN'
  } as PetWindowSnapshot
}))

beforeEach(() => {
  window.piHarnessPet = {
    onState: (listener) => {
      listener(snapshot)
      return vi.fn()
    }
  }
})

afterEach(() => {
  delete window.piHarnessPet
})

describe('PetDesktopApp', () => {
  it('renders the mascot inside the native draggable desktop surface', () => {
    const wrapper = mount(PetDesktopApp)

    expect(wrapper.get('.pet-desktop-window').attributes('data-visible')).toBe('true')
    expect(wrapper.get('[data-testid="workspace-mascot"]').attributes('data-style')).toBe(
      'knowledge'
    )
  })
})
