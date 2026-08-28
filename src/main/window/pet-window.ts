import { BrowserWindow, screen } from 'electron'
import {
  DEFAULT_PET_WINDOW_SNAPSHOT,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_MARGIN,
  PET_WINDOW_QUERY,
  PET_WINDOW_WIDTH,
  clampPetWindowPosition,
  isPetWindowPosition,
  type PetWindowPosition,
  type PetWindowSnapshot
} from '@shared/pet/window'
import type { JsonStore } from '../services/storage'
import { log } from '../services/logger'
import { installRendererNavigationGuard } from './navigation-policy'
import { resolvePreload, resolveRendererUrl } from './create-window'
import { IPC_EVENT } from '@shared/ipc/channels'

const PET_WINDOW_POSITION_KEY = 'petWindowPosition'
const POSITION_SAVE_DELAY_MS = 160

interface PetWindowControllerOptions {
  snapshot?: PetWindowSnapshot
  uiStateStore: JsonStore<Record<string, unknown>>
  getMainWindow: () => BrowserWindow | null
}

export class PetWindowController {
  private window: BrowserWindow | null = null
  private snapshot: PetWindowSnapshot
  private rendererReady = false
  private positionSaveTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(private readonly options: PetWindowControllerOptions) {
    this.snapshot = options.snapshot ?? DEFAULT_PET_WINDOW_SNAPSHOT
    this.syncVisibility()
  }

  update(snapshot: PetWindowSnapshot): void {
    this.snapshot = snapshot
    this.sendSnapshot()
    this.syncVisibility()
  }

  destroy(): void {
    this.destroyed = true
    if (this.positionSaveTimer) clearTimeout(this.positionSaveTimer)
    this.positionSaveTimer = null
    if (this.window && !this.window.isDestroyed()) this.window.close()
    this.window = null
  }

  private shouldShow(): boolean {
    return Boolean(this.snapshot.enabled && this.snapshot.style !== 'none')
  }

  private syncVisibility(): void {
    if (this.destroyed) return
    if (!this.shouldShow()) {
      this.window?.hide()
      return
    }
    const win = this.ensureWindow()
    if (!win.webContents.isLoading()) win.showInactive()
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window

    const renderer = resolveRendererUrl()
    const petRendererUrl = new URL(renderer.url)
    petRendererUrl.searchParams.set('window', PET_WINDOW_QUERY)
    const position = this.resolveInitialPosition()
    const win = new BrowserWindow({
      ...position,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      acceptFirstMouse: true,
      webPreferences: {
        preload: resolvePreload('pet'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    })

    this.window = win
    win.setMenuBarVisibility(false)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    installRendererNavigationGuard(win.webContents, petRendererUrl.href, 'pet window')
    win.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      this.sendSnapshot()
    })
    win.on('ready-to-show', () => {
      if (this.shouldShow()) win.showInactive()
    })
    win.on('moved', () => this.schedulePositionSave())
    win.on('closed', () => {
      if (this.positionSaveTimer) clearTimeout(this.positionSaveTimer)
      this.positionSaveTimer = null
      this.rendererReady = false
      if (this.window === win) this.window = null
    })

    void win.loadURL(petRendererUrl.href)

    return win
  }

  private resolveInitialPosition(): PetWindowPosition {
    const saved = this.options.uiStateStore.peek()[PET_WINDOW_POSITION_KEY]
    if (isPetWindowPosition(saved)) {
      const display = screen.getDisplayNearestPoint(saved)
      return clampPetWindowPosition(saved, display.workArea)
    }

    const mainBounds = this.options.getMainWindow()?.getBounds()
    const display = mainBounds ? screen.getDisplayMatching(mainBounds) : screen.getPrimaryDisplay()
    const anchor = mainBounds ?? display.workArea
    return clampPetWindowPosition(
      {
        x: anchor.x + anchor.width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN,
        y: anchor.y + anchor.height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN
      },
      display.workArea
    )
  }

  private schedulePositionSave(): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.positionSaveTimer) clearTimeout(this.positionSaveTimer)
    this.positionSaveTimer = setTimeout(() => {
      this.positionSaveTimer = null
      if (!this.window || this.window.isDestroyed()) return
      const [x, y] = this.window.getPosition()
      void this.options.uiStateStore
        .update({ [PET_WINDOW_POSITION_KEY]: { x, y } })
        .catch((error) => log.app.warn('pet window position save failed', error))
    }, POSITION_SAVE_DELAY_MS)
  }

  private sendSnapshot(): void {
    const win = this.window
    if (!win || win.isDestroyed() || !this.rendererReady) return
    win.webContents.send(IPC_EVENT.petWindowState, this.snapshot)
  }
}
