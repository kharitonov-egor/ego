import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { SqlParam } from '@ego/local/database/types'
import { isRemoteApiMethod, type MediaFileInput, type MediaOpenInput, type MediaPathInput } from '../../shared/local'
import { getPreference, setPreference } from '../settings'
import { ledgerApi, ledgerDatabase, ledgerState, syncLedger } from './ledger'
import { deleteStagedMedia, openMedia, stageMedia, stageMediaFile } from './media'
import { beginGoogleSignIn, signOut, useDeviceToken } from './signIn'

function isMediaFile(value: unknown): value is MediaFileInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.mediaId === 'string' && typeof input.mimeType === 'string' &&
    (input.fileName === null || typeof input.fileName === 'string') && input.data instanceof ArrayBuffer
}

function isMediaPath(value: unknown): value is MediaPathInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.mediaId === 'string' && typeof input.mimeType === 'string' && typeof input.path === 'string' &&
    input.path.length > 0 && (input.fileName === null || typeof input.fileName === 'string')
}

function isMediaOpen(value: unknown): value is MediaOpenInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.mediaId === 'string' && typeof input.mimeType === 'string' && typeof input.scope === 'string' &&
    (input.fileName === null || typeof input.fileName === 'string')
}

function isSqlParams(value: unknown): value is SqlParam[] {
  return Array.isArray(value) && value.every((item) =>
    item === null || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
}

/** The screens only read and write ledger rows; attaching another file or writing one out is never theirs to do. */
const OUTSIDE_THE_LEDGER = /^\s*(ATTACH|DETACH)\b|\bVACUUM\b|\bload_extension\b/i

function isLedgerSql(value: unknown): value is string {
  return typeof value === 'string' && !OUTSIDE_THE_LEDGER.test(value)
}

function transactionId(value: unknown): number | null {
  if (value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error('Invalid transaction')
}

/**
 * The local ledger, the Worker client, and sign-in. Only the main window may call these, since
 * the overlay windows load the same preload.
 */
export function setupLocalIpc(isMainWindow: (sender: WebContents) => boolean): void {
  const guard = (event: IpcMainInvokeEvent): void => {
    if (!isMainWindow(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Only the main Ego window can read the ledger')
    }
  }
  const database = async () => {
    const opened = await ledgerDatabase()
    if (!opened) throw new Error('Sign in before reading the ledger')
    return opened
  }

  ipcMain.handle('local-all', async (event, transaction: unknown, sql: unknown, params: unknown) => {
    guard(event)
    if (!isLedgerSql(sql) || !isSqlParams(params)) throw new Error('Invalid query')
    return (await database()).all(transactionId(transaction), sql, params)
  })
  ipcMain.handle('local-run', async (event, transaction: unknown, sql: unknown, params: unknown) => {
    guard(event)
    if (!isLedgerSql(sql) || !isSqlParams(params)) throw new Error('Invalid statement')
    return (await database()).run(transactionId(transaction), sql, params)
  })
  ipcMain.handle('local-begin', async (event) => {
    guard(event)
    return (await database()).begin()
  })
  ipcMain.handle('local-finish', async (event, transaction: unknown, commit: unknown) => {
    guard(event)
    const id = transactionId(transaction)
    if (id === null) throw new Error('Invalid transaction')
    ;(await database()).finish(id, commit === true)
  })

  ipcMain.handle('ledger-state', (event) => {
    guard(event)
    return ledgerState()
  })
  ipcMain.handle('ledger-sync', (event) => {
    guard(event)
    return syncLedger()
  })
  ipcMain.handle('api-call', (event, method: unknown, args: unknown) => {
    guard(event)
    if (!isRemoteApiMethod(method) || !Array.isArray(args)) throw new Error('Invalid Worker call')
    const api = ledgerApi()
    const call = api[method] as (...values: unknown[]) => Promise<unknown>
    return call(...args)
  })

  ipcMain.handle('auth-google', (event, apiUrl: unknown) => {
    guard(event)
    return beginGoogleSignIn(typeof apiUrl === 'string' ? apiUrl : '')
  })
  ipcMain.handle('auth-device-token', (event, apiUrl: unknown, token: unknown) => {
    guard(event)
    return useDeviceToken(typeof apiUrl === 'string' ? apiUrl : '', typeof token === 'string' ? token : '')
  })
  ipcMain.handle('auth-sign-out', (event) => {
    guard(event)
    return signOut()
  })

  ipcMain.handle('media-stage', (event, input: unknown) => {
    guard(event)
    if (!isMediaFile(input)) throw new Error('Invalid file')
    return stageMedia(input)
  })
  ipcMain.handle('media-stage-file', (event, input: unknown) => {
    guard(event)
    if (!isMediaPath(input)) throw new Error('Invalid file')
    return stageMediaFile(input)
  })
  ipcMain.handle('media-delete-staged', (event, paths: unknown) => {
    guard(event)
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) throw new Error('Invalid paths')
    return deleteStagedMedia(paths)
  })
  ipcMain.handle('media-open', (event, input: unknown) => {
    guard(event)
    if (!isMediaOpen(input)) throw new Error('Invalid file')
    return openMedia({ database: async () => (await ledgerDatabase())?.local ?? null, api: ledgerApi }, input)
  })

  ipcMain.handle('preference-get', (event, key: unknown) => {
    guard(event)
    return typeof key === 'string' ? getPreference(key) : null
  })
  ipcMain.handle('preference-set', (event, key: unknown, value: unknown) => {
    guard(event)
    if (typeof key === 'string' && (typeof value === 'string' || value === null)) setPreference(key, value)
  })
}
