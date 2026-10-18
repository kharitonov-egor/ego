import { app, nativeImage, shell } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImageTextResponse } from '@ego/api-contracts'
import type {
  ImageTextEngine,
  ImageTextHistoryItem,
  ImageTextSource,
  OcrResult
} from '@ego/ui/platform/types'
import { workerRequest } from './live'
import { readWithWindowsOcr, type WindowsOcrResult } from './windowsOcr'

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageInput {
  data: Buffer
  mimeType: ImageMimeType
}

interface HistoryRecord {
  id: string
  createdAt: string
  source: ImageTextSource
  engine: ImageTextEngine
  text: string
  file: string
  thumbnail: string | null
}

const HISTORY_LIMIT = 50
/** Base64 grows the image by a third, and the Worker refuses a body over 10 MB. */
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024
const EXTENSIONS: Record<ImageMimeType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const STORED_FILE = /^[\w-]+\.(png|jpg|webp)$/
const SOURCES: readonly string[] = ['screen', 'clipboard', 'file'] satisfies ImageTextSource[]
const ENGINES: readonly string[] = ['ai', 'windows'] satisfies ImageTextEngine[]

let pendingHistoryWrite: Promise<unknown> = Promise.resolve()

function historyDirectory(): string {
  return join(app.getPath('userData'), 'image-text')
}

function historyIndex(): string {
  return join(historyDirectory(), 'history.json')
}

function fitForUpload(image: ImageInput): ImageInput {
  if (image.data.length <= MAX_UPLOAD_BYTES) return image
  const decoded = nativeImage.createFromBuffer(image.data)
  if (decoded.isEmpty()) return image
  const { width, height } = decoded.getSize()
  const scale = Math.min(1, 4096 / Math.max(width, height))
  const sized = scale < 1
    ? decoded.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
    : decoded
  return { data: sized.toJPEG(90), mimeType: 'image/jpeg' }
}

async function readWithWindows(image: ImageInput): Promise<WindowsOcrResult> {
  const path = join(tmpdir(), `ego-ocr-${randomUUID()}.${EXTENSIONS[image.mimeType]}`)
  await writeFile(path, image.data)
  try {
    return await readWithWindowsOcr(path)
  } finally {
    await unlink(path).catch(() => undefined)
  }
}

/**
 * Reads the text with the Worker's model, which knows every language, and falls back to Windows
 * OCR when the Worker can't be reached or fails. A model answer with no text is final.
 */
export async function imageToText(image: ImageInput, source: ImageTextSource): Promise<OcrResult> {
  const upload = fitForUpload(image)
  const read = await workerRequest<ImageTextResponse>('/v1/image-text', 'POST', {
    base64: upload.data.toString('base64'),
    mimeType: upload.mimeType
  })
  let text: string
  let engine: ImageTextEngine
  if (read.ok) {
    if (!read.data.text.trim()) return { ok: false, detail: 'No text found in that image.' }
    text = read.data.text
    engine = 'ai'
  } else {
    const local = await readWithWindows(image)
    if (!local.ok) return { ok: false, detail: read.message }
    text = local.text
    engine = 'windows'
  }
  void remember(image, source, engine, text).catch((error: unknown) => {
    console.error('Could not save to the image to text history:', error)
  })
  return { ok: true, text, engine }
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.createdAt === 'string' && typeof record.text === 'string' &&
    typeof record.source === 'string' && SOURCES.includes(record.source) &&
    typeof record.engine === 'string' && ENGINES.includes(record.engine) &&
    typeof record.file === 'string' && STORED_FILE.test(record.file) &&
    (record.thumbnail === null || (typeof record.thumbnail === 'string' && STORED_FILE.test(record.thumbnail)))
}

async function readHistory(): Promise<HistoryRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(historyIndex(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isHistoryRecord) : []
  } catch {
    return []
  }
}

function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const next = pendingHistoryWrite.then(task, task)
  pendingHistoryWrite = next.catch(() => undefined)
  return next
}

function thumbnailOf(data: Buffer): Buffer | null {
  const decoded = nativeImage.createFromBuffer(data)
  if (decoded.isEmpty()) return null
  const { width, height } = decoded.getSize()
  const scale = Math.min(1, 192 / width, 128 / height)
  return decoded.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  }).toJPEG(80)
}

function remember(image: ImageInput, source: ImageTextSource, engine: ImageTextEngine, text: string): Promise<void> {
  return inOrder(async () => {
    const directory = historyDirectory()
    await mkdir(directory, { recursive: true })
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const file = `${id}.${EXTENSIONS[image.mimeType]}`
    await writeFile(join(directory, file), image.data)
    const small = thumbnailOf(image.data)
    const thumbnail = small ? `${id}-thumb.jpg` : null
    if (small && thumbnail) await writeFile(join(directory, thumbnail), small)
    const records: HistoryRecord[] = [
      { id, createdAt: new Date().toISOString(), source, engine, text, file, thumbnail },
      ...await readHistory()
    ]
    await writeFile(historyIndex(), JSON.stringify(records.slice(0, HISTORY_LIMIT)))
    const dropped = records.slice(HISTORY_LIMIT).flatMap((record) => [record.file, record.thumbnail ?? ''])
    await Promise.all(dropped.filter(Boolean).map((name) => rm(join(directory, name), { force: true })))
  })
}

export async function imageTextHistory(): Promise<ImageTextHistoryItem[]> {
  await pendingHistoryWrite
  const directory = historyDirectory()
  return Promise.all((await readHistory()).map(async ({ id, createdAt, source, engine, text, thumbnail }) => ({
    id,
    createdAt,
    source,
    engine,
    text,
    thumbnail: thumbnail
      ? await readFile(join(directory, thumbnail)).then((data) => `data:image/jpeg;base64,${data.toString('base64')}`, () => null)
      : null
  })))
}

export function clearImageTextHistory(): Promise<void> {
  return inOrder(() => rm(historyDirectory(), { recursive: true, force: true }))
}

export async function openImageTextHistoryImage(id: string): Promise<void> {
  const record = (await readHistory()).find((item) => item.id === id)
  if (record) await shell.openPath(join(historyDirectory(), record.file))
}
