import type { BrowserWindow } from 'electron'
import type * as Koffi from 'koffi'

export interface ForegroundWindowApi {
  get: () => unknown
  isShown: (window: unknown) => boolean
  focus: (window: unknown) => void
}

let user32Api: ForegroundWindowApi | null | undefined

function user32(): ForegroundWindowApi | null {
  if (user32Api !== undefined) return user32Api
  user32Api = null
  if (process.platform !== 'win32') return null
  try {
    // Required lazily so a native binary that fails to load costs focus return, not app startup.
    const { load }: typeof Koffi = require('koffi')
    const library = load('user32.dll')
    const getForegroundWindow = library.func('void * __stdcall GetForegroundWindow()')
    const isWindowVisible = library.func('int __stdcall IsWindowVisible(void *hwnd)')
    const isIconic = library.func('int __stdcall IsIconic(void *hwnd)')
    const setForegroundWindow = library.func('int __stdcall SetForegroundWindow(void *hwnd)')
    user32Api = {
      get: (): unknown => getForegroundWindow(),
      isShown: (window) => isWindowVisible(window) !== 0 && isIconic(window) === 0,
      focus: (window) => {
        setForegroundWindow(window)
      }
    }
  } catch (error: unknown) {
    console.error('Could not load user32 to return focus:', error)
  }
  return user32Api
}

type Overlay = Pick<BrowserWindow, 'isDestroyed' | 'isFocused'> | null

export interface FocusReturn {
  remember: (overlay?: Overlay) => void
  restore: (overlay: Overlay) => void
}

/**
 * Windows focuses nothing when an overlay hides, so the overlay keeps the window that was in front
 * when it opened and gives focus back to it on close. Call restore before hiding the overlay,
 * because Windows only lets the foreground process hand focus to another app.
 */
export function focusReturn(windows: () => ForegroundWindowApi | null = user32): FocusReturn {
  let target: unknown = null

  const isFocused = (overlay: Overlay): boolean =>
    Boolean(overlay && !overlay.isDestroyed() && overlay.isFocused())

  return {
    remember: (overlay = null) => {
      if (isFocused(overlay)) return
      target = windows()?.get() ?? null
    },
    restore: (overlay) => {
      const window = target
      target = null
      const api = windows()
      // A hidden or minimized window would take the keystrokes out of sight.
      if (window && api && isFocused(overlay) && api.isShown(window)) api.focus(window)
    }
  }
}
