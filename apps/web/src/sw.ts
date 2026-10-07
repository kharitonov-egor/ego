/// <reference lib="webworker" />
import type { MediaAnswer, MediaQuestion } from './media-protocol'
import type { OpenRequest } from './notification-protocol'
import { clickedRoute, parsePushPayload } from './push-payload'

declare const self: ServiceWorkerGlobalScope

/** sw.js loads as a classic script with no imports, so these repeat media-protocol.ts. */
const MEDIA_CACHE = 'ego-media'
const SHELL_CACHE = 'ego-shell'
const SHELL_CACHE_ENTRIES = 120
/** Whole files under this size are kept after the first view, so a diary grid does not download twice. */
const CACHE_LIMIT = 25 * 1024 * 1024
const ANSWER_TIMEOUT_MS = 10_000
const NOTIFICATION_ICON = '/icons/icon-192.png'
/** Firefox lets a notification click focus or open a window for one second, so tabs get less than that to answer. */
const OPEN_ANSWER_MS = 400

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function ask(client: Client, question: MediaQuestion): Promise<MediaAnswer> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve({ kind: 'missing' }), ANSWER_TIMEOUT_MS)
    channel.port1.onmessage = (event: MessageEvent<MediaAnswer>) => {
      clearTimeout(timer)
      resolve(event.data)
    }
    client.postMessage(question, [channel.port2])
  })
}

async function askingPage(clientId: string): Promise<Client | null> {
  const own = clientId ? await self.clients.get(clientId) : undefined
  if (own) return own
  const windows = await self.clients.matchAll({ type: 'window' })
  return windows[0] ?? null
}

function byteRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match || (!match[1] && !match[2])) return null
  let start: number
  let end: number
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end }
}

/** Serves a whole file or the slice a video player asked for. */
function fromBlob(blob: Blob, contentType: string, rangeHeader: string | null): Response {
  const headers = new Headers({ 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
  const range = byteRange(rangeHeader, blob.size)
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${blob.size}`)
    return new Response(null, { status: 416, headers })
  }
  if (!range) {
    headers.set('content-length', String(blob.size))
    return new Response(blob, { status: 200, headers })
  }
  headers.set('content-length', String(range.end - range.start + 1))
  headers.set('content-range', `bytes ${range.start}-${range.end}/${blob.size}`)
  return new Response(blob.slice(range.start, range.end + 1), { status: 206, headers })
}

async function serveMedia(event: FetchEvent, scope: string, mediaId: string): Promise<Response> {
  const page = await askingPage(event.clientId)
  if (!page) return new Response(null, { status: 503 })
  const answer = await ask(page, { type: 'ego-media', scope, mediaId })
  const range = event.request.headers.get('range')
  if (answer.kind === 'missing') return new Response(null, { status: 404 })
  if (answer.kind === 'file') return fromBlob(answer.blob, answer.contentType || 'application/octet-stream', range)
  const key = `/media/${scope}/${encodeURIComponent(mediaId)}`
  const cache = answer.keep ? await caches.open(MEDIA_CACHE) : null
  const cached = await cache?.match(key)
  if (cached) {
    if (!range) return cached
    const blob = await cached.blob()
    return fromBlob(blob, cached.headers.get('content-type') ?? blob.type, range)
  }
  let response: Response
  try {
    response = await fetch(answer.url, { headers: { ...answer.headers, ...(range ? { range } : {}) } })
  } catch {
    return new Response(null, { status: 504 })
  }
  const length = Number(response.headers.get('content-length') ?? '')
  if (cache && !range && response.status === 200 && Number.isFinite(length) && length > 0 && length <= CACHE_LIMIT) {
    const blob = await response.blob()
    const type = response.headers.get('content-type') ?? 'application/octet-stream'
    await cache.put(key, new Response(blob, { headers: { 'content-type': type, 'content-length': String(blob.size) } }))
    return fromBlob(blob, type, null)
  }
  return response
}

/** The page loads from the network when it can and from the last copy when offline. */
async function servePage(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put('/', response.clone())
    return response
  } catch {
    return await cache.match('/') ?? new Response('Ego is offline and has not been opened here before.', { status: 503 })
  }
}

/**
 * Built files carry a hash in their name, so a cached one never goes stale. Each deploy adds new
 * names, so the oldest go once the cache passes a few deploys' worth.
 */
async function serveAsset(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - SHELL_CACHE_ENTRIES))) {
      if (new URL(old.url).pathname !== '/') await cache.delete(old)
    }
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  // Docket pages come from the Worker through Vercel. They are not Ego's page and must not replace it in the cache.
  if (url.pathname.startsWith('/docket/')) return
  const media = /^\/media\/([a-z]+)\/([^/]+)$/.exec(url.pathname)
  if (media) {
    event.respondWith(serveMedia(event, media[1], decodeURIComponent(media[2])))
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(servePage(event.request))
    return
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(serveAsset(event.request))
})

self.addEventListener('push', (event) => {
  const message = parsePushPayload(event.data?.text())
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    tag: message.tag,
    icon: NOTIFICATION_ICON,
    data: { route: message.route },
    requireInteraction: message.urgent
  }))
})

/** True from the tab running Ego, false from any other Ego tab, null from a tab too busy or too old to answer. */
function askToOpen(client: WindowClient, route: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), OPEN_ANSWER_MS)
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer)
      resolve(event.data === true)
    }
    client.postMessage({ type: 'ego-open', route } satisfies OpenRequest, [channel.port2])
  })
}

/**
 * The tab running Ego moves to the page without reloading. A busy tab still gets the request once it
 * is free. With only tabs that are not running Ego, one reloads at the page, which lets it take over.
 * Docket pages share the origin but never run Ego, so they are left alone.
 */
async function openRoute(route: string): Promise<void> {
  const url = new URL(route, self.location.origin).href
  const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => !new URL(client.url).pathname.startsWith('/docket/'))
  const answers = await Promise.all(windows.map((client) => askToOpen(client, route)))
  const running = windows.find((_, index) => answers[index] === true) ?? windows.find((_, index) => answers[index] === null)
  if (running) {
    await running.focus().catch(() => null)
    return
  }
  const idle = windows[0]
  if (idle) {
    await idle.focus().catch(() => null)
    if (await idle.navigate(url).catch(() => null)) return
  }
  await self.clients.openWindow(url)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openRoute(clickedRoute(event.notification.data)))
})
