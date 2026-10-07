import type { ApiResult, AssistantConfirmRequest, AssistantStreamEvent, AssistantTurnRequest } from '@ego/api-contracts'
import { resultFrom } from '@ego/local/api-client'
import type {
  AssistantStreamMessage, MediaProgress, RemoteApi, RemoteApiMethod, SignInOutcome
} from '@ego/ui/platform/local'
import type { IpcApi, QuickAddPayload, QuickAddResult, TransactionImageSettings } from '@ego/ui/platform/types'
import { currentSession, ledgerApi, ledgerDatabase, ledgerState, onLedgerEvent, onMediaProgress, syncLedger } from './ledger'
import {
  TRELLO_BOARD, TRELLO_LIST, connectorStatus, createLiveSession, disconnectConnector, executeLiveTool, getLivePreferences,
  setLivePreferences, startGoogleConnector, startWisprConnector
} from './live'
import { deleteStaged, openMedia, stageMedia } from './media'
import { getPreference, setPreference } from './session'
import { beginGoogleSignIn, connectWithToken, signOut } from './sign-in'
import { pushState, pushSubscribe, pushUnsubscribe } from './web-push'

const NOT_HERE = 'This works in the desktop app only.'

const assistantListeners = new Set<(message: AssistantStreamMessage) => void>()
const signInListeners = new Set<(outcome: SignInOutcome) => void>()
const navigateListeners = new Set<(route: string) => void>()
const liveStopListeners = new Set<() => void>()
/** A sign-in that finished while the page loaded, before the screen that shows it subscribed. */
let unannouncedSignIn: SignInOutcome | null = null

function listen<T>(listeners: Set<T>, callback: T): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function announceSignIn(outcome: SignInOutcome): void {
  if (signInListeners.size === 0) unannouncedSignIn = outcome
  for (const listener of signInListeners) listener(outcome)
}

/** A Health or Calendar consent that came back in another tab asks this one to open its screen. */
export function requestNavigation(route: string): void {
  for (const listener of navigateListeners) listener(route)
}

/** Ends a voice call before this tab hands Ego to another. */
export function stopLiveSessions(): void {
  for (const listener of liveStopListeners) listener()
}

async function database(): Promise<NonNullable<Awaited<ReturnType<typeof ledgerDatabase>>>> {
  const opened = await ledgerDatabase()
  if (!opened) throw new Error('Sign in before reading the ledger')
  return opened
}

async function transactionImageSettings(): Promise<TransactionImageSettings> {
  const session = await ledgerApi().session()
  return { hasApiKey: session.ok ? session.data.services.assistant : true, model: '' }
}

async function attach(cardId: string, image: QuickAddPayload['images'][number]): Promise<ApiResult<{ attached: true }>> {
  const session = currentSession()
  if (!session) return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to Ego first' } }
  const form = new FormData()
  form.append('file', new Blob([image.data], { type: image.mimeType }), image.name)
  try {
    const response = await fetch(`${session.apiUrl.replace(/\/+$/, '')}/v1/trello/cards/${encodeURIComponent(cardId)}/attachments`, {
      method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: form, signal: AbortSignal.timeout(90_000)
    })
    return resultFrom(response.status, await response.text())
  } catch {
    return { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }
  }
}

async function submitQuickAdd(payload: QuickAddPayload): Promise<QuickAddResult> {
  const listId = payload.listId ?? getPreference(TRELLO_LIST) ?? ''
  if (!listId) return { ok: false, detail: 'Choose a Trello list in Settings first.' }
  const created = await ledgerApi().trelloCard({ title: payload.title, description: payload.description, listId })
  if (!created.ok) return { ok: false, detail: created.error.message }
  for (const image of payload.images) {
    const attached = await attach(created.data.id, image)
    if (!attached.ok) return { ok: false, detail: `The card was created, but a screenshot did not attach: ${attached.error.message}` }
  }
  return { ok: true, detail: created.data.shortUrl }
}

function openExternal(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
  return Promise.resolve()
}

