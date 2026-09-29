/** A finished Android preview build that the phone can install over itself. */
export interface AppBuild {
  id: string
  /** The app.json version, which is also the OTA runtime version. */
  appVersion: string
  /** The Android versionCode. EAS raises it on every build, so a higher one is newer. */
  buildNumber: number
  apkUrl: string
  /** First line of the commit message the build came from. */
  title: string | null
  commit: string | null
  completedAt: string
  /** EAS deletes internal builds after this. */
  expiresAt: string | null
}

export interface AppBuildStatus {
  /** False until the Worker has EAS_WEBHOOK_SECRET, without which it rejects build reports. */
  webhookReady: boolean
  latest: AppBuild | null
}
