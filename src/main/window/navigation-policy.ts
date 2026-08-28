import type { WebContents } from 'electron'
import { log } from '../services/logger'

/** Restrict renderer navigation to the exact packaged page or dev-server origin. */
export function isAllowedRendererNavigation(navigationUrl: string, rendererUrl: string): boolean {
  try {
    const target = new URL(navigationUrl)
    const expected = new URL(rendererUrl)

    if (target.protocol !== expected.protocol) return false
    if (expected.protocol === 'file:') {
      return target.pathname === expected.pathname && target.search === expected.search
    }

    return target.origin === expected.origin
  } catch {
    return false
  }
}

/** Apply the same navigation and redirect guard to every trusted renderer window. */
export function installRendererNavigationGuard(
  contents: WebContents,
  rendererUrl: string,
  windowName: string
): void {
  const guard = (event: Electron.Event, url: string): void => {
    if (isAllowedRendererNavigation(url, rendererUrl)) return
    event.preventDefault()
    log.app.warn(`blocked ${windowName} navigation outside the desktop application`)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
}
