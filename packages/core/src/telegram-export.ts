import type {
  DiaryAttachment, DiaryAttachmentKind, DiaryEntity, DiaryEntityType, DiaryMessageInput
} from './diary'

/**
 * Plans an import of a Telegram Desktop JSON export (`result.json`) into the diary. The plan is
 * pure: it names every file to upload with the export-relative paths it may sit at, and leaves
 * reading, converting, and uploading to the script that runs it. IDs come from Telegram's own
 * message IDs, so running the import again finds the same messages instead of adding copies.
 */

/**
 * - `none` uploads the file as it is.
 * - `poster` grabs a frame from a video.
 * - `preview` scales a large image down for the bubble.
 * - `gunzip` unpacks an animated `.tgs` sticker into the Lottie JSON inside it.
 */
export type TelegramUploadTransform = 'none' | 'poster' | 'preview' | 'gunzip'

export interface PlannedDiaryUpload {
  mediaId: string
  /** Export-relative paths, tried in order. */
  candidates: string[]
  mimeType: string
  transform: TelegramUploadTransform
  /** Uploaded as is when the transform fails or no candidate exists, like the export's own thumbnail. */
  fallbacks: string[]
  /** `file` is the attachment itself. Without it the attachment shows as missing. */
  role: 'file' | 'preview' | 'emoji'
}

export interface PlannedDiaryMessage {
  id: string
  /** Telegram posts merged into this message. An album is several posts. */
  telegramIds: number[]
  input: DiaryMessageInput
  uploads: PlannedDiaryUpload[]
}

export interface TelegramImportPlan {
  title: string
  messages: PlannedDiaryMessage[]
  skipped: Array<{ telegramId: number; reason: string }>
}

interface TelegramTextEntity {
  type: string
  text: string
  href?: string
  document_id?: string
}

interface TelegramMessage {
  id: number
  type: string
  date_unixtime: string
  edited_unixtime?: string
  text_entities: TelegramTextEntity[]
  action?: string
  message_id?: number
  forwarded_from?: string | null
  reply_to_message_id?: number
  photo?: string
  photo_file_size?: number
  file?: string
  file_name?: string
  file_size?: number
  thumbnail?: string
  media_type?: string
  mime_type?: string
  sticker_emoji?: string
  duration_seconds?: number
  width?: number
  height?: number
  title?: string
  performer?: string
}

/** Images bigger than this on either side get a smaller preview for the bubble. */
export const TELEGRAM_PREVIEW_EDGE = 1600
const PREVIEW_BYTES = 1500000

const ENTITY_TYPES: Record<string, DiaryEntityType> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strikethrough',
  spoiler: 'spoiler',
  code: 'code',
  pre: 'pre',
  blockquote: 'blockquote',
  link: 'link',
  text_link: 'textLink',
  mention: 'mention',
  mention_name: 'mention',
  hashtag: 'hashtag',
  cashtag: 'cashtag',
  email: 'email',
  phone: 'phone',
  bot_command: 'botCommand',
  custom_emoji: 'customEmoji'
}

const MEDIA_KINDS: Record<string, DiaryAttachmentKind> = {
  video_file: 'video',
  animation: 'animation',
  video_message: 'videoNote',
  audio_file: 'audio',
  voice_message: 'voice',
  sticker: 'sticker'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  return isRecord(value) && Number.isSafeInteger(value.id) && typeof value.type === 'string' &&
    typeof value.date_unixtime === 'string' && Array.isArray(value.text_entities)
}

function isoFromUnix(seconds: string | undefined): string | null {
  const value = Number(seconds)
  return seconds && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null
}

/** The export writes a note in brackets where it left a file out. */
function exportedPath(value: string | undefined): string | null {
  return value && !value.startsWith('(') ? value : null
}

/**
 * Telegram writes a sticker thumbnail into the JSON as `name.webp_thumb.jpg` but saves it as
 * `name_thumb.webp`, and names a file it retried after the JSON was written by its file name.
 */
function thumbnailCandidates(thumbnail: string | undefined, file: string | undefined): string[] {
  const candidates: string[] = []
  const path = exportedPath(thumbnail)
  if (path) candidates.push(path)
  const source = exportedPath(file)
  if (source) {
    const dot = source.lastIndexOf('.')
    if (dot > 0) {
      const extension = source.slice(dot)
      if (/^\.(webp|png|jpe?g)$/i.test(extension)) candidates.push(`${source.slice(0, dot)}_thumb${extension}`)
      candidates.push(`${source.slice(0, dot)}_thumb.jpg`)
    }
  }
  return [...new Set(candidates)]
}

function fileCandidates(message: TelegramMessage, folder: string): string[] {
  const path = exportedPath(message.file)
  const candidates = path ? [path] : []
  if (message.file_name) candidates.push(`${folder}/${message.file_name}`)
  return [...new Set(candidates)]
}

