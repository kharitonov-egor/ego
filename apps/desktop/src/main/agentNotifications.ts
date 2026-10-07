import type { AgentNotification } from '@ego/api-contracts'
import type { NotifyInput } from '@ego/ui/platform/local'
import { isSignedIn, ledgerApi, ledgerApiUrl, onLedgerEvent } from './local/ledger'
import { getAgentNotificationCursor, getWaitingAgentNotifications, setAgentNotificationCursor, setWaitingAgentNotifications } from './settings'

const POLL_MS = 60 * 1000
const SCHEDULE_AHEAD_MS = 24 * 60 * 60 * 1000
/** A computer that was off for a day should not open with a stack of old toasts the phone already showed. */
const STALE_MS = 6 * 60 * 60 * 1000
const ROUTE = '/ai?chat=agent'

interface Waiting {
  notification: AgentNotification
  timer: ReturnType<typeof setTimeout>
}

const shown = new Set<string>()
const waiting = new Map<string, Waiting>()
let show: ((input: NotifyInput) => void) | null = null
let poller: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null
let polling = false
let workerUrl = ''
let desktopOn = true

function present(notification: AgentNotification): void {
  if (shown.has(notification.id) || !desktopOn || !isSignedIn()) return
  shown.add(notification.id)
  show?.({ title: notification.title, body: notification.body, route: ROUTE })
}

function saveWaiting(): void {
  if (workerUrl) setWaitingAgentNotifications(workerUrl, [...waiting.values()].map((entry) => entry.notification))
}

function due(id: string): void {
  const entry = waiting.get(id)
  if (!entry) return
  clearTimeout(entry.timer)
  waiting.delete(id)
  saveWaiting()
  present(entry.notification)
}

/** Timers fall behind while Windows sleeps, so every tick also shows whatever is already due. */
function showDue(now: number): void {
  for (const [id, entry] of waiting) if (Date.parse(entry.notification.deliverAt) <= now) due(id)
}

function clearWaiting(): void {
  for (const entry of waiting.values()) clearTimeout(entry.timer)
  waiting.clear()
}

function consider(notification: AgentNotification, now: number): void {
  if (notification.silent || shown.has(notification.id) || waiting.has(notification.id)) return
  const at = Date.parse(notification.deliverAt)
  if (Number.isNaN(at)) return
  if (at <= now) {
    if (now - at <= STALE_MS) present(notification)
    return
  }
  if (at - now > SCHEDULE_AHEAD_MS) return
  waiting.set(notification.id, { notification, timer: setTimeout(() => due(notification.id), at - now) })
}

async function poll(): Promise<void> {
  if (!isSignedIn()) {
    clearWaiting()
    return
  }
  showDue(Date.now())
  if (polling) return
  polling = true
  try {
    const apiUrl = ledgerApiUrl()
    if (apiUrl !== workerUrl) {
      clearWaiting()
      workerUrl = apiUrl
      for (const notification of getWaitingAgentNotifications(apiUrl)) consider(notification, Date.now())
    }
    const cursor = getAgentNotificationCursor(apiUrl)
    const result = await ledgerApi().agentNotifications(cursor).catch(() => null)
    if (!result?.ok || ledgerApiUrl() !== apiUrl) return
    const page = result.data
    desktopOn = page.devices.desktop
    const now = Date.now()
    if (desktopOn) for (const notification of page.notifications) consider(notification, now)
    saveWaiting()
    if (page.cursor && page.cursor !== cursor) setAgentNotificationCursor(apiUrl, page.cursor)
  } finally {
    polling = false
  }
}

/** Shows what the background agent posts while this computer is signed in, through the app's own notifications. */
export function startAgentNotifications(notify: (input: NotifyInput) => void): void {
  show = notify
  const tick = (): void => { void poll().catch(() => undefined) }
  tick()
  poller ??= setInterval(tick, POLL_MS)
  unsubscribe ??= onLedgerEvent((event) => {
    if (event.reopened) tick()
  })
}

export function stopAgentNotifications(): void {
  if (poller) clearInterval(poller)
  poller = null
  unsubscribe?.()
  unsubscribe = null
  clearWaiting()
}
