import { HTTP_STATUS, type ApiErrorCode } from '@ego/api-contracts'
import {
  TASK_DESCRIPTION_LIMIT, TASK_TITLE_LIMIT, isDiaryMimeType, type TaskAttachment, type TaskAttachmentKind
} from '@ego/core'
import { hashToken, type Env } from './auth'
import { storeMedia } from './diary'
import { addToInbox, type InboxCard } from './tasks-inbox'

const TELEGRAM = 'https://api.telegram.org'
/** Telegram's ceiling on a file a bot may download. */
const BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024
const PREVIEW_EDGE = 800
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'
const ALBUM_ID = /^[A-Za-z0-9_-]{1,40}$/
const DONE_REACTION = '👍'

type Json = Record<string, unknown>

interface TelegramFile {
  fileId: string
  size: number | null
}

interface IncomingFile extends TelegramFile {
  kind: TaskAttachmentKind
  mimeType: string
  fileName: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  preview: TelegramFile | null
  /** The title when nothing was typed with the file. */
  label: string
}

export interface IncomingMessage {
  chatId: number
  chatType: string
  messageId: number
  senderId: number | null
  text: string
  albumId: string | null
  file: IncomingFile | null
  voice: (TelegramFile & { mimeType: string; durationSeconds: number | null }) | null
  /** Markdown naming who a forwarded message came from. */
  forwardedFrom: string | null
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function fail(code: ApiErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : null
}

function text(value: Json | null, key: string): string | null {
  const item = value?.[key]
  return typeof item === 'string' ? item : null
}

function count(value: Json | null, key: string): number | null {
  const item = value?.[key]
  return typeof item === 'number' && Number.isFinite(item) ? item : null
}

function fileOf(value: Json | null): TelegramFile | null {
  const fileId = text(value, 'file_id')
  return fileId ? { fileId, size: count(value, 'file_size') } : null
}

function mimeOf(value: Json | null, fallback: string): string {
  const mime = text(value, 'mime_type')?.toLowerCase()
  return isDiaryMimeType(mime) ? mime : fallback
}

function kindOf(mimeType: string): TaskAttachmentKind {
  if (mimeType.startsWith('image/')) return 'photo'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

/** The description's Markdown has no escapes, and a bracket inside a link's text would end it early. */
function linkText(value: string): string {
  return value.replace(/[[\]]/g, '')
}

function photoFrom(sizes: unknown): IncomingFile | null {
  if (!Array.isArray(sizes)) return null
  const photos = sizes.map(record).filter((size): size is Json => size !== null && fileOf(size) !== null)
  const largest = photos.at(-1)
  const main = largest ? fileOf(largest) : null
  if (!largest || !main) return null
  const edge = (size: Json): number => Math.max(count(size, 'width') ?? 0, count(size, 'height') ?? 0)
  const small = photos.filter((size) => size !== largest && edge(size) <= PREVIEW_EDGE).at(-1)
  return {
    ...main, kind: 'photo', mimeType: 'image/jpeg', fileName: null, width: count(largest, 'width'),
    height: count(largest, 'height'), durationSeconds: null, preview: small ? fileOf(small) : null, label: 'Photo'
  }
}

function mediaFrom(raw: Json | null, fallbackMime: string, label: string): IncomingFile | null {
  const main = fileOf(raw)
  if (!main) return null
  const mimeType = mimeOf(raw, fallbackMime)
  const fileName = text(raw, 'file_name')?.trim() || null
  return {
    ...main, kind: kindOf(mimeType), mimeType, fileName, width: count(raw, 'width') ?? count(raw, 'length'),
    height: count(raw, 'height') ?? count(raw, 'length'), durationSeconds: count(raw, 'duration'),
    preview: fileOf(record(raw?.thumbnail)), label: fileName ?? label
  }
}

function audioLabel(raw: Json | null): string {
  const title = [text(raw, 'performer'), text(raw, 'title')].filter(Boolean).join(' - ')
  return title || 'Audio'
}

function forwardedFrom(origin: Json | null): string | null {
  if (!origin) return null
  const type = text(origin, 'type')
  if (type === 'user') {
    const user = record(origin.sender_user)
    const name = [text(user, 'first_name'), text(user, 'last_name')].filter(Boolean).join(' ').trim() || 'someone'
    const username = text(user, 'username')
    return username ? `[${linkText(name)}](https://t.me/${username})` : linkText(name)
  }
  if (type === 'hidden_user') return linkText(text(origin, 'sender_user_name') ?? 'someone')
  const chat = record(type === 'channel' ? origin.chat : origin.sender_chat)
  const title = linkText(text(chat, 'title') ?? 'a chat')
  const username = text(chat, 'username')
  const postId = count(origin, 'message_id')
  if (username && postId !== null) return `[${title}](https://t.me/${username}/${postId})`
  return username ? `[${title}](https://t.me/${username})` : title
}

/** The parts of a Telegram update the Inbox uses, or null when it is not a message. */
export function readMessage(update: unknown): IncomingMessage | null {
  const message = record(record(update)?.message)
  const chat = record(message?.chat)
  const chatId = count(chat, 'id')
  const messageId = count(message, 'message_id')
  if (!message || chatId === null || messageId === null) return null
  const albumId = text(message, 'media_group_id')
  const voice = record(message.voice)
  const voiceFile = fileOf(voice)
  return {
    chatId,
    chatType: text(chat, 'type') ?? '',
    messageId,
    senderId: count(record(message.from), 'id'),
    text: text(message, 'text') || text(message, 'caption') || '',
    albumId: albumId && ALBUM_ID.test(albumId) ? albumId : null,
    file: photoFrom(message.photo) ??
      mediaFrom(record(message.video), 'video/mp4', 'Video') ??
      mediaFrom(record(message.animation), 'video/mp4', 'GIF') ??
      mediaFrom(record(message.video_note), 'video/mp4', 'Video message') ??
      mediaFrom(record(message.audio), 'audio/mpeg', audioLabel(record(message.audio))) ??
      mediaFrom(record(message.document), 'application/octet-stream', 'File'),
    voice: voiceFile ? { ...voiceFile, mimeType: mimeOf(voice, 'audio/ogg'), durationSeconds: count(voice, 'duration') } : null,
    forwardedFrom: forwardedFrom(record(message.forward_origin))
  }
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value
  const cut = value.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > limit - 80 ? cut.slice(0, space) : cut}…`
}

/** The first line is the title and the rest the description. A first line too long for a title goes whole into the description. */
export function cardText(message: string): { title: string; description: string } {
  const trimmed = message.trim()
  const [first, ...rest] = trimmed.split(/\r?\n/)
  const title = first.trim()
  if (title.length <= TASK_TITLE_LIMIT) return { title, description: rest.join('\n').trim() }
  return { title: clip(title, TASK_TITLE_LIMIT), description: trimmed }
}

interface Bot {
  call: (method: string, body: Json) => Promise<Result<unknown>>
  download: (file: TelegramFile) => Promise<Result<ArrayBuffer>>
}

function telegramBot(token: string): Bot {
  const call = async (method: string, body: Json): Promise<Result<unknown>> => {
    try {
      const response = await fetch(`${TELEGRAM}/bot${token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      const payload = record(await response.json())
      if (payload?.ok === true) return { ok: true, value: payload.result }
      return { ok: false, reason: text(payload, 'description') ?? `Telegram answered ${response.status}` }
    } catch {
      return { ok: false, reason: 'Telegram did not answer' }
    }
  }
  return {
    call,
    async download(file) {
      if (file.size !== null && file.size > BOT_DOWNLOAD_LIMIT) return { ok: false, reason: 'it is over the 20 MB a bot may download' }
      const meta = await call('getFile', { file_id: file.fileId })
      if (!meta.ok) return meta
      const path = text(record(meta.value), 'file_path')
      if (!path) return { ok: false, reason: 'Telegram did not say where the file is' }
      try {
        const response = await fetch(`${TELEGRAM}/file/bot${token}/${path}`)
        if (!response.ok) return { ok: false, reason: `Telegram answered ${response.status} for the file` }
        return { ok: true, value: await response.arrayBuffer() }
      } catch {
        return { ok: false, reason: 'the download from Telegram failed' }
      }
    }
  }
}