function normalizedMime(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback
  if (mime === 'audio/m4a' || mime === 'audio/x-m4a') return 'audio/mp4'
  return mime
}

function textFrom(message: TelegramMessage, messageId: string): { text: string; entities: DiaryEntity[]; uploads: PlannedDiaryUpload[] } {
  let text = ''
  const entities: DiaryEntity[] = []
  const uploads: PlannedDiaryUpload[] = []
  for (const part of message.text_entities) {
    const offset = text.length
    text += part.text
    const type = ENTITY_TYPES[part.type]
    if (!type || part.text.length === 0) continue
    const entity: DiaryEntity = { type, offset, length: part.text.length }
    if (type === 'textLink' && part.href) entity.url = part.href
    if (type === 'customEmoji' && part.document_id && /\.(webp|png|jpe?g)$/i.test(part.document_id)) {
      const mediaId = `${messageId}-emoji-${uploads.length}`
      entity.mediaId = mediaId
      uploads.push({
        mediaId, candidates: [part.document_id], mimeType: /\.webp$/i.test(part.document_id) ? 'image/webp' : 'image/png',
        transform: 'none', fallbacks: [], role: 'emoji'
      })
    }
    entities.push(entity)
  }
  return { text, entities, uploads }
}

function emptyAttachment(kind: DiaryAttachmentKind, mimeType: string): DiaryAttachment {
  return {
    mediaId: null, kind, mimeType, fileName: null, size: null, width: null, height: null, durationSeconds: null,
    title: null, performer: null, emoji: null, previewId: null, waveform: null
  }
}

function attachmentFrom(message: TelegramMessage): { attachment: DiaryAttachment; uploads: PlannedDiaryUpload[] } | null {
  const fileId = `tg-${message.id}-file`
  const previewId = `tg-${message.id}-preview`
  const dimensions = { width: message.width ?? null, height: message.height ?? null }

  if (message.photo !== undefined) {
    const attachment = {
      ...emptyAttachment('photo', 'image/jpeg'), ...dimensions, mediaId: fileId, size: message.photo_file_size ?? null
    }
    return {
      attachment,
      uploads: [{ mediaId: fileId, candidates: exportedPath(message.photo) ? [message.photo as string] : [], mimeType: 'image/jpeg', transform: 'none', fallbacks: [], role: 'file' }]
    }
  }
  if (message.file === undefined) return null

  const mediaKind = message.media_type ? MEDIA_KINDS[message.media_type] : undefined
  const mime = normalizedMime(message.mime_type, 'application/octet-stream')
  const kind: DiaryAttachmentKind = mediaKind ?? (mime.startsWith('image/') ? 'photo' : 'file')
  const folder = kind === 'video' || kind === 'animation' ? 'video_files'
    : kind === 'videoNote' ? 'round_video_messages'
      : kind === 'sticker' ? 'stickers' : 'files'
  const candidates = fileCandidates(message, folder)
  const thumbnails = thumbnailCandidates(message.thumbnail, message.file)
  const animated = kind === 'sticker' && mime === 'application/x-tgsticker'
  const attachment: DiaryAttachment = {
    ...emptyAttachment(kind, animated ? 'application/json' : mime),
    ...dimensions,
    mediaId: fileId,
    fileName: kind === 'sticker' ? null : message.file_name ?? null,
    size: animated ? null : message.file_size ?? null,
    durationSeconds: message.duration_seconds ?? null,
    title: message.title ?? null,
    performer: message.performer ?? null,
    emoji: message.sticker_emoji ?? null
  }
  const uploads: PlannedDiaryUpload[] = [{
    mediaId: fileId, candidates, mimeType: attachment.mimeType, transform: animated ? 'gunzip' : 'none', fallbacks: [], role: 'file'
  }]

  const edge = Math.max(message.width ?? 0, message.height ?? 0)
  if (kind === 'video' || kind === 'animation' || kind === 'videoNote') {
    attachment.previewId = previewId
    uploads.push({ mediaId: previewId, candidates, mimeType: 'image/jpeg', transform: 'poster', fallbacks: thumbnails, role: 'preview' })
  } else if (kind === 'photo' && (edge > TELEGRAM_PREVIEW_EDGE || (message.file_size ?? 0) > PREVIEW_BYTES || mime === 'image/gif')) {
    attachment.previewId = previewId
    uploads.push({ mediaId: previewId, candidates, mimeType: 'image/jpeg', transform: 'preview', fallbacks: thumbnails, role: 'preview' })
  } else if (kind === 'file' || kind === 'sticker') {
    if (thumbnails.length > 0) {
      attachment.previewId = previewId
      uploads.push({ mediaId: previewId, candidates: [], mimeType: 'image/jpeg', transform: 'none', fallbacks: thumbnails, role: 'preview' })
    }
  }
  return { attachment, uploads }
}

