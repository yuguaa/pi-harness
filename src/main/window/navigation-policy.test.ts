import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { installRendererNavigationGuard, isAllowedRendererNavigation } from './navigation-policy'

describe('isAllowedRendererNavigation', () => {
  it('allows only the configured development origin', () => {
    const rendererUrl = 'http://localhost:5173/'

    expect(isAllowedRendererNavigation('http://localhost:5173/workspace', rendererUrl)).toBe(true)
    expect(isAllowedRendererNavigation('http://localhost.evil.test:5173/', rendererUrl)).toBe(false)
    expect(isAllowedRendererNavigation('http://127.0.0.1:5173/', rendererUrl)).toBe(false)
  })

  it('allows only the packaged renderer file while permitting hash routes', () => {
    const rendererUrl = 'file:///Applications/Pi-Harness/renderer/index.html'

    expect(isAllowedRendererNavigation(`${rendererUrl}#/workspace`, rendererUrl)).toBe(true)
    expect(
      isAllowedRendererNavigation('file:///Users/example/untrusted/index.html', rendererUrl)
    ).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isAllowedRendererNavigation('not a URL', 'file:///app/index.html')).toBe(false)
  })

  it('blocks redirects as well as direct navigation', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
    const contents = {
      on: (name: string, listener: (event: { preventDefault(): void }, url: string) => void) => {
        listeners.set(name, listener)
      }
    } as unknown as WebContents
    installRendererNavigationGuard(contents, 'http://localhost:5173/', 'test window')
    const preventDefault = vi.fn()

    listeners.get('will-redirect')?.({ preventDefault }, 'https://outside.example/redirected')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(listeners.has('will-navigate')).toBe(true)
  })
})