async function transcribe(env: Env, audio: ArrayBuffer, mimeType: string): Promise<Result<string>> {
  if (!env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_API_KEY is not set on the server' }
  const form = new FormData()
  form.append('file', new File([audio], 'voice.ogg', { type: mimeType }))
  form.append('model', env.TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL)
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form
    })
    const payload = record(await response.json())
    const spoken = text(payload, 'text')?.trim()
    if (response.ok && spoken) return { ok: true, value: spoken }
    if (response.ok) return { ok: false, reason: 'no speech was heard' }
    return { ok: false, reason: text(record(payload?.error), 'message') ?? `OpenAI answered ${response.status}` }
  } catch {
    return { ok: false, reason: 'OpenAI did not answer' }
  }
}

/** Copies one Telegram file into R2. The IDs come from the message, so a retried delivery writes the same objects. */
async function keep(env: Env, bot: Bot, file: IncomingFile, baseId: string, now: string): Promise<Result<TaskAttachment>> {
  const bytes = await bot.download(file)
  if (!bytes.ok) return bytes
  if (!await storeMedia(env, 'tasks', baseId, bytes.value, file.mimeType, now)) return { ok: false, reason: 'file storage is not set up on the server' }
  let previewId: string | null = null
  if (file.preview) {
    const preview = await bot.download(file.preview)
    if (preview.ok && await storeMedia(env, 'tasks', `${baseId}-p`, preview.value, 'image/jpeg', now)) previewId = `${baseId}-p`
  }
  return {
    ok: true,
    value: {
      id: baseId, mediaId: baseId, kind: file.kind, mimeType: file.mimeType, fileName: file.fileName,
      size: bytes.value.byteLength, width: file.width, height: file.height, durationSeconds: file.durationSeconds,
      previewId, addedAt: now
    }
  }
}

