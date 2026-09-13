import { net } from 'electron'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  createT3Client,
  diffShell,
  formatDuration,
  parseServerRuntimeOrigin,
  redeemPairingUrl,
  type T3Event,
  type T3Session,
  type T3WatchState
} from '@ego/core'
import { getT3NotifyEnabled, getT3Session, setT3Session } from './settings'
import { presentNotification, type NotificationInput } from './quickAdd'
import { providerGlyph } from './t3Glyphs'
import type { T3PairResult, T3Status } from '../shared/types'

const POLL_INTERVAL_MS = 2000
const BACKOFF_INTERVAL_MS = 30_000
const TOAST_MS = 6000
const RUNTIME_STATE_PATH = join(homedir(), '.t3', 'userdata', 'server-runtime.json')

let timer: ReturnType<typeof setTimeout> | null = null
let watcherGeneration = 0
let running = false
let watchState: T3WatchState | null = null
let lastError: string | null = null
let expired = false

function liveOrigin(): string | null {
  try {
    return parseServerRuntimeOrigin(JSON.parse(readFileSync(RUNTIME_STATE_PATH, 'utf8')))
  } catch {
    return null
  }
}

/**
 * The session token is bound to the server, not to a port, so a moved origin is followed rather
 * than treated as a broken pairing.
 */
function currentSession(): T3Session | null {
  const saved = getT3Session()
  if (!saved) return null

  const origin = liveOrigin()
  if (origin && origin !== saved.origin) {
    const moved = { ...saved, origin }
    setT3Session(moved)
    return moved
  }
  return saved
}

const client = createT3Client({
  getSession: currentSession,
  fetch: (url, init) => net.fetch(url, init),
  onUnauthorized: () => {
    expired = true
  }
})

function toneFor(kind: T3Event['kind']): 'success' | 'error' | 'waiting' {
  if (kind === 'errored') return 'error'
  if (kind === 'waiting') return 'waiting'
  return 'success'
}

function statusFor(kind: T3Event['kind']): string {
  if (kind === 'errored') return 'Failed'
  if (kind === 'waiting') return 'Needs you'
  return 'Finished'
}

/** T3's project icon palette, used when a project has no favicon or emoji to show. */
const ICON_COLORS: Record<string, string> = {
  gray: '#a1a1aa',
  red: '#f87171',
  orange: '#fb923c',
  amber: '#fbbf24',
  yellow: '#facc15',
  lime: '#a3e635',
  green: '#4ade80',
  emerald: '#34d399',
  teal: '#2dd4bf',
  cyan: '#22d3ee',
  sky: '#38bdf8',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  purple: '#c084fc',
  fuchsia: '#e879f9',
  pink: '#f472b6',
  rose: '#fb7185'
}

const iconCache = new Map<string, string | null>()

type ProjectIconFields = Pick<
  NotificationInput,
  'projectEmoji' | 'projectImage' | 'projectInitial' | 'projectColor'
>

async function projectIconFor(event: T3Event): Promise<ProjectIconFields> {
  const project = event.project
  if (!project) return {}

  if (project.emoji) return { projectEmoji: project.emoji }

  if (project.faviconPath) {
    if (!iconCache.has(project.faviconPath)) {
      iconCache.set(project.faviconPath, await client.fetchAssetDataUrl(project.faviconPath))
    }
    const image = iconCache.get(project.faviconPath)
    if (image) return { projectImage: image }
  }

  return {
    projectInitial: project.title.slice(0, 1).toUpperCase(),
    projectColor: ICON_COLORS[project.color ?? 'gray'] ?? ICON_COLORS.gray
  }
}

async function announce(event: T3Event): Promise<void> {
  const detail =
    event.detail ?? (event.kind === 'waiting' ? null : await client.fetchLastTool(event.threadId))

  presentNotification({
    theme: 't3',
    tone: toneFor(event.kind),
    message: event.title,
    project: `${event.project?.title ?? 'T3 Code'} · ${statusFor(event.kind)}`,
    detail: detail ?? undefined,
    model: event.model || undefined,
    providerGlyph: providerGlyph(event.provider) ?? undefined,
    meta: formatDuration(event.durationMs) ?? undefined,
    durationMs: TOAST_MS,
    ...(await projectIconFor(event))
  })
}

async function poll(): Promise<number> {
  if (!getT3NotifyEnabled() || !getT3Session() || expired) {
    watchState = null
    return BACKOFF_INTERVAL_MS
  }

  const shell = await client.fetchShell()
  if (!shell.ok || !shell.data) {
    lastError = shell.detail ?? 'Unknown error'
    watchState = null
    return BACKOFF_INTERVAL_MS
  }

  lastError = null
  const { events, state } = diffShell(watchState, shell.data)
  watchState = state

  for (const event of events) {
    await announce(event)
  }

  return POLL_INTERVAL_MS
}

/**
 * Waking cancels the pending sleep, so a poll already in flight must not schedule the next one.
 * The generation counter retires those stale callbacks instead of letting two loops run.
 */
function schedule(delay: number, generation: number): void {
  if (generation !== watcherGeneration) return

  timer = setTimeout(() => {
    void poll()
      .then((next) => schedule(next, generation))
      .catch(() => schedule(BACKOFF_INTERVAL_MS, generation))
  }, delay)
}

export function startT3Watcher(): void {
  if (running) return
  running = true
  schedule(0, watcherGeneration)
}

export function wakeT3Watcher(): void {
  if (!running) {
    startT3Watcher()
    return
  }

  watcherGeneration += 1
  if (timer) clearTimeout(timer)
  timer = null
  schedule(0, watcherGeneration)
}

export function getT3Status(): T3Status {
  const session = getT3Session()
  return {
    paired: session !== null,
    origin: session?.origin ?? '',
    enabled: getT3NotifyEnabled(),
    watching: watchState !== null,
    threadCount: watchState ? Object.keys(watchState).length : 0,
    expiresAt: session?.expiresAt ?? null,
    expired,
    lastError
  }
}

export async function pairT3(pairingUrl: string): Promise<T3PairResult> {
  const redeemed = await redeemPairingUrl(pairingUrl, (url, init) => net.fetch(url, init))
  if (!redeemed.ok || !redeemed.data) {
    return { ok: false, detail: redeemed.detail ?? 'Pairing failed' }
  }

  setT3Session(redeemed.data)
  expired = false
  watchState = null
  lastError = null

  const shell = await client.fetchShell()
  if (!shell.ok || !shell.data) {
    setT3Session(null)
    return { ok: false, detail: shell.detail ?? 'Paired, but could not read threads' }
  }

  watchState = diffShell(null, shell.data).state
  return { ok: true, origin: redeemed.data.origin, expiresAt: redeemed.data.expiresAt }
}

export function unpairT3(): void {
  setT3Session(null)
  expired = false
  watchState = null
  lastError = null
}
