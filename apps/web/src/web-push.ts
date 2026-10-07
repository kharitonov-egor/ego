import { isWebPushSubscriptionInput, type WebPushSubscriptionInput } from '@ego/api-contracts'
import type { PushState, PushSubscribeResult } from '@ego/ui/platform/types'

/** `ready` never settles when the service worker failed to register, so it gets a deadline. */
const READY_MS = 5000
const BLOCKED = "Notifications are blocked for this site. Allow them in the browser's site settings."

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw new Error('Not base64url')
  const base64 = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** The Worker's VAPID public key as PushManager wants it, or null unless it is an uncompressed P-256 point. */
export function vapidKey(publicKey: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bytes = base64UrlToBytes(publicKey)
    return bytes.length === 65 && bytes[0] === 4 ? bytes : null
  } catch {
    return null
  }
}

export function subscriptionInput(json: PushSubscriptionJSON): WebPushSubscriptionInput | null {
  const input = { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } }
  return isWebPushSubscriptionInput(input) ? input : null
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current || current.byteLength !== wanted.length) return false
  const bytes = new Uint8Array(current)
  return wanted.every((byte, index) => bytes[index] === byte)
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_MS))
  ])
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return { supported: false, permission: 'default', endpoint: null }
  const subscription = await (await registration())?.pushManager.getSubscription().catch(() => null)
  return { supported: true, permission: Notification.permission, endpoint: subscription?.endpoint ?? null }
}

export async function pushSubscribe(publicKey: string): Promise<PushSubscribeResult> {
  if (!pushSupported()) return { ok: false, message: 'This browser cannot get push notifications.' }
  const key = vapidKey(publicKey)
  if (!key) return { ok: false, message: "The Worker's Web Push key is not a P-256 public key." }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (permission === 'denied') return { ok: false, message: BLOCKED }
  if (permission !== 'granted') return { ok: false, message: 'Allow notifications when the browser asks.' }
  const active = await registration()
  if (!active) return { ok: false, message: 'The service worker is not running. Reload the page and try again.' }
  try {
    const existing = await active.pushManager.getSubscription()
    // A subscription made with an older key pair blocks a new one until it is dropped.
    if (existing && !sameKey(existing.options.applicationServerKey, key)) await existing.unsubscribe()
    const subscription = await active.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const input = subscriptionInput(subscription.toJSON())
    return input ? { ok: true, subscription: input } : { ok: false, message: 'The browser gave a subscription without its keys.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : 'The browser could not subscribe.' }
  }
}

export async function pushUnsubscribe(): Promise<string | null> {
  if (!pushSupported()) return null
  const subscription = await (await registration())?.pushManager.getSubscription().catch(() => null)
  if (!subscription) return null
  await subscription.unsubscribe().catch(() => false)
  return subscription.endpoint
}
