import { app, BrowserWindow, ipcMain, Tray, Menu, shell } from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { readdirSync } from 'fs'
import { registerHotkey, unregisterHotkey, unregisterAll } from './hotkeys'
import { getAppIconPath, getTrayIcon } from './icon'
import {
  getQuickAddHotkey,
  setQuickAddHotkey as saveQuickAddHotkey,
  getTrelloApiKey,
  setTrelloApiKey as saveTrelloApiKey,
  getTrelloToken,
  setTrelloToken as saveTrelloToken,
  getTrelloBoardId,
  setTrelloBoardId as saveTrelloBoardId,
  getTrelloListId,
  setTrelloListId as saveTrelloListId,
  getQuickAddListShortcuts,
  setQuickAddListShortcuts as saveQuickAddListShortcuts
} from './settings'
import { trello } from './trello'
import { showQuickAddWindow, setupQuickAddIpc } from './quickAdd'
import type { QuickAddListShortcut } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const MAIN_WINDOW_ZOOM = 1.25
const PACKAGED_RENDERER_ENTRY = join(__dirname, '../renderer/index.html')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    resizable: true,
    backgroundColor: '#0a0e1a',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setZoomFactor(MAIN_WINDOW_ZOOM)
  mainWindow.webContents.on('did-finish-load', () =>
    mainWindow?.webContents.setZoomFactor(MAIN_WINDOW_ZOOM)
  )

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(PACKAGED_RENDERER_ENTRY)
  }
}

function showSettings(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  mainWindow!.show()
  mainWindow!.focus()
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('Ego')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Quick add card', click: showQuickAddWindow },
      { label: 'Open settings', click: showSettings },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          mainWindow?.destroy()
          app.quit()
        }
      }
    ])
  )

  tray.on('double-click', showSettings)
}

function registerQuickAddHotkey(): void {
  const hotkey = getQuickAddHotkey()
  if (hotkey) {
    registerHotkey(hotkey, '__quick_add__', showQuickAddWindow)
  }
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

  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window-close', () => mainWindow?.hide())
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', showSettings)

  app.whenReady().then(() => {
    setupIpcHandlers()
    setupQuickAddIpc()
    createTray()
    createWindow()
    registerQuickAddHotkey()
  })

  app.on('will-quit', () => {
    unregisterAll()
  })

  // Subscribing at all suppresses Electron's default quit-on-last-window-closed.
  app.on('window-all-closed', () => {})
}
