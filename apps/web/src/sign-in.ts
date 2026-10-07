import { WEB_SIGN_IN_PATH } from '@ego/api-contracts'
import { exchangeSignIn, moneyApiFor, normalizeApiUrl, startSignIn } from '@ego/local/api-client'
import { signInErrorMessage } from '@ego/local/sign-in'
import type { SignInOutcome } from '@ego/ui/platform/local'
import { adoptSession, currentSession, endSession, ledgerApi } from './ledger'
import { browserName, savePendingSignIn, takePendingSignIn, type WebSession } from './session'

function isWorkerAddress(address: string): boolean {
  return /^https:\/\//.test(address)
}

/** Tells the Worker this browser's old token is done, once a new one replaced it. */
function retire(previous: WebSession | null, token: string): void {
  if (previous?.token && previous.token !== token) void moneyApiFor({ url: previous.apiUrl, token: previous.token }).signOut()
}

/** Leaves for Google in this tab. Google sends the browser back to `/auth` with a one-time code. */
export async function beginGoogleSignIn(apiUrl: string, remember: boolean): Promise<SignInOutcome> {
  const address = normalizeApiUrl(apiUrl)
  if (!isWorkerAddress(address)) return { ok: false, message: 'Enter the Worker address, starting with https://' }
  const started = await startSignIn(address, browserName(), { returnUrl: `${location.origin}${WEB_SIGN_IN_PATH}`, remember })
  if (!started.ok) return { ok: false, message: started.error.message }
  savePendingSignIn({ apiUrl: address, exchangeSecret: started.data.exchangeSecret, expiresAt: started.data.expiresAt, remember })
  location.assign(started.data.authorizationUrl)
  return { ok: true }
}

export function isSignInReturn(): boolean {
  return location.pathname === WEB_SIGN_IN_PATH
}

/** Redeems the code Google's round trip brought back, with the secret this tab kept for it. */
export async function finishGoogleSignIn(params: URLSearchParams): Promise<SignInOutcome> {
  const started = takePendingSignIn()
  const code = params.get('code')
  const reason = params.get('error')
  if (reason || !code) return { ok: false, message: signInErrorMessage(reason) }
  if (!started || started.expiresAt <= new Date().toISOString()) {
    return { ok: false, message: 'This sign-in started too long ago. Try again from the start screen.' }
  }
  const exchanged = await exchangeSignIn(started.apiUrl, code, started.exchangeSecret)
  if (!exchanged.ok) return { ok: false, message: exchanged.error.message }
  const previous = currentSession()
  await adoptSession({
    apiUrl: started.apiUrl,
    token: exchanged.data.token,
    account: { email: exchanged.data.email, deviceId: exchanged.data.deviceId, deviceName: exchanged.data.deviceName },
    remember: started.remember
  })
  retire(previous, exchanged.data.token)
  return { ok: true }
}

/** For a token from `ego-device enroll`. It never lapses, unlike a Google sign-in from a browser. */
export async function connectWithToken(apiUrl: string, token: string): Promise<SignInOutcome> {
  const address = normalizeApiUrl(apiUrl)
  const trimmed = token.trim()
  if (!isWorkerAddress(address) || trimmed.length < 32) {
    return { ok: false, message: 'Enter the Worker address and the full token from ego-device enroll.' }
  }
  const previous = currentSession()
  await adoptSession({ apiUrl: address, token: trimmed, account: null, remember: previous?.remember ?? true })
  retire(previous, trimmed)
  return { ok: true }
}

export async function signOut(): Promise<void> {
  await ledgerApi().signOut()
  await endSession()
}
