import { Linking, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import type { SignInResult } from '@ego/api-contracts'
import { exchangeSignIn, startSignIn } from './api-client'

const PENDING_KEY = 'ego.signin.pending'

interface PendingSignIn {
  apiUrl: string
  exchangeSecret: string
  expiresAt: string
}

export type SignInOutcome =
  | { ok: true; apiUrl: string; result: SignInResult }
  | { ok: false; message: string }

function deviceName(): string {
  return Constants.deviceName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')
}

function parsePending(raw: string | null): PendingSignIn | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { apiUrl, exchangeSecret, expiresAt } = value as Record<string, unknown>
    if (typeof apiUrl !== 'string' || typeof exchangeSecret !== 'string' || typeof expiresAt !== 'string') return null
    return { apiUrl, exchangeSecret, expiresAt }
  } catch {
    return null
  }
}

/**
 * The exchange secret is kept in SecureStore rather than memory because Android may stop the
 * app while the browser is in front.
 */
export async function beginGoogleSignIn(apiUrl: string): Promise<string | null> {
  const started = await startSignIn(apiUrl, deviceName())
  if (!started.ok) return started.error.message
  const pending: PendingSignIn = {
    apiUrl,
    exchangeSecret: started.data.exchangeSecret,
    expiresAt: started.data.expiresAt
  }
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending))
  try {
    await Linking.openURL(started.data.authorizationUrl)
  } catch {
    return 'The phone could not open a browser for Google sign-in.'
  }
  return null
}

export async function finishGoogleSignIn(code: string): Promise<SignInOutcome> {
  const pending = parsePending(await SecureStore.getItemAsync(PENDING_KEY).catch(() => null))
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined)
  if (!pending || pending.expiresAt <= new Date().toISOString()) {
    return { ok: false, message: 'This sign-in started too long ago. Try again from Settings.' }
  }
  const exchanged = await exchangeSignIn(pending.apiUrl, code, pending.exchangeSecret)
  if (!exchanged.ok) return { ok: false, message: exchanged.error.message }
  return { ok: true, apiUrl: pending.apiUrl, result: exchanged.data }
}

export async function abandonGoogleSignIn(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined)
}

export function signInErrorMessage(reason: string | undefined): string {
  if (reason === 'cancelled') return 'Sign-in was cancelled.'
  if (reason === 'not_allowed') return 'That Google account is not allowed on this server. Choose the account listed in ALLOWED_EMAILS.'
  if (reason === 'expired') return 'That sign-in link expired or was already used. Try again.'
  return 'Google sign-in did not finish. Try again.'
}
