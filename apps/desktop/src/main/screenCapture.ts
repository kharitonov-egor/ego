import { desktopCapturer, nativeImage, screen, type Display, type NativeImage, type Rectangle } from 'electron'
import type * as Koffi from 'koffi'

export interface DisplayShot {
  display: Display
  /** The display at its own pixel density, so text stays as sharp as it is on screen. */
  image: NativeImage
}

interface VirtualScreenFrame {
  x: number
  y: number
  width: number
  height: number
  pixels: Buffer
}

interface Win32Capture {
  grab: () => VirtualScreenFrame
  windows: () => Rectangle[]
}

const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
/** No CAPTUREBLT: it makes the cursor flicker, and Windows 8 and later copy layered windows without it. */
const SRCCOPY = 0x00cc0020
const GWL_EXSTYLE = -20
const WS_EX_TRANSPARENT = 0x20
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW'])

let win32Api: Win32Capture | null | undefined

function win32(): Win32Capture | null {
  if (win32Api !== undefined) return win32Api
  win32Api = null
  if (process.platform !== 'win32') return null
  try {
    const koffi: typeof Koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    const RECT = koffi.struct('EGO_CAPTURE_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
    const BITMAPINFOHEADER = koffi.struct('EGO_CAPTURE_BITMAPINFOHEADER', {
      biSize: 'uint32_t', biWidth: 'int32_t', biHeight: 'int32_t', biPlanes: 'uint16_t', biBitCount: 'uint16_t',
      biCompression: 'uint32_t', biSizeImage: 'uint32_t', biXPelsPerMeter: 'int32_t', biYPelsPerMeter: 'int32_t',
      biClrUsed: 'uint32_t', biClrImportant: 'uint32_t'
    })
    koffi.proto('int __stdcall EGO_CAPTURE_ENUM_PROC(void *hwnd, intptr_t param)')
    const getSystemMetrics: (index: number) => number = user32.func('int __stdcall GetSystemMetrics(int index)')
    const getDC: (hwnd: null) => unknown = user32.func('void * __stdcall GetDC(void *hwnd)')
    const releaseDC: (hwnd: null, dc: unknown) => number = user32.func('int __stdcall ReleaseDC(void *hwnd, void *dc)')
    const enumWindows: (proc: (hwnd: unknown) => number, param: number) => number = user32.func('int __stdcall EnumWindows(EGO_CAPTURE_ENUM_PROC *proc, intptr_t param)')
    const isWindowVisible: (hwnd: unknown) => number = user32.func('int __stdcall IsWindowVisible(void *hwnd)')
    const isIconic: (hwnd: unknown) => number = user32.func('int __stdcall IsIconic(void *hwnd)')
    const getClassName: (hwnd: unknown, name: Uint16Array, length: number) => number = user32.func('int __stdcall GetClassNameW(void *hwnd, _Out_ uint16_t *name, int length)')
    const getWindowLong: (hwnd: unknown, index: number) => number = user32.func('long __stdcall GetWindowLongW(void *hwnd, int index)')
    const createCompatibleDC: (dc: unknown) => unknown = gdi32.func('void * __stdcall CreateCompatibleDC(void *dc)')
    const createCompatibleBitmap: (dc: unknown, width: number, height: number) => unknown = gdi32.func('void * __stdcall CreateCompatibleBitmap(void *dc, int width, int height)')
    const selectObject: (dc: unknown, object: unknown) => unknown = gdi32.func('void * __stdcall SelectObject(void *dc, void *object)')
    const bitBlt: (dc: unknown, x: number, y: number, width: number, height: number, source: unknown, sourceX: number, sourceY: number, operation: number) => number = gdi32.func('int __stdcall BitBlt(void *dc, int x, int y, int width, int height, void *source, int sourceX, int sourceY, uint32_t operation)')
    const getDIBits: (dc: unknown, bitmap: unknown, start: number, lines: number, bits: Buffer, info: Record<string, number>, usage: number) => number = gdi32.func('int __stdcall GetDIBits(void *dc, void *bitmap, uint32_t start, uint32_t lines, _Out_ uint8_t *bits, EGO_CAPTURE_BITMAPINFOHEADER *info, uint32_t usage)')
    const deleteObject: (object: unknown) => number = gdi32.func('int __stdcall DeleteObject(void *object)')
    const deleteDC: (dc: unknown) => number = gdi32.func('int __stdcall DeleteDC(void *dc)')
    const frameBounds: (hwnd: unknown, attribute: number, value: Record<string, number>, size: number) => number = dwmapi.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ EGO_CAPTURE_RECT *value, uint32_t size)')
    const cloakedState: (hwnd: unknown, attribute: number, value: number[], size: number) => number = dwmapi.func('DwmGetWindowAttribute', 'long', ['void *', 'uint32_t', koffi.out(koffi.pointer('uint32_t')), 'uint32_t'])

    const grab = (): VirtualScreenFrame => {
      const x = getSystemMetrics(SM_XVIRTUALSCREEN)
      const y = getSystemMetrics(SM_YVIRTUALSCREEN)
      const width = getSystemMetrics(SM_CXVIRTUALSCREEN)
      const height = getSystemMetrics(SM_CYVIRTUALSCREEN)
      const screenDC = getDC(null)
      const memoryDC = createCompatibleDC(screenDC)
      const bitmap = createCompatibleBitmap(screenDC, width, height)
      try {
        const previous = selectObject(memoryDC, bitmap)
        const copied = bitBlt(memoryDC, 0, 0, width, height, screenDC, x, y, SRCCOPY)
        selectObject(memoryDC, previous)
        if (!copied) throw new Error('BitBlt could not copy the screen')
        const pixels = Buffer.alloc(width * height * 4)
        const header = {
          biSize: koffi.sizeof(BITMAPINFOHEADER), biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32,
          biCompression: 0, biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0, biClrUsed: 0, biClrImportant: 0
        }
        if (getDIBits(memoryDC, bitmap, 0, height, pixels, header, 0) !== height) throw new Error('GetDIBits returned too few lines')
        // GDI leaves the alpha byte at zero, which would make every pixel transparent.
        const words = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height)
        for (let index = 0; index < words.length; index++) words[index] |= 0xff000000
        return { x, y, width, height, pixels }
      } finally {
        deleteObject(bitmap)
        deleteDC(memoryDC)
        releaseDC(null, screenDC)
      }
    }

    const windows = (): Rectangle[] => {
      const found: Rectangle[] = []
      const className = new Uint16Array(64)
      enumWindows((hwnd: unknown) => {
        if (!isWindowVisible(hwnd) || isIconic(hwnd)) return 1
        if ((getWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT) !== 0) return 1
        const cloaked = [0]
        if (cloakedState(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return 1
        const length = getClassName(hwnd, className, className.length)
        if (DESKTOP_CLASSES.has(String.fromCharCode(...className.subarray(0, length)))) return 1
        const rect = { left: 0, top: 0, right: 0, bottom: 0 }
        if (frameBounds(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, koffi.sizeof(RECT)) !== 0) return 1
        const width = rect.right - rect.left
        const height = rect.bottom - rect.top
        if (width >= 24 && height >= 24) found.push({ x: rect.left, y: rect.top, width, height })
        return 1
      }, 0)
      return found
    }

    win32Api = { grab, windows }
  } catch (error: unknown) {
    console.error('Could not load the Windows screen capture functions:', error)
  }
  return win32Api
}

/** Every visible top-level window in screen pixels, topmost first, leaving out the desktop itself. */
export function visibleWindows(): Rectangle[] {
  try {
    return win32()?.windows() ?? []
  } catch (error: unknown) {
    console.error('Could not list windows:', error)
    return []
  }
}

function grabWithGdi(displays: Display[]): DisplayShot[] | null {
  const api = win32()
  if (!api) return null
  try {
    const frame = api.grab()
    const whole = nativeImage.createFromBitmap(frame.pixels, { width: frame.width, height: frame.height })
    return displays.map((display) => {
      const area = screen.dipToScreenRect(null, display.bounds)
      return { display, image: whole.crop({ x: area.x - frame.x, y: area.y - frame.y, width: area.width, height: area.height }) }
    })
  } catch (error: unknown) {
    console.error('GDI screen capture failed:', error)
    return null
  }
}

/** GDI takes about 60 ms for both monitors. Electron's capturer takes 600 ms, and 2 s the first time. */
export async function captureDisplays(): Promise<DisplayShot[]> {
  const displays = screen.getAllDisplays()
  const shots = grabWithGdi(displays)
  if (shots) return shots
  const largest = displays.reduce((size, display) => ({
    width: Math.max(size.width, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(size.height, Math.round(display.bounds.height * display.scaleFactor))
  }), { width: 0, height: 0 })
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: largest })
  return displays.flatMap((display) => {
    const source = sources.find((item) => item.display_id === String(display.id))
    return source ? [{ display, image: source.thumbnail }] : []
  })
}
