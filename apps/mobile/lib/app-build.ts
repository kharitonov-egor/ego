import { useEffect, useState, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import * as Application from 'expo-application'
import { Directory, File, Paths } from 'expo-file-system'
import type { AppBuild, AppBuildStatus } from '@ego/api-contracts'
import type { EgoApi } from '@ego/local/api-client'
import { outsideApp } from './private-lock'

const APK_TYPE = 'application/vnd.android.package-archive'
const FLAG_GRANT_READ_URI_PERMISSION = 1

export const canInstallBuilds = Platform.OS === 'android'

/** The Android versionCode baked into the APK. An OTA update cannot change it. */
export function installedBuildNumber(): number | null {
  const value = Number(Application.nativeBuildVersion)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function newerBuild(latest: AppBuild | null, installed: number | null): AppBuild | null {
  return latest && installed !== null && latest.buildNumber > installed ? latest : null
}

export type InstallState =
  | { step: 'idle' }
  | { step: 'downloading'; buildNumber: number; percent: number | null }
  | { step: 'failed'; buildNumber: number; message: string }

/** Module state, so leaving Settings mid-download neither loses the progress nor starts a second copy. */
let installState: InstallState = { step: 'idle' }
const listeners = new Set<() => void>()

function setInstallState(next: InstallState): void {
  installState = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, () => installState)
}

function apkName(buildNumber: number): string {
  return `ego-${buildNumber}.apk`
}

function buildFolder(): Directory {
  const folder = new Directory(Paths.cache, 'app-builds')
  if (!folder.exists) folder.create({ intermediates: true })
  return folder
}

/** An APK runs past 100 MB, so a copy for any build other than the one on offer is deleted. */
function removeOtherApks(keep: number | null): void {
  if (installState.step === 'downloading') return
  const kept = keep === null ? null : apkName(keep)
  for (const entry of buildFolder().list()) {
    if (entry instanceof File && (kept === null || !entry.name.startsWith(kept))) entry.delete()
  }
}

/**
 * Downloads the APK into the cache, then hands it to Android's package installer. Android asks
 * before replacing the app and keeps its data. The APK stays cached until a newer build replaces
 * it, so backing out of the installer and tapping again skips the download.
 */
export async function installBuild(build: AppBuild): Promise<void> {
  if (installState.step === 'downloading') return
  const folder = buildFolder()
  const apk = new File(folder, apkName(build.buildNumber))
  const partial = new File(folder, `${apkName(build.buildNumber)}.part`)
  try {
    if (!apk.exists) {
      setInstallState({ step: 'downloading', buildNumber: build.buildNumber, percent: null })
      await File.downloadFileAsync(build.apkUrl, partial, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes <= 0) return
          const percent = Math.floor(bytesWritten / totalBytes * 100)
          if (installState.step === 'downloading' && installState.percent !== percent) {
            setInstallState({ step: 'downloading', buildNumber: build.buildNumber, percent })
          }
        }
      })
      partial.rename(apk.name)
    }
    setInstallState({ step: 'idle' })
    const { startActivityAsync } = await import('expo-intent-launcher')
    await outsideApp(() => startActivityAsync('android.intent.action.VIEW', {
      data: apk.contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      type: APK_TYPE
    }))
  } catch (failure: unknown) {
    if (partial.exists) partial.delete()
    setInstallState({
      step: 'failed',
      buildNumber: build.buildNumber,
      message: failure instanceof Error ? failure.message : 'The download stopped'
    })
  }
}

export function useLatestBuild(api: EgoApi): { status: AppBuildStatus | null; error: string | null } {
  const [status, setStatus] = useState<AppBuildStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!canInstallBuilds) return
    let cancelled = false
    void api.appBuilds().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setStatus(result.data)
      setError(null)
      const offered = newerBuild(result.data.latest, installedBuildNumber())
      void Promise.resolve().then(() => removeOtherApks(offered?.buildNumber ?? null)).catch(() => undefined)
    })
    return () => { cancelled = true }
  }, [api])
  return { status, error }
}