/** What the desktop's preload exposes, done in the browser: SQL to a worker, everything else to the Worker over HTTPS. */
export function createWebApi(): IpcApi {
  return {
    platform: 'web',
    localAll: async (transaction, sql, params) => (await database()).bridge.localAll(transaction, sql, params),
    localRun: async (transaction, sql, params) => (await database()).bridge.localRun(transaction, sql, params),
    localBegin: async () => (await database()).bridge.localBegin(),
    localFinish: async (transaction, commit) => (await database()).bridge.localFinish(transaction, commit),
    ledgerState: async () => ledgerState(),
    ledgerSync: () => syncLedger(),
    onLedgerEvent,
    apiCall: <K extends RemoteApiMethod>(method: K, ...args: Parameters<RemoteApi[K]>): ReturnType<RemoteApi[K]> => {
      const call = ledgerApi()[method] as (...values: Parameters<RemoteApi[K]>) => ReturnType<RemoteApi[K]>
      return call(...args)
    },
    assistantStream: (streamId, kind, request) => {
      const forward = (event: AssistantStreamEvent): void => {
        for (const listener of assistantListeners) listener({ streamId, event })
      }
      const api = ledgerApi()
      return kind === 'turn'
        ? api.assistantTurn(request as AssistantTurnRequest, forward)
        : api.assistantConfirm(request as AssistantConfirmRequest, forward)
    },
    onAssistantEvent: (callback) => listen(assistantListeners, callback),
    signInWithGoogle: (apiUrl, options) =>
      beginGoogleSignIn(apiUrl, options?.remember ?? currentSession()?.remember ?? true),
    signInWithToken: connectWithToken,
    signOut,
    onSignInFinished: (callback) => {
      const pending = unannouncedSignIn
      unannouncedSignIn = null
      if (pending) queueMicrotask(() => callback(pending))
      return listen(signInListeners, callback)
    },
    mediaStage: (input) => stageMedia(input, currentSession()?.remember ?? true),
    mediaStageFile: () => Promise.reject(new Error('A browser hands files over by content, not by path')),
    mediaDeleteStaged: deleteStaged,
    mediaOpen: async (input) => openMedia(input, (await ledgerDatabase())?.local ?? null, currentSession() ? ledgerApi() : null),
    onMediaProgress: (callback: (progress: MediaProgress) => void) => onMediaProgress(callback),
    pathForFile: () => '',
    notify: () => undefined,
    pushState,
    pushSubscribe,
    pushUnsubscribe,
    onNavigate: (callback) => listen(navigateListeners, callback),
    preferenceGet: async (key) => getPreference(key),
    preferenceSet: async (key, value) => setPreference(key, value),

    moneyGetLedgerConfig: async () => {
      const session = currentSession()
      return { url: session?.apiUrl ?? '', hasToken: Boolean(session?.token) }
    },
    liveCreateSession: createLiveSession,
    liveExecuteTool: executeLiveTool,
    connectorGetStatus: connectorStatus,
    connectorStartGoogle: startGoogleConnector,
    connectorStartWispr: startWisprConnector,
    connectorDisconnect: disconnectConnector,
    onLiveSessionStopRequested: (callback) => listen(liveStopListeners, callback),
    getLivePreferences: async () => getLivePreferences(),
    setLivePreferences: async (preferences) => setLivePreferences(preferences),
    getTransactionImageSettings: transactionImageSettings,
    setTransactionImageSettings: () => transactionImageSettings(),
    analyzeTransactionImage: async (input) => {
      const result = await ledgerApi().receiptImage(input)
      return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.error.message }
    },

    getAutoStart: async () => false,
    setAutoStart: async () => undefined,

    getQuickAddHotkey: async () => 'Alt+N',
    setQuickAddHotkey: async () => undefined,
    getToolPaletteHotkey: async () => '',
    setToolPaletteHotkey: async () => undefined,

    getTrelloApiKey: async () => '',
    setTrelloApiKey: async () => undefined,
    getTrelloToken: async () => '',
    setTrelloToken: async () => undefined,
    getTrelloBoardId: async () => getPreference(TRELLO_BOARD) ?? '',
    setTrelloBoardId: async (value) => setPreference(TRELLO_BOARD, value || null),
    getTrelloListId: async () => getPreference(TRELLO_LIST) ?? '',
    setTrelloListId: async (value) => setPreference(TRELLO_LIST, value || null),
    listTrelloBoards: async () => {
      const result = await ledgerApi().trelloBoards()
      return result.ok ? { ok: true, data: result.data } : { ok: false, detail: result.error.message }
    },
    listTrelloLists: async (boardId) => {
      const result = await ledgerApi().trelloLists(boardId)
      return result.ok ? { ok: true, data: result.data } : { ok: false, detail: result.error.message }
    },

    getQuickAddListShortcuts: async () => [],
    setQuickAddListShortcuts: async () => undefined,

    resizeNotification: () => undefined,

    submitQuickAdd,
    cancelQuickAdd: () => undefined,
    setQuickAddPreview: () => undefined,
    onQuickAddFocus: () => () => undefined,

    hideToolPalette: () => undefined,
    openClaude: () => openExternal('https://claude.ai/'),
    ocrClipboardImage: async () => ({ ok: false, detail: NOT_HERE }),
    ocrImageFile: async () => ({ ok: false, detail: NOT_HERE }),
    copyToolText: (text) => navigator.clipboard.writeText(text),
    getMediaDownloaderStatus: async () => ({ available: false, ffmpegAvailable: false }),
    downloadMedia: async () => ({ ok: false, detail: NOT_HERE }),
    openMediaDownloads: async () => undefined,
    onToolPaletteFocus: () => () => undefined,
    onMediaDownloadProgress: () => () => undefined,

    buildAndInstall: async () => ({ success: false, error: NOT_HERE }),
    onBuildProgress: () => () => undefined,

    openExternalUrl: openExternal,
    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined
  }
}
