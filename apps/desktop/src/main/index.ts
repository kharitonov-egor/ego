import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, net, shell } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { readdirSync } from 'fs'
import { registerHotkey, unregisterHotkey, unregisterAll } from './hotkeys'
import { getAppIconPath, getTrayIcon } from './icon'
import {
  getLivePreferences,
  getLedgerConfig,
  getOpenRouterApiKey,
  getQuickAddHotkey,
  getQuickAddListShortcuts,
  getToolPaletteHotkey,
  getTransactionImageSettings,
  getTrelloApiKey,
  getTrelloBoardId,
  getTrelloListId,
  getTrelloToken,
  setLivePreferences,
  setQuickAddHotkey as saveQuickAddHotkey,
  setQuickAddListShortcuts as saveQuickAddListShortcuts,
  setToolPaletteHotkey as saveToolPaletteHotkey,
  setTransactionImageSettings,
  setTrelloApiKey as saveTrelloApiKey,
  setTrelloBoardId as saveTrelloBoardId,
  setTrelloListId as saveTrelloListId,
  setTrelloToken as saveTrelloToken
} from './settings'
import { trello } from './trello'
import { showQuickAddWindow, setupQuickAddIpc } from './quickAdd'
import { analyzeTransactionImage, isLivePreferences } from '@ego/core'
import type { DesktopTransactionImageInput, LivePreferences, QuickAddListShortcut, TransactionImageSettingsInput } from '../shared/types'
import type { NotifyInput } from '../shared/local'
import {
  connectorStatus,
  createLiveSession,
  disconnectConnector,
  executeLiveTool,
  startGoogleConnector,
  startWisprConnector
} from './live'
import { setupToolPaletteIpc, showToolPalette } from './toolPalette'
import { setupLocalIpc } from './local/ipc'
import { ledgerApi, ledgerDatabase, onLedgerEvent, onMediaProgress, startLedger, stopLedger } from './local/ledger'
import { handleMediaRequests, registerMediaScheme } from './local/media'
import { finishGoogleSignIn, registerSignInLinks, signInLinkIn } from './local/signIn'
import { googleReturnRouteIn } from './healthLink'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const PACKAGED_RENDERER_ENTRY = join(__dirname, '../renderer/index.html')
/** The same half-level steps as Electron's zoomIn and zoomOut menu roles. */
const ZOOM_STEPS: Partial<Record<string, number>> = { '=': 0.5, '+': 0.5, '-': -0.5 }

function requestLiveSessionStop(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('live-session-stop-requested')
  }
}

/** `route` is the page to open on, for a link that started Ego. */
function createWindow(route?: string): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    show: false,
    resizable: true,
    backgroundColor: '#0a0a0a',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes ?? [] : []
    const microphoneOnly = permission === 'media' && mediaTypes.includes('audio') && !mediaTypes.includes('video')
    const allowed = microphoneOnly || permission === 'clipboard-sanitized-write'
    callback(Boolean(mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id && allowed))
  })

  mainWindow.on('close', (e) => {
    e.preventDefault()
    requestLiveSessionStop()
    mainWindow?.hide()
  })
  mainWindow.on('hide', requestLiveSessionStop)

  const abandonTransactions = (): void => {
    void ledgerDatabase().then((database) => database?.abandonRendererTransactions())
  }
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) abandonTransactions()
  })
  mainWindow.webContents.on('render-process-gone', abandonTransactions)

  // Electron's default menu binds zoom in to Ctrl+Plus, which needs Shift on a US keyboard, and
  // ignores the numpad keys.
  const contents = mainWindow.webContents
  contents.on('before-input-event', (event, input) => {
    const step = ZOOM_STEPS[input.key]
    if (input.type !== 'keyDown' || !input.control || input.alt || step === undefined) return
    event.preventDefault()
    contents.setZoomLevel(contents.getZoomLevel() + step)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(route ? `${process.env.ELECTRON_RENDERER_URL}#${route}` : process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(PACKAGED_RENDERER_ENTRY, route ? { hash: route } : undefined)
  }

  // The window holds the whole IPC bridge, so it never leaves Ego's own pages. Web links open in the browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const page = (address: string): string => address.split('#')[0]
    // Every file: URL shares the origin "null", so only a reload of the same page may pass.
    if (page(url) !== page(mainWindow?.webContents.getURL() || url)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  mainWindow!.show()
  mainWindow!.focus()
}

function isNotifyInput(value: unknown): value is NotifyInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.title === 'string' && typeof input.body === 'string' &&
    (input.route === undefined || (typeof input.route === 'string' && input.route.startsWith('/'))) &&
    (input.silent === undefined || typeof input.silent === 'boolean')
}

/** Screens keep running while the window hides in the tray, so their reminders arrive through here. */
/** Held until dismissed, so a notification is not collected before its click arrives. */
const shownNotifications = new Set<Notification>()

function notify(input: NotifyInput): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: input.title, body: input.body, icon: getAppIconPath(), silent: input.silent })
  shownNotifications.add(notification)
  const forget = (): void => { shownNotifications.delete(notification) }
  notification.on('click', () => {
    forget()
    showMainWindow()
    if (input.route) mainWindow?.webContents.send('navigate', input.route)
  })
  notification.on('close', forget)
  notification.on('failed', forget)
  notification.show()
}

