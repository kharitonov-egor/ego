import type { FetchLike } from './trello'

export interface T3PairingLink {
  origin: string
  credential: string
}

/**
 * The access token the server issues in exchange for a pairing link. The link itself is a
 * one-time grant with a five minute life, so only this survives; it lasts 30 days and is the
 * thing worth persisting.
 */
export interface T3Session {
  origin: string
  token: string
  expiresAt: number
}

export interface T3Result<T> {
  ok: boolean
  data?: T
  detail?: string
}

export type T3TurnState = 'running' | 'interrupted' | 'completed' | 'error'

export interface T3Thread {
  id: string
  projectId: string
  title: string
  model: string
  provider: string
  branch: string | null
  turnId: string | null
  turnState: T3TurnState | null
  startedAt: string | null
  completedAt: string | null
  archived: boolean
  backgroundWorking: boolean
  needsAttention: boolean
  lastError: string | null
}

/** Enough of a project to draw its icon: an asset URL, an emoji, or a named lucide glyph. */
export interface T3Project {
  id: string
  title: string
  faviconPath: string | null
  emoji: string | null
  color: string | null
}

export interface T3Shell {
  sequence: number
  projects: Record<string, T3Project>
  threads: T3Thread[]
}

export type T3EventKind = 'finished' | 'waiting' | 'errored'

export interface T3Event {
  kind: T3EventKind
  threadId: string
  title: string
  project: T3Project | null
  model: string
  provider: string
  branch: string | null
  durationMs: number | null
  detail: string | null
}

interface TrackedThread {
  turnId: string | null
  turnState: T3TurnState | null
  needsAttention: boolean
  backgroundWorking: boolean
  settledPending: boolean
}

export type T3WatchState = Record<string, TrackedThread>

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
const BOOTSTRAP_TOKEN_TYPE = 'urn:t3:params:oauth:token-type:environment-bootstrap'
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
const READ_SCOPE = 'orchestration:read'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function turnState(value: unknown): T3TurnState | null {
  return value === 'running' || value === 'interrupted' || value === 'completed' || value === 'error'
    ? value
    : null
}

/**
 * Pairing links carry the credential in the URL fragment so it never reaches the server as a
 * query parameter. Older links used `?token=`, so both are accepted.
 */
export function parsePairingUrl(raw: string): T3PairingLink | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('token')
  const credential = fromHash ?? url.searchParams.get('token')
  if (!credential) return null

  return { origin: url.origin, credential }
}

function readThread(value: unknown): T3Thread | null {
  if (!isRecord(value)) return null

  const id = str(value.id)
  const title = str(value.title)
  if (!id || !title) return null

  const latestTurn = isRecord(value.latestTurn) ? value.latestTurn : null
  const session = isRecord(value.session) ? value.session : null
  const modelSelection = isRecord(value.modelSelection) ? value.modelSelection : null
  const projectId = str(value.projectId) ?? ''

  return {
    id,
    projectId,
    title,
    model: str(modelSelection?.model) ?? '',
    provider: str(modelSelection?.instanceId) ?? '',
    branch: str(value.branch),
    turnId: latestTurn ? str(latestTurn.turnId) : null,
    turnState: latestTurn ? turnState(latestTurn.state) : null,
    startedAt: latestTurn ? str(latestTurn.startedAt) : null,
    completedAt: latestTurn ? str(latestTurn.completedAt) : null,
    archived: value.archivedAt !== null && value.archivedAt !== undefined,
    backgroundWorking: value.backgroundLiveness === 'working',
    needsAttention:
      value.hasPendingApprovals === true ||
      value.hasPendingUserInput === true ||
      value.hasActionableProposedPlan === true,
    lastError: session ? str(session.lastError) : null
  }
}

/**
 * T3 Code writes its live origin to `userdata/server-runtime.json` on every start. Reading it
 * keeps a saved session working when the server comes back on a different port, which would
 * otherwise look like a dead pairing.
 */
export function parseServerRuntimeOrigin(value: unknown): string | null {
  if (!isRecord(value)) return null

  const origin = str(value.origin)
  if (origin) return origin

  const host = str(value.host)
  const port = typeof value.port === 'number' ? value.port : null
  return host && port ? `http://${host}:${port}` : null
}

export function parseShell(value: unknown): T3Shell | null {
  if (!isRecord(value) || !Array.isArray(value.threads)) return null

  const projects: Record<string, T3Project> = {}
  if (Array.isArray(value.projects)) {
    for (const entry of value.projects) {
      if (!isRecord(entry)) continue

      const id = str(entry.id)
      const title = str(entry.title)
      if (!id || !title) continue

      const icon = isRecord(entry.projectIcon) ? entry.projectIcon : null
      projects[id] = {
        id,
        title,
        faviconPath: str(entry.faviconPath),
        emoji: icon?.kind === 'emoji' ? str(icon.emoji) : null,
        color: icon?.kind === 'lucide' ? str(icon.color) : null
      }
    }
  }

  const threads: T3Thread[] = []
  for (const entry of value.threads) {
    const thread = readThread(entry)
    if (thread && !thread.archived) threads.push(thread)
  }

  return {
    sequence: typeof value.snapshotSequence === 'number' ? value.snapshotSequence : 0,
    projects,
    threads
  }
}

