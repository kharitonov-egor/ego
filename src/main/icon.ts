import { nativeImage, type NativeImage } from 'electron'

/** Ego ships without an icon for now; Electron falls back to its default chrome. */
export function getAppIconPath(): string | undefined {
  return undefined
}

export function getTrayIcon(): NativeImage {
  return nativeImage.createEmpty()
}
