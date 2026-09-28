/** The Worker sends the browser here after Google sign-in. The phone registers the `ego` scheme. */
export const SIGN_IN_RETURN_URL = 'ego://auth'

export interface SignInStartInput {
  deviceName: string
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
  moneyAgent: boolean
  trello: boolean
  voice: boolean
  google: boolean
}

export interface SessionInfo {
  deviceId: string
  deviceName: string
  email: string | null
  services: ServiceStatus
}
