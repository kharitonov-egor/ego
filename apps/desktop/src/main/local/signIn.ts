import { app, shell } from 'electron'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { SIGN_IN_RETURN_URL } from '@ego/api-contracts'
import { exchangeSignIn, moneyApiFor, normalizeApiUrl, startSignIn } from '@ego/local/api-client'
import { signInErrorMessage } from '@ego/local/sign-in'
import type { SignInOutcome } from '@ego/ui/platform/local'
import { getLedgerConfig, getLedgerToken, setAccount, setLedgerConfig } from '../settings'
import { ledgerApi, reopenLedger } from './ledger'

interface PendingSignIn {
  apiUrl: string
  exchangeSecret: string
  expiresAt: string
}

/** Held in memory: the tray app keeps running while the browser is in front. */
let pending: PendingSignIn | null = null

/**
 * Makes this copy of Ego the one Windows hands ego:// links to. It runs again before each sign-in,
 * because a dev run started since then may have taken the links over.
 */
export function registerSignInLinks(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('ego', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('ego')
  }
}

function isWorkerAddress(address: string): boolean {
  return /^https:\/\//.test(address)
}

/** Replaces the token this computer used before and tells the Worker to stop accepting the old one. */
async function useConnection(apiUrl: string, token: string): Promise<void> {
  const replaced = { url: normalizeApiUrl(getLedgerConfig().url), token: getLedgerToken() }
  setLedgerConfig({ url: apiUrl, token })
  if (replaced.token && replaced.token !== token) void moneyApiFor(replaced).signOut()
  await reopenLedger()
}

export async function beginGoogleSignIn(apiUrl: string): Promise<SignInOutcome> {
  const address = normalizeApiUrl(apiUrl)
  if (!isWorkerAddress(address)) return { ok: false, message: 'Enter the Worker address, starting with https://' }
  registerSignInLinks()
  const started = await startSignIn(address, hostname())
  if (!started.ok) return { ok: false, message: started.error.message }
  pending = { apiUrl: address, exchangeSecret: started.data.exchangeSecret, expiresAt: started.data.expiresAt }
  try {
    await shell.openExternal(started.data.authorizationUrl)
  } catch {
    return { ok: false, message: 'Windows could not open a browser for Google sign-in.' }
  }
  return { ok: true }
}

/** Windows hands the `ego://auth` link to a second copy of Ego as a command-line argument. */
export function signInLinkIn(argv: readonly string[]): string | null {
  return argv.find((value) => value.startsWith(`${SIGN_IN_RETURN_URL}?`)) ?? null
}

export async function finishGoogleSignIn(link: string): Promise<SignInOutcome> {
  const started = pending
  pending = null
  let params: URLSearchParams
  try {
    params = new URL(link).searchParams
  } catch {
    return { ok: false, message: signInErrorMessage(null) }
  }
  const code = params.get('code')
  const reason = params.get('error')
  if (reason || !code) return { ok: false, message: signInErrorMessage(reason) }
  if (!started || started.expiresAt <= new Date().toISOString()) {
    return { ok: false, message: 'This sign-in started too long ago. Try again from the start screen.' }
  }
  const exchanged = await exchangeSignIn(started.apiUrl, code, started.exchangeSecret)
  if (!exchanged.ok) return { ok: false, message: exchanged.error.message }
  setAccount({
    email: exchanged.data.email,
    deviceId: exchanged.data.deviceId,
    deviceName: exchanged.data.deviceName
  })
  await useConnection(started.apiUrl, exchanged.data.token)
  return { ok: true }
}

/** For a token from `ego-device enroll`, when Google sign-in is not set up on the Worker. */
export async function useDeviceToken(apiUrl: string, token: string): Promise<SignInOutcome> {
  const address = normalizeApiUrl(apiUrl)
  const trimmed = token.trim()
  if (!isWorkerAddress(address) || trimmed.length < 32) {
    return { ok: false, message: 'Enter the Worker address and the full token from ego-device enroll.' }
  }
  setAccount(null)
  await useConnection(address, trimmed)
  return { ok: true }
}

/** Local data stays on this computer for the next sign-in, like on the phone. */
export async function signOut(): Promise<void> {
  await ledgerApi().signOut()
  setLedgerConfig({ url: getLedgerConfig().url, token: '' })
  setAccount(null)
  await reopenLedger()
}
