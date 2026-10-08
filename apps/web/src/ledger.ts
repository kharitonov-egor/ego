import { moneyApiFor, normalizeApiUrl, type EgoApi } from '@ego/local/api-client'
import { databaseFileFor, datasetIdFor } from '@ego/local/database/dataset'
import { uploadPendingMedia } from '@ego/local/diary/uploads'
import {
  createSyncCoordinator, hasDownloaded, isBootstrapped, type SyncCoordinator, type SyncOutcome, type Touched
} from '@ego/local/sync/coordinator'
import type { LedgerEvent, LedgerState, MediaProgress } from '@ego/ui/platform/local'
import { eraseBrowserDatabases, openBrowserDatabase, type BrowserDatabase } from './database/client'
import { eraseMedia, mediaUploadTransport } from './media'
import { DEFAULT_API_URL, clearSession, loadSession, saveSession, type WebSession } from './session'

/** A tab left open for days should not show a day-old copy when you come back to it. */
const BACKGROUND_SYNC_MS = 10 * 60 * 1000

const EVERYTHING: Touched = {
  money: true, gym: true, health: true, habits: true, diary: true, tasks: true, sheets: true, food: true, content: true
}

interface Opened {
  key: string
  database: BrowserDatabase
}

let session: WebSession | null = loadSession()
let opened: Opened | null = null
let opening: Promise<Opened | null> | null = null
let closing: Promise<void> | null = null
let coordinator: { key: string; value: SyncCoordinator } | null = null
let client: { key: string; value: EgoApi } | null = null
let inFlight: Promise<LedgerState> | null = null
let again = false
let status: SyncOutcome | null = null
let ready = false
let current = false
let syncing = false
let openError: string | null = null
let syncError: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** Until this tab holds the tab lock, the database stays closed; another tab may have it open. */
let stopped = true
const listeners = new Set<(event: LedgerEvent) => void>()
const progressListeners = new Set<(progress: MediaProgress) => void>()

export function currentSession(): WebSession | null {
  return session
}

function isSignedIn(): boolean {
  return Boolean(session?.apiUrl && session.token)
}

/** The Worker client for this browser's token. */
export function ledgerApi(): EgoApi {
  const url = normalizeApiUrl(session?.apiUrl ?? DEFAULT_API_URL)
  const token = session?.token ?? ''
  const key = `${url}\n${token}`
  if (client?.key !== key) client = { key, value: moneyApiFor({ url, token }) }
  return client.value
}

export function ledgerState(): LedgerState {
  const signedIn = isSignedIn()
  return {
    signedIn,
    apiUrl: normalizeApiUrl(session?.apiUrl ?? DEFAULT_API_URL),
    account: signedIn ? session?.account ?? null : null,
    ready: signedIn && ready,
    current: signedIn && ready && current,
    syncing,
    status: signedIn ? status : null,
    error: openError,
    syncError: signedIn ? syncError : null
  }
}