/** Google sends the browser back to ego://auth, and Windows starts a second Ego with that link. */
async function handleSignInLink(link: string): Promise<void> {
  showMainWindow()
  const outcome = await finishGoogleSignIn(link)
  mainWindow?.webContents.send('sign-in-finished', outcome)
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('Ego')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Quick add card', click: showQuickAddWindow },
      { label: 'Quick tools', click: showToolPalette },
      { label: 'Open Ego', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          requestLiveSessionStop()
          mainWindow?.destroy()
          app.quit()
        }
      }
    ])
  )

  tray.on('double-click', showMainWindow)
}

function registerQuickAddHotkey(): void {
  const hotkey = getQuickAddHotkey()
  if (hotkey) {
    registerHotkey(hotkey, '__quick_add__', showQuickAddWindow)
  }
}

function registerToolPaletteHotkey(): void {
  const hotkey = getToolPaletteHotkey()
  if (hotkey) registerHotkey(hotkey, '__tool_palette__', showToolPalette)
}

function runCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${command} failed:\n${stderr || err.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTransactionImageInput(value: unknown): value is DesktopTransactionImageInput {
  return isRecord(value) && typeof value.base64 === 'string' && typeof value.mimeType === 'string' &&
    Array.isArray(value.categories) && value.categories.every((category: unknown) => isRecord(category) &&
      typeof category.id === 'string' && typeof category.name === 'string' &&
      (category.kind === 'income' || category.kind === 'expense'))
}

function setupIpcHandlers(): void {
  ipcMain.handle('money-get-ledger-config', () => getLedgerConfig())
  ipcMain.handle('live-create-session', (event, sdp: string) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return { ok: false, code: 'NOT_ALLOWED', message: 'Voice calls can only start from the main Ego window.' }
    }
    return createLiveSession(sdp)
  })
  ipcMain.handle('live-execute-tool', (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return { ok: false, code: 'NOT_ALLOWED', message: 'AI tools can only run from the main Ego window.' }
    }
    return executeLiveTool(input)
  })
  ipcMain.handle('connector-get-status', (_event, provider: 'google' | 'wispr') => connectorStatus(provider))
  ipcMain.handle('connector-start-google', () => startGoogleConnector())
  ipcMain.handle('connector-start-wispr', (_event, serverUrl: string) => startWisprConnector(serverUrl))
  ipcMain.handle('connector-disconnect', (_event, provider: 'google' | 'wispr') => disconnectConnector(provider))
  ipcMain.handle('live-get-preferences', () => getLivePreferences())
  ipcMain.handle('live-set-preferences', (_event, preferences: LivePreferences) => {
    return isLivePreferences(preferences) ? setLivePreferences(preferences) : getLivePreferences()
  })
  ipcMain.handle('transaction-image-get-settings', () => getTransactionImageSettings())
  ipcMain.handle('transaction-image-set-settings', (_event, input: TransactionImageSettingsInput) => {
    setTransactionImageSettings(input)
    return getTransactionImageSettings()
  })
  ipcMain.handle('transaction-image-analyze', (_event, input: unknown) => isTransactionImageInput(input)
    ? analyzeTransactionImage({
      base64: input.base64,
      mimeType: input.mimeType,
      categories: input.categories,
      apiKey: getOpenRouterApiKey(),
      model: getTransactionImageSettings().model
    }, (url, init) => net.fetch(url, init))
    : { ok: false, message: 'Choose a JPEG, PNG, or WebP image.' })

  ipcMain.handle('get-auto-start', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('set-auto-start', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
  })

  ipcMain.handle('get-quick-add-hotkey', () => getQuickAddHotkey())

  ipcMain.handle('set-quick-add-hotkey', (_event, hotkey: string) => {
    const previous = getQuickAddHotkey()
    if (previous) unregisterHotkey(previous)
    saveQuickAddHotkey(hotkey)
    if (hotkey) {
      registerHotkey(hotkey, '__quick_add__', showQuickAddWindow)
    }
  })

  ipcMain.handle('get-tool-palette-hotkey', () => getToolPaletteHotkey())

  ipcMain.handle('set-tool-palette-hotkey', (_event, hotkey: string) => {
    const previous = getToolPaletteHotkey()
    if (previous) unregisterHotkey(previous)
    saveToolPaletteHotkey(hotkey)
    if (hotkey) registerHotkey(hotkey, '__tool_palette__', showToolPalette)
  })

  ipcMain.handle('get-trello-api-key', () => getTrelloApiKey())
  ipcMain.handle('set-trello-api-key', (_event, value: string) => saveTrelloApiKey(value))
  ipcMain.handle('get-trello-token', () => getTrelloToken())
  ipcMain.handle('set-trello-token', (_event, value: string) => saveTrelloToken(value))
  ipcMain.handle('get-trello-board-id', () => getTrelloBoardId())
  ipcMain.handle('set-trello-board-id', (_event, value: string) => saveTrelloBoardId(value))
  ipcMain.handle('get-trello-list-id', () => getTrelloListId())
  ipcMain.handle('set-trello-list-id', (_event, value: string) => saveTrelloListId(value))
  ipcMain.handle('trello-list-boards', () => trello.listBoards())
  ipcMain.handle('trello-list-lists', (_event, boardId: string) => trello.listLists(boardId))

  ipcMain.handle('get-quick-add-list-shortcuts', () => getQuickAddListShortcuts())
  ipcMain.handle(
    'set-quick-add-list-shortcuts',
    (_event, shortcuts: QuickAddListShortcut[]) => saveQuickAddListShortcuts(shortcuts)
  )

  ipcMain.handle('open-external-url', (_event, url: unknown) => {
    if (typeof url !== 'string') return
    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      return
    }
    // A link typed into a sheet or a card syncs from other devices, so only these schemes leave Ego.
    if (['https:', 'http:', 'mailto:', 'tel:', 'sms:'].includes(protocol)) return shell.openExternal(url)
  })

  ipcMain.handle('build-and-install', async () => {
    if (app.isPackaged) return { success: false, error: 'Cannot build in production' }

    const projectDir = join(__dirname, '../..')

    try {
      mainWindow?.webContents.send('build-progress', 'compiling')
      await runCommand('npm run build', projectDir)

      mainWindow?.webContents.send('build-progress', 'packaging')
      await runCommand('npx electron-builder --win', projectDir)

      mainWindow?.webContents.send('build-progress', 'installing')
      const distDir = join(projectDir, 'dist')
      const expectedInstaller = `Ego-${app.getVersion()}-Setup.exe`
      const installer = readdirSync(distDir).find((file) => file === expectedInstaller)
      if (!installer) {
        throw new Error(`Packaged successfully, but ${expectedInstaller} was not found in dist.`)
      }
      shell.openPath(join(distDir, installer))

      mainWindow?.webContents.send('build-progress', 'done')
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[build-and-install]', message)
      mainWindow?.webContents.send('build-progress', 'error')
      return { success: false, error: message }
    }
  })

  ipcMain.on('notify', (event, input: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id && isNotifyInput(input)) notify(input)
  })

  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window-close', () => {
    requestLiveSessionStop()
    mainWindow?.hide()
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  registerSignInLinks()
  registerMediaScheme()
  // Windows matches toasts to the installer's Start menu shortcut by this ID; a dev run has no shortcut.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.kharitonovegor.ego' : process.execPath)

  app.on('second-instance', (_event, argv) => {
    const link = signInLinkIn(argv)
    const returnRoute = googleReturnRouteIn(argv)
    if (link) void handleSignInLink(link)
    else showMainWindow()
    if (returnRoute) mainWindow?.webContents.send('navigate', returnRoute)
  })

  app.whenReady().then(() => {
    setupIpcHandlers()
    setupLocalIpc((sender) => Boolean(mainWindow && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id))
    setupQuickAddIpc()
    setupToolPaletteIpc()
    createTray()
    const returnRoute = googleReturnRouteIn(process.argv)
    createWindow(returnRoute ?? undefined)
    if (returnRoute) showMainWindow()
    registerQuickAddHotkey()
    registerToolPaletteHotkey()
    handleMediaRequests({ database: async () => (await ledgerDatabase())?.local ?? null, api: ledgerApi })
    onLedgerEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ledger-event', event)
    })
    onMediaProgress((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media-progress', progress)
    })
    startLedger()
    const link = signInLinkIn(process.argv)
    if (link) void handleSignInLink(link)
  })

  app.on('will-quit', () => {
    requestLiveSessionStop()
    unregisterAll()
    void stopLedger()
  })

  // Subscribing at all suppresses Electron's default quit-on-last-window-closed.
  app.on('window-all-closed', () => {})
}