interface Draft {
  card: InboxCard
  /** What did not make it onto the card, said after "Added, but". */
  problem: string | null
}

async function draftCard(env: Env, bot: Bot, message: IncomingMessage, now: string): Promise<Draft> {
  const baseId = `tg-${message.chatId}-${message.messageId}`
  const attachments: TaskAttachment[] = []
  let problem: string | null = null
  let typed = message.text.trim()
  let label = 'Telegram message'

  if (message.file) {
    label = message.file.label
    const kept = await keep(env, bot, message.file, baseId, now)
    if (kept.ok) attachments.push(kept.value)
    else problem = `the ${message.file.kind} stayed in Telegram: ${kept.reason}.`
  } else if (message.voice) {
    label = 'Voice note'
    const voice = message.voice
    const audio = await bot.download(voice)
    if (!audio.ok) {
      problem = `the voice note stayed in Telegram: ${audio.reason}.`
    } else {
      const spoken = await transcribe(env, audio.value, voice.mimeType)
      if (spoken.ok) typed = typed ? `${typed}\n${spoken.value}` : spoken.value
      else problem = `I could not transcribe it: ${spoken.reason}.`
      if (await storeMedia(env, 'tasks', baseId, audio.value, voice.mimeType, now)) {
        attachments.push({
          id: baseId, mediaId: baseId, kind: 'file', mimeType: voice.mimeType, fileName: 'Voice note.ogg', size: audio.value.byteLength,
          width: null, height: null, durationSeconds: voice.durationSeconds, previewId: null, addedAt: now
        })
      }
    }
  }

  const { title, description } = typed ? cardText(typed) : { title: label, description: '' }
  const from = message.forwardedFrom ? `From ${message.forwardedFrom}` : ''
  return {
    card: { title, description: clip([description, from].filter(Boolean).join('\n\n'), TASK_DESCRIPTION_LIMIT), attachments },
    problem
  }
}

const HELP = 'Send me a task and it goes to the bottom of your Inbox. The first line is the title. Photos, files, and voice notes work too.'

async function answer(env: Env, bot: Bot, message: IncomingMessage, now: string): Promise<void> {
  const reply = (words: string): Promise<unknown> => bot.call('sendMessage', {
    chat_id: message.chatId, text: words, reply_parameters: { message_id: message.messageId, allow_sending_without_reply: true }
  })
  if (/^\/start(?:\s|$)/.test(message.text.trim())) {
    await reply(HELP)
    return
  }
  if (!message.text.trim() && !message.file && !message.voice) {
    await reply('I can only add text, photos, files, and voice notes.')
    return
  }
  const draft = await draftCard(env, bot, message, now)
  const cardId = message.albumId ? `tg-${message.chatId}-album-${message.albumId}` : `tg-${message.chatId}-${message.messageId}`
  const added = await addToInbox(env.DB, cardId, draft.card, now)
  if (!added.ok) {
    await reply(`Not added: ${added.error.message}. Send it again.`)
    return
  }
  await bot.call('setMessageReaction', { chat_id: message.chatId, message_id: message.messageId, reaction: [{ type: 'emoji', emoji: DONE_REACTION }] })
  if (draft.problem && added.data !== 'duplicate') await reply(`Added, but ${draft.problem}`)
}

async function sameSecret(sent: string | null, expected: string): Promise<boolean> {
  if (!sent) return false
  const [left, right] = await Promise.all([hashToken(sent), hashToken(expected)])
  return left === right
}

/**
 * POST /v1/telegram/webhook: Telegram delivers each message sent to the bot here. Only the owner's
 * private chat counts. Everything past the secret check answers 200, because anything else makes
 * Telegram resend the same update and hold back the ones behind it.
 */
export async function telegramRoute(request: Request, env: Env, now: string): Promise<Response> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim()
  const owner = env.TELEGRAM_OWNER_ID?.trim()
  if (!token || !secret || !owner) return fail('NOT_CONFIGURED', 'The Telegram bot is not set up on the server')
  if (!await sameSecret(request.headers.get('x-telegram-bot-api-secret-token'), secret)) {
    return fail('AUTH_REQUIRED', 'Send the webhook secret')
  }
  const message = readMessage(await request.json().catch(() => null))
  if (!message || message.chatType !== 'private' || String(message.senderId) !== owner) return json({ ok: true })
  const bot = telegramBot(token)
  try {
    await answer(env, bot, message, now)
  } catch {
    await bot.call('sendMessage', { chat_id: message.chatId, text: 'Not added: something broke on the server. Send it again.' })
  }
  return json({ ok: true })
}
