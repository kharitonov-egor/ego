import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { moneyApiFor, normalizeApiUrl, type EgoApi } from '@ego/local/api-client'
import { databaseFileFor, datasetIdFor } from '@ego/local/database/dataset'
import {
  createSyncCoordinator, hasDownloaded, isBootstrapped, type SyncCoordinator, type SyncOutcome, type Touched
} from '@ego/local/sync/coordinator'
import { uploadPendingMedia } from '@ego/local/diary/uploads'
import type { LedgerEvent, LedgerState, MediaProgress } from '../../shared/local'
import { getAccount, getLedgerConfig, getLedgerToken } from '../settings'
import { openLedgerDatabase, type LedgerDatabase } from './database'
import { mediaUploadTransport } from './media'

/** The window can sit in the tray for days, and opening it should not start from a day-old copy. */
const BACKGROUND_SYNC_MS = 10 * 60 * 1000

const EVERYTHING: Touched = {
  money: true, gym: true, health: true, habits: true, diary: true, tasks: true, sheets: true, food: true
}

interface Session {
  datasetId: string
  database: LedgerDatabase
}

let session: Session | null = null
let opening: Promise<Session | null> | null = null
let closing: Promise<void> | null = null
let coordinator: { key: string; value: SyncCoordinator } | null = null
let client: { key: string; value: EgoApi } | null = null
let inFlight: Promise<LedgerState> | null = null
let again = false
let status: SyncOutcome | null = null
let ready = false
let current = false
let syncing = false
/** The database did not open, so nothing can be read. */
let openError: string | null = null
/** The last sync stopped on something other than the network; the next run clears it. */
let syncError: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<(event: LedgerEvent) => void>()
const progressListeners = new Set<(progress: MediaProgress) => void>()

function connection(): { url: string; token: string } {
  return { url: normalizeApiUrl(getLedgerConfig().url), token: getLedgerToken() }
}

export function isSignedIn(): boolean {
  const { url, token } = connection()
  return Boolean(url && token)
}

/** The Worker client for the signed-in device. It runs here, so the token never leaves this process. */
export function ledgerApi(): EgoApi {
  const { url, token } = connection()
  const key = `${url}\n${token}`
  if (client?.key !== key) client = { key, value: moneyApiFor({ url, token }) }
  return client.value
}

export function ledgerState(): LedgerState {
  const signedIn = isSignedIn()
  return {
    signedIn,
    apiUrl: connection().url,
    account: signedIn ? getAccount() : null,
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

/** How far each file has gone up, for the ring the diary and task cards draw over it. */
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

async function closeSession(): Promise<void> {
  const ending = session
  session = null
  coordinator = null
  if (!ending) return
  closing = ending.database.close().catch(() => undefined).finally(() => { closing = null })
  await closing
}

async function ensureSession(): Promise<Session | null> {
  if (closing) await closing
  if (!isSignedIn()) {
    await closeSession()
    return null
  }
  const datasetId = datasetIdFor(connection().url)
  if (session?.datasetId === datasetId) return session
  if (opening) return opening
  opening = (async () => {
    await closeSession()
    try {
      const folder = join(app.getPath('userData'), 'ledger')
      mkdirSync(folder, { recursive: true })
      const database = await openLedgerDatabase(join(folder, databaseFileFor(datasetId)))
      await database.local.run(
        'INSERT INTO sync_state (id, dataset_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET dataset_id = excluded.dataset_id',
        [datasetId])
      ready = await hasDownloaded(database.local)
      current = await isBootstrapped(database.local)
      openError = null
      session = { datasetId, database }
      return session
    } catch (failure: unknown) {
      openError = failure instanceof Error ? failure.message : 'The local database did not open'
      return null
    } finally {
      opening = null
    }
  })()
  return opening
}

/** The database the screens read, opened on first use. Null until this computer is signed in. */
export async function ledgerDatabase(): Promise<LedgerDatabase | null> {
  return (await ensureSession())?.database ?? null
}

function coordinatorFor(active: Session): SyncCoordinator {
  const { url, token } = connection()
  const key = `${active.datasetId}\n${url}\n${token}`
  if (coordinator?.key !== key) {
    const now = (): string => new Date().toISOString()
    const db = active.database.local
    const api = ledgerApi()
    const transport = mediaUploadTransport(api, reportProgress)
    coordinator = {
      key,
      value: createSyncCoordinator({ db, api, now, uploadMedia: () => uploadPendingMedia(db, transport, now) })
    }
  }
  return coordinator.value
}

async function runSync(): Promise<LedgerState> {
  const active = await ensureSession()
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
      food: outcome.touched.food || outcome.delivered > 0
    }
  } catch (failure: unknown) {
    syncError = failure instanceof Error ? failure.message : 'Sync stopped unexpectedly'
  } finally {
    syncing = false
  }
  emit(touched)
  return ledgerState()
}

/**
 * One run at a time. A request during a run asks for one more pass and waits for it, so a change
 * saved while a long upload runs still goes out before the promise settles.
 */
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
    } while (again && isSignedIn())
    return state
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** After sign-in, sign-out, or a new server: close the old copy, open the right one, and sync it. */
export async function reopenLedger(): Promise<void> {
  await inFlight?.catch(() => undefined)
  await closeSession()
  status = null
  ready = false
  current = false
  openError = null
  syncError = null
  emit(null, true)
  void syncLedger()
}

export function startLedger(): void {
  void syncLedger()
  timer ??= setInterval(() => {
    if (isSignedIn()) void syncLedger()
  }, BACKGROUND_SYNC_MS)
}

export async function stopLedger(): Promise<void> {
  if (timer) clearInterval(timer)
  timer = null
  await inFlight?.catch(() => undefined)
  await closeSession()
}