function durationMs(thread: T3Thread): number | null {
  if (!thread.startedAt || !thread.completedAt) return null
  const started = Date.parse(thread.startedAt)
  const completed = Date.parse(thread.completedAt)
  if (Number.isNaN(started) || Number.isNaN(completed)) return null
  return Math.max(0, completed - started)
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * Compares two shell snapshots and returns what changed. The first call seeds state and returns
 * nothing, so restarting the app never replays a backlog of finished turns as toasts.
 *
 * A turn that stops while subagents or watch loops are still alive is held back until
 * `backgroundLiveness` clears, matching what the T3 sidebar treats as still working.
 */
export function diffShell(
  previous: T3WatchState | null,
  shell: T3Shell
): { events: T3Event[]; state: T3WatchState } {
  const state: T3WatchState = {}
  const events: T3Event[] = []

  for (const thread of shell.threads) {
    const before = previous?.[thread.id]
    const stoppedRunning = before?.turnState === 'running' && thread.turnState !== 'running'
    const settledPending = before?.settledPending === true

    const holdForBackground = thread.backgroundWorking
    const settles = stoppedRunning || settledPending

    const tracked: TrackedThread = {
      turnId: thread.turnId,
      turnState: thread.turnState,
      needsAttention: thread.needsAttention,
      backgroundWorking: thread.backgroundWorking,
      settledPending: settles && holdForBackground
    }
    state[thread.id] = tracked

    if (!previous) continue

    const base = {
      threadId: thread.id,
      title: thread.title,
      project: shell.projects[thread.projectId] ?? null,
      model: thread.model,
      provider: thread.provider,
      branch: thread.branch
    }

    if (settles && !holdForBackground) {
      if (thread.turnState === 'error') {
        events.push({
          ...base,
          kind: 'errored',
          durationMs: durationMs(thread),
          detail: thread.lastError
        })
      } else if (thread.turnState === 'completed') {
        events.push({ ...base, kind: 'finished', durationMs: durationMs(thread), detail: null })
      }
    }

    if (thread.needsAttention && before?.needsAttention !== true) {
      events.push({ ...base, kind: 'waiting', durationMs: null, detail: null })
    }
  }

  return { events, state }
}

/**
 * Redeems a pairing link. The grant behind the link is single-use, so this runs exactly once per
 * link and the caller keeps the returned session.
 */
export async function redeemPairingUrl(
  pairingUrl: string,
  fetch: FetchLike
): Promise<T3Result<T3Session>> {
  const pairing = parsePairingUrl(pairingUrl)
  if (!pairing) return { ok: false, detail: 'That does not look like a T3 pairing link' }

  const body = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: pairing.credential,
    subject_token_type: BOOTSTRAP_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    scope: READ_SCOPE,
    client_label: 'Ego',
    client_os: 'windows'
  })

  try {
    const response = await fetch(`${pairing.origin}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })

    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: 'Link already used or expired. Create a fresh one.' }
    }
    if (!response.ok) {
      return { ok: false, detail: `Pairing failed (HTTP ${response.status})` }
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload)) return { ok: false, detail: 'Unexpected pairing response' }

    const token = str(payload.access_token)
    if (!token) return { ok: false, detail: 'Server returned no access token' }

    const scope = str(payload.scope) ?? ''
    if (!scope.split(/\s+/).includes(READ_SCOPE)) {
      return { ok: false, detail: `Link is missing the ${READ_SCOPE} scope` }
    }

    const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 0
    return {
      ok: true,
      data: {
        origin: pairing.origin,
        token,
        expiresAt: Date.now() + lifetime * 1000
      }
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Could not reach T3 Code' }
  }
}

export interface T3ClientOptions {
  getSession: () => T3Session | null
  fetch: FetchLike
  onUnauthorized?: () => void
}

export interface T3Client {
  fetchShell: () => Promise<T3Result<T3Shell>>
  fetchLastTool: (threadId: string) => Promise<string | null>
  fetchAssetDataUrl: (path: string) => Promise<string | null>
}

const MAX_ICON_BYTES = 24 * 1024

export function createT3Client(options: T3ClientOptions): T3Client {
  const { getSession, fetch, onUnauthorized } = options

  const request = async (path: string): Promise<T3Result<unknown>> => {
    const session = getSession()
    if (!session) return { ok: false, detail: 'T3 Code is not paired' }

    try {
      const response = await fetch(`${session.origin}${path}`, {
        headers: { authorization: `Bearer ${session.token}` }
      })

      if (response.status === 401 || response.status === 403) {
        if (onUnauthorized) onUnauthorized()
        return { ok: false, detail: 'Pairing was revoked or expired. Pair again.' }
      }

      if (!response.ok) {
        return { ok: false, detail: `HTTP ${response.status}` }
      }

      return { ok: true, data: await response.json() }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'T3 Code is not running' }
    }
  }

  return {
    fetchShell: async () => {
      const result = await request('/api/orchestration/shell')
      if (!result.ok) return { ok: false, detail: result.detail }

      const shell = parseShell(result.data)
      if (!shell) return { ok: false, detail: 'Unexpected shell payload' }
      return { ok: true, data: shell }
    },

    fetchLastTool: async (threadId) => {
      const result = await request(
        `/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=1`
      )
      if (!result.ok || !isRecord(result.data)) return null

      const thread = isRecord(result.data.thread) ? result.data.thread : null
      if (!thread || !Array.isArray(thread.activities)) return null

      for (let index = thread.activities.length - 1; index >= 0; index -= 1) {
        const activity = thread.activities[index]
        if (isRecord(activity) && activity.tone === 'tool') {
          const summary = str(activity.summary)
          if (summary) return summary
        }
      }
      return null
    },

    fetchAssetDataUrl: async (path) => {
      const session = getSession()
      if (!session) return null

      try {
        const response = await fetch(new URL(path, session.origin).toString(), {
          headers: { authorization: `Bearer ${session.token}` }
        })
        if (!response.ok) return null

        const type = response.headers.get('content-type') ?? 'image/png'
        if (!type.startsWith('image/')) return null

        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) return null

        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return `data:${type};base64,${btoa(binary)}`
      } catch {
        return null
      }
    }
  }
}
