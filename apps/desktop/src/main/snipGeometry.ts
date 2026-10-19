import type { SnipRect } from '@ego/ui/platform/types'

interface Size {
  width: number
  height: number
}

export function isSnipRect(value: unknown): value is SnipRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
}

/** The windows that show on one display, clipped to it and moved into its own coordinates. */
export function windowsOnDisplay(windows: SnipRect[], display: SnipRect): SnipRect[] {
  return windows.flatMap((window) => {
    const left = Math.max(window.x, display.x)
    const top = Math.max(window.y, display.y)
    const right = Math.min(window.x + window.width, display.x + display.width)
    const bottom = Math.min(window.y + window.height, display.y + display.height)
    return right - left >= 8 && bottom - top >= 8
      ? [{ x: left - display.x, y: top - display.y, width: right - left, height: bottom - top }]
      : []
  })
}

/**
 * Turns a selection in the overlay's CSS pixels into image pixels. The image can be denser than
 * the display's coordinates, at 125% scaling or when Electron's capturer stretched a smaller screen.
 */
export function selectionInImage(rect: SnipRect, display: Size, image: Size): SnipRect | null {
  const scaleX = image.width / display.width
  const scaleY = image.height / display.height
  const left = Math.max(0, Math.round(rect.x * scaleX))
  const top = Math.max(0, Math.round(rect.y * scaleY))
  const right = Math.min(image.width, Math.round((rect.x + rect.width) * scaleX))
  const bottom = Math.min(image.height, Math.round((rect.y + rect.height) * scaleY))
  return right - left >= 2 && bottom - top >= 2 ? { x: left, y: top, width: right - left, height: bottom - top } : null
}
