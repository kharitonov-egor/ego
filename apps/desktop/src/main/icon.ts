import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'

const appIconFileName = 'app-icon.png'

export function getAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, appIconFileName)
    : join(app.getAppPath(), 'resources', appIconFileName)
}

export function getTrayIcon(): NativeImage {
  const icon = nativeImage.createFromPath(getAppIconPath())

  if (icon.isEmpty()) {
    return nativeImage.createEmpty()
  }

  return icon.resize({ width: 16, height: 16 })
}
