/**
 * Main window creation + Electron security defaults.
 */

import { BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WINDOW } from '@shared/constants/index'
import { getIsDev } from '../services/app-paths'
import { log } from '../services/logger'
import { installRendererNavigationGuard } from './navigation-policy'

export function resolvePreload(entry = 'index'): string {
  const dir = path.join(import.meta.dirname, '../preload')
  for (const name of [`${entry}.js`, `${entry}.cjs`, `${entry}.mjs`]) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(dir, 'index.mjs')
}

export function resolveRendererUrl(): { entry: string; url: string; development: boolean } {
  const entry = path.join(import.meta.dirname, '../renderer/index.html')
  const developmentUrl =
    getIsDev() && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
  return {
    entry,
    url: developmentUrl ?? pathToFileURL(entry).href,
    development: Boolean(developmentUrl)
  }
}

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const renderer = resolveRendererUrl()

  const win = new BrowserWindow({
    width: DEFAULT_WINDOW.width,
    height: DEFAULT_WINDOW.height,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    show: false,
    backgroundColor: '#17191C',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 }
        }
      : {
          frame: false
        }),
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload requires sandbox:false; keep contextIsolation + no nodeIntegration.
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Pi-Harness is a desktop-only application. Renderer content must never
  // create a browser window or hand a URL to the system browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  installRendererNavigationGuard(win.webContents, renderer.url, 'main window')

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.app.error('preload failed', { preloadPath, error: String(error) })
  })

  if (renderer.development) {
    void win.loadURL(renderer.url)
    log.app.info('loaded development renderer')
  } else {
    void win.loadFile(renderer.entry)
  }

  return win
}