export function onLedgerEvent(listener: (event: LedgerEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onMediaProgress(listener: (progress: MediaProgress) => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

function reportProgress(mediaId: string, share: number | null): void {
  for (const listener of progressListeners) listener({ mediaId, share })
}

function emit(touched: Touched | null, reopened = false): void {
  const event: LedgerEvent = { state: ledgerState(), touched, reopened }
  for (const listener of listeners) listener(event)
}

async function closeDatabase(): Promise<void> {
  const ending = opened
  opened = null
  coordinator = null
  if (!ending) return
  closing = ending.database.close().catch(() => undefined).finally(() => { closing = null })
  await closing
}

function databaseKey(active: WebSession): string {
  return `${datasetIdFor(normalizeApiUrl(active.apiUrl))}\n${active.remember ? 'kept' : 'tab'}`
}

async function ensureDatabase(): Promise<Opened | null> {
  if (closing) await closing
  const active = session
  if (!active || !isSignedIn() || stopped) {
    await closeDatabase()
    return null
  }
  const key = databaseKey(active)
  if (opened?.key === key) return opened
  if (opening) return opening
  opening = (async () => {
    await closeDatabase()
    try {
      const datasetId = datasetIdFor(normalizeApiUrl(active.apiUrl))
      const database = await openBrowserDatabase(active.remember ? databaseFileFor(datasetId) : null)
      await database.local.run(
        'INSERT INTO sync_state (id, dataset_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET dataset_id = excluded.dataset_id',
        [datasetId])
      ready = await hasDownloaded(database.local)
      current = await isBootstrapped(database.local)
      openError = null
      opened = { key, database }
      return opened
    } catch (failure: unknown) {
      openError = failure instanceof Error ? failure.message : 'The browser copy of Ego did not open'
      return null
    } finally {
      opening = null
    }
  })()
  return opening
}

/** The database the screens read, opened on first use. Null until this browser is signed in. */
export async function ledgerDatabase(): Promise<BrowserDatabase | null> {
  return (await ensureDatabase())?.database ?? null
}

function coordinatorFor(active: Opened): SyncCoordinator {
  const api = ledgerApi()
  const key = `${active.key}\n${session?.token ?? ''}`
  if (coordinator?.key !== key) {
    const now = (): string => new Date().toISOString()
    const db = active.database.local
    const transport = mediaUploadTransport(api, reportProgress)
    coordinator = { key, value: createSyncCoordinator({ db, api, now, uploadMedia: () => uploadPendingMedia(db, transport, now) }) }
  }
  return coordinator.value
}

async function runSync(): Promise<LedgerState> {
  const active = await ensureDatabase()
  if (!active) {
    emit(null)
    return ledgerState()
  }
  syncing = true
  syncError = null
  emit(null)
  let touched: Touched | null = null
  try {
    const db = active.database.local
    const wasBootstrapped = await isBootstrapped(db)
    const outcome = await coordinatorFor(active).sync()
    const downloaded = !wasBootstrapped && await isBootstrapped(db)
    status = outcome
    ready = await hasDownloaded(db)
    current = await isBootstrapped(db)
    touched = downloaded ? EVERYTHING : {
      ...outcome.touched,
      diary: outcome.touched.diary || outcome.delivered > 0,
      tasks: outcome.touched.tasks || outcome.delivered > 0,
      sheets: outcome.touched.sheets || outcome.delivered > 0,
      food: outcome.touched.food || outcome.delivered > 0,
      content: outcome.touched.content || outcome.delivered > 0
    }
  } catch (failure: unknown) {
    syncError = failure instanceof Error ? failure.message : 'Sync stopped unexpectedly'
  } finally {
    syncing = false
  }
  emit(touched)
  return ledgerState()
}

/** One run at a time. A request during a run asks for one more pass and waits for it. */
export function syncLedger(): Promise<LedgerState> {
  if (inFlight) {
    again = true
    return inFlight
  }
  inFlight = (async () => {
    let state: LedgerState
    do {
      again = false
      state = await runSync()
    } while (again && isSignedIn() && !stopped)
    return state
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function reopen(): Promise<void> {
  await inFlight?.catch(() => undefined)
  await closeDatabase()
  status = null
  ready = false
  current = false
  openError = null
  syncError = null
  emit(null, true)
  void syncLedger()
}

/** After sign-in: keep the new token where the user chose and open the matching copy. */
export async function adoptSession(next: WebSession): Promise<void> {
  saveSession(next)
  session = next
  await reopen()
}

/** Sign-out erases this browser's copy too, since a browser may not be yours. */
export async function endSession(): Promise<void> {
  await inFlight?.catch(() => undefined)
  session = null
  clearSession()
  await closeDatabase()
  await eraseBrowserDatabases().catch(() => undefined)
  await eraseMedia()
  await reopen()
}

export function startLedger(): void {
  stopped = false
  timer ??= setInterval(() => {
    if (isSignedIn()) void syncLedger()
  }, BACKGROUND_SYNC_MS)
  window.addEventListener('online', onOnline)
}

function onOnline(): void {
  if (isSignedIn()) void syncLedger()
}

/** Another tab is taking over: let go of the database files so it can open them. */
export async function stopLedger(): Promise<void> {
  stopped = true
  if (timer) clearInterval(timer)
  timer = null
  window.removeEventListener('online', onOnline)
  await inFlight?.catch(() => undefined)
  await closeDatabase()
}
