import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { getQuickAddListShortcuts, getTrelloListId } from './settings'
import { addAttachmentToCard, createCard } from './trello'
import { notifyWebhook } from './webhook'
import { getAppIconPath } from './icon'
import type { QuickAddPayload, QuickAddResult } from '../shared/types'

let quickAddWindow: BrowserWindow | null = null
let previewExpanded = false

const notificationWindows: { window: BrowserWindow; displayId: number }[] = []
const notificationWidth = 280
const notificationHeight = 56
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
  quickAddWindow!.webContents.send('quick-add-focus', getQuickAddListShortcuts())
}

export function hideQuickAddWindow(): void {
  quickAddWindow?.hide()
}

function repositionNotifications(displayId: number): void {
  const display = screen.getAllDisplays().find((item) => item.id === displayId)
  if (!display) return

  notificationWindows
    .filter(({ window, displayId: id }) => id === displayId && !window.isDestroyed())
    .forEach(({ window }, index) => {
      window.setPosition(
        display.workArea.x + display.workArea.width - notificationWidth - notificationMargin,
        display.workArea.y +
          display.workArea.height -
          notificationHeight -
          notificationMargin -
          index * (notificationHeight + notificationGap)
      )
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

export function showNotification(type: 'success' | 'error', message: string): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)

  const notificationWindow = new BrowserWindow({
    width: notificationWidth,
    height: notificationHeight,
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

  notificationWindows.push({ window: notificationWindow, displayId: display.id })
  repositionNotifications(display.id)

  notificationWindow.on('closed', () => {
    const index = notificationWindows.findIndex((entry) => entry.window === notificationWindow)
    if (index === -1) return

    const [{ displayId }] = notificationWindows.splice(index, 1)
    repositionNotifications(displayId)
  })

  const params = `?type=${encodeURIComponent(type)}&message=${encodeURIComponent(message)}`

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
  }, 3000)
}

async function sendToTrello(payload: QuickAddPayload): Promise<QuickAddResult> {
  const listId = payload.listId || getTrelloListId()
  if (!listId) {
    return { ok: false, detail: 'Trello list not set. Open Settings.' }
  }

  const cardResult = await createCard({
    name: payload.title,
    desc: payload.description,
    idList: listId
  })
  if (!cardResult.ok || !cardResult.data) {
    return { ok: false, detail: cardResult.detail ?? 'Failed to create card' }
  }

  const card = cardResult.data
  let failedAttachments = 0

  if (payload.images.length > 0) {
    const uploads = await Promise.all(
      payload.images.map((image) =>
        addAttachmentToCard(card.id, new Uint8Array(image.data), image.name, image.mimeType)
      )
    )
    failedAttachments = uploads.filter((result) => !result.ok).length
  }

  void notifyWebhook({
    title: payload.title,
    description: payload.description,
    listId,
    cardId: card.id,
    cardUrl: card.shortUrl,
    attachmentCount: payload.images.length - failedAttachments,
    createdAt: new Date().toISOString()
  })

  if (failedAttachments > 0) {
    return {
      ok: false,
      detail: `Card created, ${failedAttachments}/${payload.images.length} attachment(s) failed`
    }
  }

  return { ok: true }
}

export function setupQuickAddIpc(): void {
  ipcMain.handle('quick-add-submit', async (_event, payload: QuickAddPayload) => {
    const normalized: QuickAddPayload = {
      title: (payload?.title ?? '').trim() || '(empty)',
      description: (payload?.description ?? '').trim(),
      images: Array.isArray(payload?.images) ? payload.images : [],
      listId: payload?.listId || undefined
    }

    const result = await sendToTrello(normalized)
    if (result.ok) {
      hideQuickAddWindow()
      showNotification('success', 'Card added to Trello')
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
