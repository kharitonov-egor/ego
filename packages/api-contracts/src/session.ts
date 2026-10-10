/** The Worker sends the browser here after Google sign-in. The phone registers the `ego` scheme. */
export const SIGN_IN_RETURN_URL = 'ego://auth'

/** Where a browser asks to come back to, under one of the Worker's `WEB_ORIGINS`. */
export const WEB_SIGN_IN_PATH = '/auth'

/** A browser that keeps its copy stays signed in this long without use; a tab-only sign-in, a day. */
export const BROWSER_IDLE_DAYS = 30
export const TAB_IDLE_DAYS = 1

export interface SignInStartInput {
  deviceName: string
  /** A browser's `<origin>/auth`. The phone and the desktop leave it out and get `ego://auth`. */
  returnUrl?: string
  /** With `returnUrl`: false makes the token lapse after a day without use instead of a month. */
  remember?: boolean
}

/**
 * `exchangeSecret` reaches the phone over this HTTPS response only. The browser and the deep link
 * carry the one-time code, which is useless without the secret.
 */
export interface SignInStartResult {
  authorizationUrl: string
  exchangeSecret: string
  expiresAt: string
}

export interface SignInExchangeInput {
  code: string
  exchangeSecret: string
}

export interface SignInResult {
  token: string
  deviceId: string
  deviceName: string
  email: string
}

/** Which server-held credentials exist. The values themselves never leave the Worker. */
export interface ServiceStatus {
  assistant: boolean
  trello: boolean
  voice: boolean
  google: boolean
  canvas: boolean
  googleHealth: boolean
  /** The Telegram bot's token, webhook secret, and owner are set, so messages to it become Inbox cards. Older servers leave it out. */
  telegram?: boolean
}

export interface SessionInfo {
  deviceId: string
  deviceName: string
  email: string | null
  services: ServiceStatus
}

export interface DeviceSummary {
  id: string
  name: string
  email: string | null
  createdAt: string
  lastSeenAt: string | null
  /** Signed in from a web page rather than the phone or desktop app. */
  browser: boolean
  /** When the token lapses unless it is used before then. Null for the apps, which never lapse. */
  expiresAt: string | null
  /** The device asking. */
  current: boolean
}

export interface DeviceList {
  devices: DeviceSummary[]
}
