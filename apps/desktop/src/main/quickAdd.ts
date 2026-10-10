import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron'
import { join } from 'path'
import { isTaskCardInput, type TaskAttachment } from '@ego/core'
import { queueUploads, type QueuedUpload } from '@ego/local/diary/uploads'
import { newId, saveTaskCard } from '@ego/local/sync/commands'
import { inboxCardInput } from '@ego/local/tasks/board'
import { localTasks } from '@ego/local/tasks/repository'
import { getAppIconPath } from './icon'
import { announceLocalWrite, ledgerDatabase } from './local/ledger'
import { deleteStagedMedia, stageMedia } from './local/media'
import type { QuickAddPayload, QuickAddResult } from '@ego/ui/platform/types'

let quickAddWindow: BrowserWindow | null = null
let previewExpanded = false

const notificationWindows: { window: BrowserWindow; displayId: number; height: number }[] = []
const notificationWidth = 360
const notificationHeight = 66
const notificationMargin = 16
const notificationGap = 10

const QA_WIDTH = 560
const QA_HEIGHT = 420
const QA_PREVIEW_WIDTH = 1120
const QA_PREVIEW_HEIGHT = 840

function createQuickAddWindow(): void {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) return

  quickAddWindow = new BrowserWindow({
    width: QA_WIDTH,
    height: QA_HEIGHT,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  quickAddWindow.on('blur', () => {
    if (previewExpanded) return
    quickAddWindow?.hide()
  })

  quickAddWindow.on('closed', () => {
    quickAddWindow = null
    previewExpanded = false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    quickAddWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-add.html`)
  } else {
    quickAddWindow.loadFile(join(__dirname, '../renderer/quick-add.html'))
  }
}

export function showQuickAddWindow(): void {
  if (!quickAddWindow || quickAddWindow.isDestroyed()) {
    createQuickAddWindow()
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)

  quickAddWindow!.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - QA_WIDTH) / 2),
    Math.round(display.workArea.y + (display.workArea.height - QA_HEIGHT) / 2)
  )

  quickAddWindow!.show()
  quickAddWindow!.focus()
  quickAddWindow!.webContents.send('quick-add-focus', [])
}

export function hideQuickAddWindow(): void {
  quickAddWindow?.hide()
}

function repositionNotifications(displayId: number): void {
  const display = screen.getAllDisplays().find((item) => item.id === displayId)
  if (!display) return

  let offset = 0
  notificationWindows
    .filter(({ window, displayId: id }) => id === displayId && !window.isDestroyed())
    .forEach(({ window, height }) => {
      offset += height
      window.setPosition(
        display.workArea.x + display.workArea.width - notificationWidth - notificationMargin,
        display.workArea.y + display.workArea.height - notificationMargin - offset
      )
      offset += notificationGap
    })
}

function closeNotificationWindow(window: BrowserWindow): void {
  const index = notificationWindows.findIndex((entry) => entry.window === window)
  if (index === -1) return

  const [{ displayId }] = notificationWindows.splice(index, 1)
  if (!window.isDestroyed()) {
    window.destroy()
  }
  repositionNotifications(displayId)
}

export type NotificationTone = 'success' | 'error'

/** The page measures its own content and calls back, so no toast is clipped by a guessed height. */
export function setupNotificationResize(): void {
  ipcMain.on('notification-resize', (event, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return

    const sender = BrowserWindow.fromWebContents(event.sender)
    const entry = notificationWindows.find(({ window }) => window === sender)
    if (!entry || entry.window.isDestroyed()) return

    const next = Math.ceil(height)
    if (next === entry.height) return

    entry.height = next
    entry.window.setBounds({ ...entry.window.getBounds(), height: next })
    repositionNotifications(entry.displayId)
  })
}

export function showNotification(tone: NotificationTone, message: string): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const height = notificationHeight

  const notificationWindow = new BrowserWindow({
    width: notificationWidth,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  notificationWindows.push({ window: notificationWindow, displayId: display.id, height })
  repositionNotifications(display.id)

  notificationWindow.on('closed', () => {
    const index = notificationWindows.findIndex((entry) => entry.window === notificationWindow)
    if (index === -1) return

    const [{ displayId }] = notificationWindows.splice(index, 1)
    repositionNotifications(displayId)
  })

  const holdMs = 3000
  const query = new URLSearchParams({
    type: tone,
    message,
    hold: String(holdMs)
  })
  const params = `?${query.toString()}`

  if (process.env.ELECTRON_RENDERER_URL) {
    notificationWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/notification.html${params}`)
  } else {
    notificationWindow.loadFile(join(__dirname, '../renderer/notification.html'), {
      search: params
    })
  }

  notificationWindow.once('ready-to-show', () => {
    notificationWindow?.showInactive()
  })

  setTimeout(() => {
    closeNotificationWindow(notificationWindow)
  }, holdMs)
}

/**
 * Saves the card on this computer the way the board would, at the bottom of the Inbox, with pasted
 * images staged for upload. The sync that follows sends it, so it works offline too.
 */
async function addToInbox(payload: QuickAddPayload): Promise<QuickAddResult> {
  const database = await ledgerDatabase()
  if (!database) return { ok: false, detail: 'Sign in to Ego first' }
  const db = database.local
  const now = new Date().toISOString()
  const id = newId()
  const staged: string[] = []
  try {
    const attachments: TaskAttachment[] = []
    const uploads: QueuedUpload[] = []
    for (const image of payload.images) {
      const mediaId = newId()
      const copy = await stageMedia({ mediaId, fileName: image.name, mimeType: image.mimeType, data: image.data })
      staged.push(copy.localUri)
      const { width, height } = nativeImage.createFromBuffer(Buffer.from(image.data)).getSize()
      attachments.push({
        id: newId(), mediaId, kind: 'photo', mimeType: image.mimeType, fileName: image.name, size: copy.size,
        width: width || null, height: height || null, durationSeconds: null, previewId: null, addedAt: now
      })
      uploads.push({ mediaId, messageId: id, localUri: copy.localUri, contentType: image.mimeType, size: copy.size, scope: 'tasks' })
    }
    const input = inboxCardInput(await localTasks(db), { title: payload.title, description: payload.description, attachments }, now)
    if (!input) throw new Error('No board has an Inbox list')
    if (!isTaskCardInput(input)) throw new Error('That card is too long to save')
    await db.transaction(async (tx) => {
      await saveTaskCard(tx, id, null, input, now, uploads.length > 0)
      if (uploads.length > 0) await queueUploads(tx, uploads, now)
    })
    announceLocalWrite('tasks')
    return { ok: true }
  } catch (failure: unknown) {
    await deleteStagedMedia(staged).catch(() => undefined)
    return { ok: false, detail: failure instanceof Error ? failure.message : 'Ego could not add that card' }
  }
}

export function setupQuickAddIpc(): void {
  setupNotificationResize()

  ipcMain.handle('quick-add-submit', async (_event, payload: QuickAddPayload) => {
    const normalized: QuickAddPayload = {
      title: (payload?.title ?? '').trim() || '(empty)',
      description: (payload?.description ?? '').trim(),
      images: Array.isArray(payload?.images) ? payload.images : []
    }

    const result = await addToInbox(normalized)
    if (result.ok) {
      hideQuickAddWindow()
      showNotification('success', 'Card added to Inbox')
    } else {
      showNotification('error', result.detail ? `Failed: ${result.detail}` : 'Failed to send')
    }
    return result
  })

  ipcMain.on('quick-add-cancel', () => {
    hideQuickAddWindow()
  })

  ipcMain.on('quick-add-set-preview', (_event, expanded: boolean, aspectRatio?: number) => {
    if (!quickAddWindow || quickAddWindow.isDestroyed()) return
    previewExpanded = expanded

    const bounds = quickAddWindow.getBounds()
    const work = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea

    let width: number
    let height: number
    if (expanded) {
      const maxW = Math.round(work.width * 0.92)
      const maxH = Math.round(work.height * 0.92)
      if (aspectRatio && aspectRatio > 0 && isFinite(aspectRatio)) {
        if (maxW / aspectRatio <= maxH) {
          width = maxW
          height = Math.max(200, Math.round(maxW / aspectRatio))
        } else {
          height = maxH
          width = Math.max(200, Math.round(maxH * aspectRatio))
        }
      } else {
        width = Math.min(QA_PREVIEW_WIDTH, maxW)
        height = Math.min(QA_PREVIEW_HEIGHT, maxH)
      }
    } else {
      width = QA_WIDTH
      height = QA_HEIGHT
    }

    quickAddWindow.setBounds(
      {
        x: Math.round(work.x + (work.width - width) / 2),
        y: Math.round(work.y + (work.height - height) / 2),
        width,
        height
      },
      false
    )
    quickAddWindow.focus()
  })
}
