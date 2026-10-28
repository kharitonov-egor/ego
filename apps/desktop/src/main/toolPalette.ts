import {
  BrowserWindow,
  app,
  clipboard,
  dialog,
  ipcMain,
  screen,
  shell
} from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdir, readFile } from 'fs/promises'
import { extname, join } from 'path'
import { focusReturn } from './focusReturn'
import { getAppIconPath } from './icon'
import {
  clearImageTextHistory,
  imageTextHistory,
  imageToText,
  openImageTextHistoryImage,
  type ImageMimeType
} from './imageText'
import { showNotification } from './quickAdd'
import type {
  MediaDownloadInput,
  MediaDownloadResult,
  MediaDownloaderStatus,
  OcrResult
} from '@ego/ui/platform/types'

const PALETTE_WIDTH = 560
const PALETTE_HEIGHT = 420

let paletteWindow: BrowserWindow | null = null
let paletteLocked = false
let activeDownload: ChildProcessWithoutNullStreams | null = null
const paletteFocus = focusReturn()

function isPaletteSender(senderId: number): boolean {
  return Boolean(
    paletteWindow &&
      !paletteWindow.isDestroyed() &&
      paletteWindow.webContents.id === senderId
  )
}

function createPaletteWindow(): void {
  if (paletteWindow && !paletteWindow.isDestroyed()) return

  paletteWindow = new BrowserWindow({
    width: PALETTE_WIDTH,
    height: PALETTE_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
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

  paletteWindow.on('blur', () => {
    if (paletteLocked) return
    paletteFocus.remember()
    if (!activeDownload) paletteWindow?.hide()
  })

  paletteWindow.on('closed', () => {
    paletteWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    paletteWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/tool-palette.html`)
  } else {
    paletteWindow.loadFile(join(__dirname, '../renderer/tool-palette.html'))
  }
}

export function showToolPalette(): void {
  paletteFocus.remember(paletteWindow)
  if (!paletteWindow || paletteWindow.isDestroyed()) createPaletteWindow()

  const reveal = async (): Promise<void> => {
    if (!paletteWindow || paletteWindow.isDestroyed()) return
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    paletteWindow.setPosition(
      Math.round(display.workArea.x + (display.workArea.width - PALETTE_WIDTH) / 2),
      Math.round(display.workArea.y + (display.workArea.height - PALETTE_HEIGHT) / 2)
    )
    paletteWindow.show()
    paletteWindow.focus()
    const clipboardText = await clipboard.readText().catch(() => '')
    paletteWindow.webContents.send('tool-palette-focus', clipboardText.trim())
  }

  if (paletteWindow!.webContents.isLoading()) {
    paletteWindow!.webContents.once('did-finish-load', () => void reveal())
  } else {
    void reveal()
  }
}

function hideToolPalette(): void {
  paletteWindow?.hide()
}

async function clipboardPng(): Promise<Buffer | null> {
  const items = await clipboard.read().catch(() => [])
  const item = items.find((entry) => entry.types.includes('image/png'))
  if (!item) return null
  const blob = await item.getType('image/png')
  return blob instanceof Blob ? Buffer.from(await blob.arrayBuffer()) : null
}

async function readClipboardImage(): Promise<OcrResult> {
  const png = await clipboardPng()
  if (!png || png.length === 0) {
    return { ok: false, detail: 'Copy an image or screenshot first.' }
  }
  return imageToText({ data: png, mimeType: 'image/png' }, 'clipboard')
}

const FILE_TYPES: Record<string, ImageMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

async function chooseImage(): Promise<OcrResult> {
  paletteLocked = true
  try {
    const result = await dialog.showOpenDialog(paletteWindow!, {
      title: 'Read text from image',
      defaultPath: app.getPath('pictures'),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) {
      return { ok: false, detail: 'No image selected.' }
    }
    const mimeType = FILE_TYPES[extname(path).toLowerCase()]
    if (!mimeType) return { ok: false, detail: 'Choose a PNG, JPEG, or WebP image.' }
    return await imageToText({ data: await readFile(path), mimeType }, 'file')
  } finally {
    paletteLocked = false
    paletteWindow?.show()
    paletteWindow?.focus()
  }
}

function commandVersion(command: string, args = ['--version']): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout.trim().split(/\r?\n/, 1)[0] || null)
    })
  })
}

async function getDownloaderStatus(): Promise<MediaDownloaderStatus> {
  const [version, ffmpegVersion] = await Promise.all([
    commandVersion('yt-dlp'),
    commandVersion('ffmpeg', ['-version'])
  ])
  return {
    available: Boolean(version),
    version: version ?? undefined,
    ffmpegAvailable: Boolean(ffmpegVersion)
  }
}

function isDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function sendDownloadLine(line: string): void {
  if (!paletteWindow || paletteWindow.isDestroyed()) return
  paletteWindow.webContents.send('media-download-progress', line)
}

async function downloadMedia(input: MediaDownloadInput): Promise<MediaDownloadResult> {
  const url = input?.url?.trim() ?? ''
  if (!isDownloadUrl(url)) return { ok: false, detail: 'Paste a valid http or https URL.' }
  if (activeDownload) return { ok: false, detail: 'Another download is still running.' }

  const status = await getDownloaderStatus()
  if (!status.available) {
    return {
      ok: false,
      detail: 'yt-dlp is not installed. Open the setup link below, install it, then try again.'
    }
  }
  if (input.format === 'audio' && !status.ffmpegAvailable) {
    return { ok: false, detail: 'Audio conversion needs ffmpeg. Install ffmpeg, then try again.' }
  }

  const outputDirectory = join(app.getPath('downloads'), 'Ego')
  await mkdir(outputDirectory, { recursive: true })
  const args = [
    '--no-playlist',
    '--newline',
    '--windows-filenames',
    '--paths',
    outputDirectory,
    '--output',
    '%(title)s [%(id)s].%(ext)s',
    '--print',
    'after_move:__EGO_FILE__:%(filepath)s'
  ]
  if (input.format === 'audio') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0')
  }
  args.push(url)

  return new Promise((resolve) => {
    const process = spawn('yt-dlp', args, { windowsHide: true })
    activeDownload = process
    let detail = ''
    let savedFile = ''

    const consume = (chunk: Buffer): void => {
      chunk
        .toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line.startsWith('__EGO_FILE__:')) {
            savedFile = line.slice('__EGO_FILE__:'.length)
          } else {
            sendDownloadLine(line)
          }
        })
    }

    process.stdout.on('data', consume)
    process.stderr.on('data', (chunk: Buffer) => {
      detail = `${detail}\n${chunk.toString('utf8')}`.trim().slice(-6000)
      consume(chunk)
    })
    process.on('error', (error) => {
      activeDownload = null
      resolve({ ok: false, detail: error.message })
    })
    process.on('close', (code) => {
      activeDownload = null
      if (code === 0) {
        showNotification('success', 'Media saved to Downloads\\Ego')
        resolve({ ok: true, outputDirectory, savedFile: savedFile || undefined })
      } else {
        const lastLine = detail.split(/\r?\n/).filter(Boolean).at(-1)
        resolve({ ok: false, detail: lastLine ?? `yt-dlp stopped with exit code ${code}.` })
      }
    })
  })
}

export function setupToolPaletteIpc(): void {
  ipcMain.on('tool-palette-hide', (event) => {
    if (!isPaletteSender(event.sender.id)) return
    paletteFocus.restore(paletteWindow)
    hideToolPalette()
  })
  ipcMain.handle('tool-open-claude', async (event) => {
    if (!isPaletteSender(event.sender.id)) return
    hideToolPalette()
    await shell.openExternal('https://claude.ai/')
  })
  ipcMain.handle('tool-ocr-clipboard', (event) => {
    if (!isPaletteSender(event.sender.id)) {
      return { ok: false, detail: 'This action is only available in Quick tools.' } satisfies OcrResult
    }
    return readClipboardImage()
  })
  ipcMain.handle('tool-ocr-file', (event) => {
    if (!isPaletteSender(event.sender.id)) {
      return { ok: false, detail: 'This action is only available in Quick tools.' } satisfies OcrResult
    }
    return chooseImage()
  })
  ipcMain.handle('image-text-history', (event) => isPaletteSender(event.sender.id) ? imageTextHistory() : [])
  ipcMain.handle('image-text-history-clear', async (event) => {
    if (isPaletteSender(event.sender.id)) await clearImageTextHistory()
  })
  ipcMain.handle('image-text-history-open', async (event, id: unknown) => {
    if (isPaletteSender(event.sender.id) && typeof id === 'string') await openImageTextHistoryImage(id)
  })
  ipcMain.handle('tool-copy-text', async (event, text: string) => {
    if (isPaletteSender(event.sender.id) && typeof text === 'string') await clipboard.writeText(text)
  })
  ipcMain.handle('media-downloader-status', (event) => {
    if (!isPaletteSender(event.sender.id)) {
      return { available: false, ffmpegAvailable: false } satisfies MediaDownloaderStatus
    }
    return getDownloaderStatus()
  })
  ipcMain.handle('media-download', (event, input: MediaDownloadInput) => {
    if (!isPaletteSender(event.sender.id)) {
      return { ok: false, detail: 'This action is only available in Quick tools.' } satisfies MediaDownloadResult
    }
    return downloadMedia(input)
  })
  ipcMain.handle('media-open-downloads', (event, savedFile?: string) => {
    if (!isPaletteSender(event.sender.id)) return
    if (savedFile) shell.showItemInFolder(savedFile)
    else {
      const directory = join(app.getPath('downloads'), 'Ego')
      return mkdir(directory, { recursive: true }).then(() => shell.openPath(directory))
    }
  })
}
