/** The Worker sends the browser here once Google Health access is granted or refused. */
export const HEALTH_RETURN_URL = 'ego://health'

/** One day of Google Health numbers. Null means the band recorded nothing for that metric that day. */
export interface HealthDay {
  date: string
  steps: number | null
  distanceMeters: number | null
  caloriesKcal: number | null
  /** Active Zone Minutes by zone. Cardio and peak minutes already count double, as Google counts them. */
  fatBurnMinutes: number | null
  cardioMinutes: number | null
  peakMinutes: number | null
  restingHeartRate: number | null
  /** Nightly RMSSD in milliseconds. */
  hrvMs: number | null
  heartRateMin: number | null
  heartRateAvg: number | null
  heartRateMax: number | null
  weightKg: number | null
  updatedAt: string
}

export type HealthSleepStageKind = 'awake' | 'light' | 'deep' | 'rem' | 'asleep' | 'restless'

/** One segment of a night, in minutes from the start of the session. */
export interface HealthSleepStage {
  kind: HealthSleepStageKind
  start: number
  minutes: number
}

export interface HealthSleep {
  id: string
  /** The day the session ended, which is the day Google files it under. */
  date: string
  startTime: string
  endTime: string
  /** Wall-clock times where the sleep happened, as YYYY-MM-DDTHH:mm. */
  startLocal: string
  endLocal: string
  minutesAsleep: number
  minutesAwake: number
  minutesInBed: number
  deepMinutes: number | null
  lightMinutes: number | null
  remMinutes: number | null
  nap: boolean
  stages: HealthSleepStage[]
  /** Removed in Google Health since the phone last saw it. */
  deleted: boolean
  updatedAt: string
}

/** Five-minute heart rate averages for one day, as [minute of the day, beats per minute]. */
export interface HealthHeartDay {
  date: string
  points: Array<[number, number]>
  updatedAt: string
}

export interface HealthDevice {
  name: string
  batteryLevel: number | null
  lastSyncAt: string | null
}

/** Which Google Health permissions the connection holds. Google lets the user untick any of them. */
export interface HealthGrants {
  activity: boolean
  body: boolean
  sleep: boolean
  settings: boolean
}

export interface HealthConnection {
  connected: boolean
  accountLabel: string | null
  grants: HealthGrants
  lastSyncAt: string | null
  /** The last sync failed with this message. Data already in D1 is still served. */
  lastError: string | null
  /** The earliest day the Worker has downloaded. */
  historyFrom: string | null
  historyComplete: boolean
  timeZone: string | null
  device: HealthDevice | null
}

export interface HealthSnapshot {
  connection: HealthConnection
  days: HealthDay[]
  sleeps: HealthSleep[]
  heart: HealthHeartDay[]
  /** Send this back as `since` to receive only what changed after this read. */
  serverTime: string
}

export interface HealthSyncRequest {
  since: string | null
  /** The phone's IANA zone, used until Google Health reports the account's own. */
  timeZone: string | null
}

export interface HealthConnectStart {
  authorizationUrl: string
  expiresAt: string
}

/** How much Google Health history the first sync downloads. */
export const HEALTH_HISTORY_DAYS = 365
/** Heart rate curves go back this far. Older days keep their daily minimum, average, and maximum. */
export const HEALTH_HEART_CURVE_DAYS = 14
