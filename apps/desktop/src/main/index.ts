import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, net, shell } from 'electron'
import { join, resolve } from 'path'
import { exec } from 'child_process'
import { readdirSync } from 'fs'
import { registerHotkey, unregisterHotkey, unregisterAll } from './hotkeys'
import { getAppIconPath, getTrayIcon } from './icon'
import {
  getLivePreferences,
  getLedgerConfig,
  getMoneyCache,
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
  setT3NotifyEnabled,
  setTransactionImageSettings,
  setTrelloApiKey as saveTrelloApiKey,
  setTrelloBoardId as saveTrelloBoardId,
  setTrelloListId as saveTrelloListId,
  setTrelloToken as saveTrelloToken
} from './settings'
import { getT3Status, pairT3, startT3Watcher, unpairT3, wakeT3Watcher } from './t3'
import { trello } from './trello'
import { showQuickAddWindow, setupQuickAddIpc, showNotification } from './quickAdd'
import { money } from './money'
import { isLedgerConfigured, ledgerMoney } from './moneyLedger'
import { analyzeTransactionImage, budgetBreachMessage, budgetBreaches, isLivePreferences, type MoneyResult, type MoneySnapshot } from '@ego/core'
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
import { finishGoogleSignIn, signInLinkIn } from './local/signIn'

async function withBudgetAlerts(request: Promise<MoneyResult<MoneySnapshot>>): Promise<MoneyResult<MoneySnapshot>> {
  const before = getMoneyCache()
  const result = await request
  if (result.ok && before) {
    budgetBreaches(before, result.data).forEach((breach) => showNotification('error', budgetBreachMessage(breach, 'short')))
  }
  return result
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const PACKAGED_RENDERER_ENTRY = join(__dirname, '../renderer/index.html')

function requestLiveSessionStop(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('live-session-stop-requested')
  }
}

function createWindow(): void {
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
    callback(Boolean(mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id && microphoneOnly))
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

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(PACKAGED_RENDERER_ENTRY)
  }
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
function notify(input: NotifyInput): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: input.title, body: input.body, icon: getAppIconPath(), silent: input.silent })
  notification.on('click', () => {
    showMainWindow()
    if (input.route) mainWindow?.webContents.send('navigate', input.route)
  })
  notification.show()
}

/** Google sends the browser back to ego://auth, and Windows starts a second Ego with that link. */
async function handleSignInLink(link: string): Promise<void> {
  const outcome = await finishGoogleSignIn(link)
  showMainWindow()
  mainWindow?.webContents.send('sign-in-finished', outcome)
}

function registerSignInLinks(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('ego', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('ego')
  }
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

function setupIpcHandlers(): void {
  /** The Worker owns the database once it is configured; the direct D1 path stays for rollback. */
  const ledger = (): typeof money | typeof ledgerMoney => isLedgerConfigured() ? ledgerMoney : money
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
  ipcMain.handle('money-get-snapshot', () => ledger().getSnapshot())
  ipcMain.handle('money-create-account', (_event, input) => ledger().createAccount(input))
  ipcMain.handle('money-update-account', (_event, id, input) => ledger().updateAccount(id, input))
  ipcMain.handle('money-archive-account', (_event, id, input) => ledger().archiveAccount(id, input))
  ipcMain.handle('money-create-category', (_event, input) => ledger().createCategory(input))
  ipcMain.handle('money-update-category', (_event, id, input) => ledger().updateCategory(id, input))
  ipcMain.handle('money-archive-category', (_event, id, input) => ledger().archiveCategory(id, input))
  ipcMain.handle('money-create-transaction', (_event, input) => withBudgetAlerts(ledger().createTransaction(input)))
  ipcMain.handle('money-update-transaction', (_event, id, input) => withBudgetAlerts(ledger().updateTransaction(id, input)))
  ipcMain.handle('money-delete-transaction', (_event, id) => ledger().deleteTransaction(id))
  ipcMain.handle('money-save-budget', (_event, input) => withBudgetAlerts(ledger().saveBudget(input)))
  ipcMain.handle('money-delete-budget', (_event, month) => ledger().deleteBudget(month))
  ipcMain.handle('money-create-purchase', (_event, input) => withBudgetAlerts(ledger().createPurchase(input)))
  ipcMain.handle('money-update-purchase', (_event, id, input) => withBudgetAlerts(ledger().updatePurchase(id, input)))
  ipcMain.handle('money-delete-purchase', (_event, id) => ledger().deletePurchase(id))
  ipcMain.handle('transaction-image-get-settings', () => getTransactionImageSettings())
  ipcMain.handle('transaction-image-set-settings', (_event, input: TransactionImageSettingsInput) => {
    setTransactionImageSettings(input)
    return getTransactionImageSettings()
  })
  ipcMain.handle('transaction-image-analyze', (_event, input: DesktopTransactionImageInput) =>
    analyzeTransactionImage({
      ...input,
      apiKey: getOpenRouterApiKey(),
      model: getTransactionImageSettings().model
    }, (url, init) => net.fetch(url, init)))

  ipcMain.handle('t3-get-status', () => getT3Status())

  ipcMain.handle('t3-pair', async (_event, pairingUrl: string) => {
    const result = await pairT3(pairingUrl)
    if (result.ok) wakeT3Watcher()
    return result
  })

  ipcMain.handle('t3-unpair', () => {
    unpairT3()
    return getT3Status()
  })

  ipcMain.handle('t3-set-enabled', (_event, enabled: boolean) => {
    setT3NotifyEnabled(enabled)
    if (enabled) wakeT3Watcher()
    return getT3Status()
  })

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

  ipcMain.handle('open-external-url', (_event, url: string) => shell.openExternal(url))

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

  app.on('second-instance', (_event, argv) => {
    const link = signInLinkIn(argv)
    if (link) void handleSignInLink(link)
    else showMainWindow()
  })

  app.whenReady().then(() => {
    setupIpcHandlers()
    setupLocalIpc((sender) => Boolean(mainWindow && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id))
    setupQuickAddIpc()
    setupToolPaletteIpc()
    createTray()
    createWindow()
    registerQuickAddHotkey()
    registerToolPaletteHotkey()
    startT3Watcher()
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
