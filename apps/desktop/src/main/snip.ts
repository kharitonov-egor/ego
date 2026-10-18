import { BrowserWindow, clipboard, ipcMain, screen, type Display, type IpcMainEvent } from 'electron'
import { join } from 'path'
import type { SnipFrame } from '@ego/ui/platform/types'
import { focusReturn } from './focusReturn'
import { imageToText } from './imageText'
import { showNotification } from './quickAdd'
import { captureDisplays, visibleWindows, type DisplayShot } from './screenCapture'
import { isSnipRect, selectionInImage, windowsOnDisplay } from './snipGeometry'

interface Overlay {
  window: BrowserWindow
  loaded: Promise<void>
  shot: DisplayShot | null
  ready: boolean
}

/** Kept between snips so the next one opens without loading a page. */
const overlays = new Map<number, Overlay>()
const snipFocus = focusReturn()
let active = false
let starting = false
let revealed = false
let revealTimer: NodeJS.Timeout | null = null

function createOverlay(display: Display): Overlay {
  const window = new BrowserWindow({
    ...display.bounds,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.on('blur', () => {
    setTimeout(() => {
      if (active && ![...overlays.values()].some((overlay) => !overlay.window.isDestroyed() && overlay.window.isFocused())) {
        cancelSnip()
      }
    }, 0)
  })
  window.on('closed', () => {
    if (overlays.get(display.id)?.window === window) overlays.delete(display.id)
  })
  const loaded = new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()))
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/snip.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/snip.html'))
  }
  return { window, loaded, shot: null, ready: false }
}

function overlayFor(display: Display): Overlay {
  const existing = overlays.get(display.id)
  if (existing && !existing.window.isDestroyed()) return existing
  const overlay = createOverlay(display)
  overlays.set(display.id, overlay)
  return overlay
}

function closeOverlays(): void {
  for (const overlay of overlays.values()) {
    if (!overlay.window.isDestroyed()) overlay.window.destroy()
  }
  overlays.clear()
}

function overlayOf(event: IpcMainEvent): Overlay | null {
  for (const overlay of overlays.values()) {
    if (!overlay.window.isDestroyed() && overlay.window.webContents.id === event.sender.id) return overlay
  }
  return null
}

function reveal(): void {
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = null
  if (!active || revealed) return
  revealed = true
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  let focusTarget: BrowserWindow | null = null
  for (const overlay of overlays.values()) {
    if (overlay.window.isDestroyed() || !overlay.ready || !overlay.shot) continue
    // Set twice: across monitors with different scaling, Windows can size the first attempt for the wrong one.
    overlay.window.setBounds(overlay.shot.display.bounds)
    overlay.window.showInactive()
    overlay.window.setBounds(overlay.shot.display.bounds)
    if (overlay.shot.display.id === cursorDisplay.id) focusTarget = overlay.window
  }
  const target = focusTarget ?? [...overlays.values()].find((overlay) => overlay.ready)?.window
  target?.show()
  target?.focus()
}

function endSnip(focused: Overlay | null): void {
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = null
  active = false
  // Windows only lets the foreground app hand focus back, so this runs before the overlays hide.
  snipFocus.restore(focused?.window ?? null)
  for (const overlay of overlays.values()) {
    overlay.shot = null
    overlay.ready = false
    if (overlay.window.isDestroyed()) continue
    overlay.window.hide()
    overlay.window.webContents.send('snip-frame', null)
  }
}

export function cancelSnip(): void {
  if (!active) return
  const focused = [...overlays.values()].find((overlay) => !overlay.window.isDestroyed() && overlay.window.isFocused()) ?? null
  endSnip(focused)
}

async function readSnip(shot: DisplayShot, rect: unknown): Promise<void> {
  if (!isSnipRect(rect)) return
  const area = selectionInImage(rect, shot.display.bounds, shot.image.getSize())
  if (!area) return
  const result = await imageToText({ data: shot.image.crop(area).toPNG(), mimeType: 'image/png' }, 'screen')
  if (!result.ok) {
    showNotification('error', `Image to text failed: ${result.detail}`)
    return
  }
  await clipboard.writeText(result.text)
  showNotification('success', result.engine === 'ai' ? 'Image to text completed' : 'Image to text completed with Windows OCR')
}

/** The hotkey freezes every display, then lets you drag a box or click a window on one of them. */
export async function startSnip(): Promise<void> {
  if (active) {
    cancelSnip()
    return
  }
  if (starting) return
  starting = true
  try {
    snipFocus.remember()
    const windows = visibleWindows().map((rect) => screen.screenToDipRect(null, rect))
    const shots = await captureDisplays()
    if (shots.length === 0) {
      showNotification('error', 'Image to text could not capture the screen')
      return
    }
    for (const [id, overlay] of overlays) {
      if (!shots.some((shot) => shot.display.id === id)) {
        overlay.window.destroy()
        overlays.delete(id)
      }
    }
    active = true
    revealed = false
    revealTimer = setTimeout(reveal, 1500)
    await Promise.all(shots.map(async (shot) => {
      const overlay = overlayFor(shot.display)
      overlay.shot = shot
      overlay.ready = false
      await overlay.loaded
      if (!active || overlay.window.isDestroyed()) return
      const frame: SnipFrame = {
        image: `data:image/jpeg;base64,${shot.image.toJPEG(92).toString('base64')}`,
        windows: windowsOnDisplay(windows, shot.display.bounds)
      }
      overlay.window.webContents.send('snip-frame', frame)
    }))
  } catch (error: unknown) {
    console.error('Image to text could not start:', error)
    endSnip(null)
    showNotification('error', 'Image to text could not capture the screen')
  } finally {
    starting = false
  }
}

export function setupSnipIpc(): void {
  ipcMain.on('snip-ready', (event) => {
    const overlay = overlayOf(event)
    if (!overlay || !active || !overlay.shot) return
    overlay.ready = true
    if ([...overlays.values()].every((item) => item.window.isDestroyed() || item.ready || !item.shot)) reveal()
  })
  ipcMain.on('snip-pointer-enter', (event) => {
    const overlay = overlayOf(event)
    if (overlay && active && overlay.window.isVisible()) overlay.window.focus()
  })
  ipcMain.on('snip-select', (event, rect: unknown) => {
    const overlay = overlayOf(event)
    const shot = overlay?.shot
    if (!overlay || !active || !shot) return
    endSnip(overlay)
    void readSnip(shot, rect).catch((error: unknown) => {
      console.error('Image to text failed:', error)
      showNotification('error', 'Image to text failed')
    })
  })
  ipcMain.on('snip-cancel', (event) => {
    if (overlayOf(event)) cancelSnip()
  })
  // An overlay sized for the old layout would cover the wrong area.
  const forgetOverlays = (): void => {
    if (!active) closeOverlays()
  }
  screen.on('display-added', forgetOverlays)
  screen.on('display-removed', forgetOverlays)
  screen.on('display-metrics-changed', forgetOverlays)
}
