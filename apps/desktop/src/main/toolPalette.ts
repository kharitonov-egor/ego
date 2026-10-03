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
import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { getAppIconPath } from './icon'
import { showNotification } from './quickAdd'
import type {
  MediaDownloadInput,
  MediaDownloadResult,
  MediaDownloaderStatus,
  OcrResult
} from '../shared/types'

const PALETTE_WIDTH = 560
const PALETTE_HEIGHT = 420
const POWERSHELL_OCR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

function Await($operation, [Type]$resultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:EGO_OCR_IMAGE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Install a Windows OCR language pack, then try again.' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
`

let paletteWindow: BrowserWindow | null = null
let paletteLocked = false
let activeDownload: ChildProcessWithoutNullStreams | null = null

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
    if (!paletteLocked && !activeDownload) paletteWindow?.hide()
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

function runPowerShellOcr(imagePath: string): Promise<OcrResult> {
  const encoded = Buffer.from(POWERSHELL_OCR, 'utf16le').toString('base64')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        encoding: 'utf8',
        env: { ...process.env, EGO_OCR_IMAGE: imagePath },
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          resolve({ ok: false, detail: detail.replace(/^.*?:\s*/s, '').trim() })
          return
        }

        const text = stdout.replace(/^\uFEFF/, '').trim()
        resolve(
          text
            ? { ok: true, text }
            : { ok: false, detail: 'Windows OCR did not find any text in that image.' }
        )
      }
    )
  })
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

  const imagePath = join(tmpdir(), `ego-ocr-${Date.now()}.png`)
  await writeFile(imagePath, png)
  try {
    return await runPowerShellOcr(imagePath)
  } finally {
    await unlink(imagePath).catch(() => undefined)
  }
}

async function chooseImage(): Promise<OcrResult> {
  paletteLocked = true
  try {
    const result = await dialog.showOpenDialog(paletteWindow!, {
      title: 'Read text from image',
      defaultPath: app.getPath('pictures'),
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'gif'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, detail: 'No image selected.' }
    }
    return await runPowerShellOcr(result.filePaths[0])
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
    if (isPaletteSender(event.sender.id)) hideToolPalette()
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