function isAlbumMedia(message: TelegramMessage): boolean {
  return message.photo !== undefined || message.media_type === 'video_file' ||
    (message.media_type === undefined && message.file !== undefined && (message.mime_type ?? '').startsWith('image/'))
}

const ALBUM_LIMIT = 10
const ALBUM_GAP_SECONDS = 2

/**
 * Telegram exports each photo of an album as its own post, a second or two apart, with the
 * caption on one of them. Consecutive photo and video posts that close together, from the same
 * forward, with at most one caption, become one message with a grid.
 */
function albums(messages: readonly TelegramMessage[]): TelegramMessage[][] {
  const groups: TelegramMessage[][] = []
  for (const message of messages) {
    const group = groups[groups.length - 1]
    const last = group?.[group.length - 1]
    const joins = group !== undefined && last !== undefined && group.length < ALBUM_LIMIT &&
      isAlbumMedia(message) && group.every(isAlbumMedia) &&
      message.id === last.id + 1 &&
      Math.abs(Number(message.date_unixtime) - Number(last.date_unixtime)) <= ALBUM_GAP_SECONDS &&
      ('forwarded_from' in message) === ('forwarded_from' in last) && message.forwarded_from === last.forwarded_from &&
      message.reply_to_message_id === undefined &&
      !(hasText(message) && group.some(hasText))
    if (joins) group.push(message)
    else groups.push([message])
  }
  return groups
}

function hasText(message: TelegramMessage): boolean {
  return message.text_entities.some((part) => part.text.trim().length > 0)
}

export function planTelegramImport(exported: unknown): TelegramImportPlan {
  if (!isRecord(exported) || !Array.isArray(exported.messages)) {
    throw new Error('This is not a Telegram JSON export. Export the chat as JSON, not HTML.')
  }
  const title = typeof exported.name === 'string' ? exported.name : 'Telegram'
  const skipped: TelegramImportPlan['skipped'] = []
  const posts: TelegramMessage[] = []
  const pins = new Map<number, string>()
  for (const raw of exported.messages) {
    if (!isTelegramMessage(raw)) continue
    if (raw.type === 'service') {
      const pinnedAt = isoFromUnix(raw.date_unixtime)
      if (raw.action === 'pin_message' && raw.message_id !== undefined && pinnedAt) {
        const previous = pins.get(raw.message_id)
        if (!previous || previous < pinnedAt) pins.set(raw.message_id, pinnedAt)
      }
      continue
    }
    if (raw.type !== 'message') {
      skipped.push({ telegramId: raw.id, reason: `a ${raw.type} entry` })
      continue
    }
    posts.push(raw)
  }
  posts.sort((left, right) => left.id - right.id)

  const groups = albums(posts)
  const ownerOf = new Map<number, string>()
  for (const group of groups) for (const post of group) ownerOf.set(post.id, `tg-${group[0].id}`)

  const messages: PlannedDiaryMessage[] = []
  for (const group of groups) {
    const first = group[0]
    const id = `tg-${first.id}`
    const captioned = group.find(hasText) ?? first
    const { text, entities, uploads } = textFrom(captioned, id)
    const attachments: DiaryAttachment[] = []
    for (const post of group) {
      const planned = attachmentFrom(post)
      if (!planned) continue
      attachments.push(planned.attachment)
      uploads.push(...planned.uploads)
    }
    if (text.trim().length === 0 && attachments.length === 0) {
      skipped.push({ telegramId: first.id, reason: 'no text and nothing attached' })
      continue
    }
    const sentAt = isoFromUnix(first.date_unixtime)
    if (!sentAt) {
      skipped.push({ telegramId: first.id, reason: 'no date' })
      continue
    }
    const edits = group.map((post) => isoFromUnix(post.edited_unixtime)).filter((value): value is string => value !== null).sort()
    const pinned = group.map((post) => pins.get(post.id)).filter((value): value is string => value !== undefined).sort()
    const replyTarget = first.reply_to_message_id
    messages.push({
      id,
      telegramIds: group.map((post) => post.id),
      input: {
        sentAt,
        text,
        entities,
        attachments,
        replyToId: replyTarget !== undefined ? ownerOf.get(replyTarget) ?? null : null,
        forwarded: 'forwarded_from' in first,
        forwardedFrom: first.forwarded_from ?? null,
        pinnedAt: pinned[pinned.length - 1] ?? null,
        editedAt: edits[edits.length - 1] ?? null,
        source: 'telegram'
      },
      uploads
    })
  }
  return { title, messages, skipped }
}
