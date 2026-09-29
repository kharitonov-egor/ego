/**
 * The diary is a chat with yourself: messages with text, formatting, and attachments. The files
 * live in R2 under their media ID; a message only carries the IDs and what a bubble needs to draw
 * them before the bytes arrive.
 */

export type DiaryAttachmentKind =
  | 'photo' | 'video' | 'animation' | 'videoNote' | 'voice' | 'audio' | 'sticker' | 'file'

export const DIARY_ATTACHMENT_KINDS: readonly DiaryAttachmentKind[] = [
  'photo', 'video', 'animation', 'videoNote', 'voice', 'audio', 'sticker', 'file'
]

export type DiaryEntityType =
  | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'blockquote'
  | 'link' | 'textLink' | 'mention' | 'hashtag' | 'cashtag' | 'email' | 'phone' | 'botCommand'
  | 'customEmoji'

export const DIARY_ENTITY_TYPES: readonly DiaryEntityType[] = [
  'bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'code', 'pre', 'blockquote',
  'link', 'textLink', 'mention', 'hashtag', 'cashtag', 'email', 'phone', 'botCommand', 'customEmoji'
]

export type DiarySource = 'app' | 'telegram'

/** Offsets and lengths count UTF-16 code units, the way JavaScript indexes a string. */
export interface DiaryEntity {
  type: DiaryEntityType
  offset: number
  length: number
  /** The target of a `textLink`. */
  url?: string | null
  /** The image drawn in place of a `customEmoji`. */
  mediaId?: string | null
}

export interface DiaryAttachment {
  /** Null when the file never reached Ego, like a video Telegram left out of the export. */
  mediaId: string | null
  kind: DiaryAttachmentKind
  mimeType: string
  fileName: string | null
  size: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  title: string | null
  performer: string | null
  emoji: string | null
  /** A smaller image for the bubble: a video's poster, a large photo's preview, a PDF's first page. */
  previewId: string | null
  /** Voice notes only: bar heights from 0 to 100. */
  waveform: number[] | null
}

export interface DiaryMessageInput {
  sentAt: string
  text: string
  entities: DiaryEntity[]
  attachments: DiaryAttachment[]
  replyToId: string | null
  forwarded: boolean
  /** Who a forwarded message came from. Telegram hides some senders, so it can be null. */
  forwardedFrom: string | null
  pinnedAt: string | null
  editedAt: string | null
  source: DiarySource
}

export interface DiaryMessage extends DiaryMessageInput {
  id: string
  createdAt: string
  updatedAt: string
}

export const DIARY_TEXT_LIMIT = 20000
export const DIARY_ATTACHMENT_LIMIT = 20
export const DIARY_ENTITY_LIMIT = 4000
export const DIARY_WAVEFORM_LIMIT = 128
/** Telegram's own ceiling for one file. */
export const DIARY_FILE_SIZE_LIMIT = 2 * 1024 * 1024 * 1024

const MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/
const MIME_TYPE = /^[A-Za-z0-9][\w.+-]*\/[\w.+-]+$/

export function isDiaryMediaId(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_ID.test(value)
}

export function isDiaryMimeType(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && MIME_TYPE.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function optionalText(value: unknown, limit: number): boolean {
  return value === null || (typeof value === 'string' && value.length <= limit)
}

function optionalCount(value: unknown, limit = Number.MAX_SAFE_INTEGER): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit)
}

function isEntity(value: unknown, textLength: number): value is DiaryEntity {
  if (!isRecord(value)) return false
  if (!(DIARY_ENTITY_TYPES as readonly unknown[]).includes(value.type)) return false
  const { offset, length } = value
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) return false
  if (Number(offset) < 0 || Number(length) < 1 || Number(offset) + Number(length) > textLength) return false
  if (value.url !== undefined && !optionalText(value.url, 2000)) return false
  if (value.mediaId !== undefined && value.mediaId !== null && !isDiaryMediaId(value.mediaId)) return false
  return true
}

function isWaveform(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length <= DIARY_WAVEFORM_LIMIT &&
    value.every((bar) => Number.isInteger(bar) && bar >= 0 && bar <= 100))
}

export function isDiaryAttachment(value: unknown): value is DiaryAttachment {
  if (!isRecord(value)) return false
  return (value.mediaId === null || isDiaryMediaId(value.mediaId)) &&
    (DIARY_ATTACHMENT_KINDS as readonly unknown[]).includes(value.kind) &&
    isDiaryMimeType(value.mimeType) &&
    optionalText(value.fileName, 300) &&
    optionalCount(value.size, DIARY_FILE_SIZE_LIMIT) &&
    optionalCount(value.width, 100000) &&
    optionalCount(value.height, 100000) &&
    optionalCount(value.durationSeconds, 1000000) &&
    optionalText(value.title, 300) &&
    optionalText(value.performer, 300) &&
    optionalText(value.emoji, 16) &&
    (value.previewId === null || isDiaryMediaId(value.previewId)) &&
    isWaveform(value.waveform)
}

export function isDiaryMessageInput(value: unknown): value is DiaryMessageInput {
  if (!isRecord(value)) return false
  if (!isTimestamp(value.sentAt)) return false
  if (typeof value.text !== 'string' || value.text.length > DIARY_TEXT_LIMIT) return false
  const textLength = value.text.length
  if (!Array.isArray(value.entities) || value.entities.length > DIARY_ENTITY_LIMIT ||
    !value.entities.every((entity) => isEntity(entity, textLength))) return false
  if (!Array.isArray(value.attachments) || value.attachments.length > DIARY_ATTACHMENT_LIMIT ||
    !value.attachments.every(isDiaryAttachment)) return false
  if (value.text.trim().length === 0 && value.attachments.length === 0) return false
  if (value.replyToId !== null && !(typeof value.replyToId === 'string' && value.replyToId.length > 0 && value.replyToId.length <= 64)) return false
  if (typeof value.forwarded !== 'boolean') return false
  if (!optionalText(value.forwardedFrom, 200)) return false
  if (value.pinnedAt !== null && !isTimestamp(value.pinnedAt)) return false
  if (value.editedAt !== null && !isTimestamp(value.editedAt)) return false
  return value.source === 'app' || value.source === 'telegram'
}

/** Every media ID a message points at, so the server can check each file was uploaded. */
export function diaryMediaIds(input: Pick<DiaryMessageInput, 'attachments' | 'entities'>): string[] {
  const ids = new Set<string>()
  for (const attachment of input.attachments) {
    if (attachment.mediaId) ids.add(attachment.mediaId)
    if (attachment.previewId) ids.add(attachment.previewId)
  }
  for (const entity of input.entities) if (entity.mediaId) ids.add(entity.mediaId)
  return [...ids]
}

export type DiaryLinkKind = 'url' | 'hashtag' | 'mention' | 'email' | 'phone'

export interface DiarySegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  code: boolean
  spoiler: boolean
  quote: boolean
  link: { kind: DiaryLinkKind; value: string } | null
  customEmojiId: string | null
}

const WORD = 'A-Za-z0-9_\\u00C0-\\u024F\\u0400-\\u04FF'
const HASHTAG = new RegExp(`(^|[^${WORD}#])(#[${WORD}]*[A-Za-z_\\u00C0-\\u024F\\u0400-\\u04FF][${WORD}]*)`, 'g')
const URL_PATTERN = /\b(?:https?:\/\/|www\.|t\.me\/|youtu\.be\/)[^\s<>"'«»]+/gi
const TRAILING_PUNCTUATION = /[.,!?:;)\]}'"»]+$/

interface Span {
  start: number
  end: number
  entity: DiaryEntity
}

export function normalizeUrl(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
}

/** Links and hashtags typed as plain text, which only Telegram's own entities marked before. */
export function detectDiaryLinks(text: string): DiaryEntity[] {
  const found: DiaryEntity[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const value = match[0].replace(TRAILING_PUNCTUATION, '')
    if (value.length > 0 && match.index !== undefined) found.push({ type: 'link', offset: match.index, length: value.length })
  }
  for (const match of text.matchAll(HASHTAG)) {
    if (match.index === undefined) continue
    const offset = match.index + match[1].length
    if (found.some((link) => offset >= link.offset && offset < link.offset + link.length)) continue
    found.push({ type: 'hashtag', offset, length: match[2].length })
  }
  return found.sort((left, right) => left.offset - right.offset)
}

const LINKING: readonly DiaryEntityType[] = ['link', 'textLink', 'mention', 'hashtag', 'email', 'phone']

function linkFor(entity: DiaryEntity, text: string): DiarySegment['link'] {
  const covered = text.slice(entity.offset, entity.offset + entity.length)
  switch (entity.type) {
    case 'link': return { kind: 'url', value: normalizeUrl(covered) }
    case 'textLink': return entity.url ? { kind: 'url', value: normalizeUrl(entity.url) } : null
    case 'mention': return { kind: 'mention', value: covered }
    case 'hashtag': return { kind: 'hashtag', value: covered }
    case 'email': return { kind: 'email', value: covered }
    case 'phone': return { kind: 'phone', value: covered }
    default: return null
  }
}

/**
 * Splits text into runs that share one set of styles, so a renderer maps each run to one
 * nested Text. Plain stretches get link and hashtag detection, because messages typed in the app
 * carry no entities of their own.
 */
export function diarySegments(text: string, entities: readonly DiaryEntity[]): DiarySegment[] {
  if (text.length === 0) return []
  const valid = entities.filter((entity) =>
    entity.offset >= 0 && entity.length > 0 && entity.offset + entity.length <= text.length)
  const linked = valid.filter((entity) => LINKING.includes(entity.type))
  const detected = detectDiaryLinks(text).filter((candidate) => !linked.some((entity) =>
    candidate.offset < entity.offset + entity.length && entity.offset < candidate.offset + candidate.length))
  const spans: Span[] = [...valid, ...detected].map((entity) => ({ start: entity.offset, end: entity.offset + entity.length, entity }))
  const cuts = new Set<number>([0, text.length])
  for (const span of spans) {
    cuts.add(span.start)
    cuts.add(span.end)
  }
  const points = [...cuts].sort((left, right) => left - right)
  const segments: DiarySegment[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const active = spans.filter((span) => span.start <= start && span.end >= end).map((span) => span.entity)
    const has = (type: DiaryEntityType): boolean => active.some((entity) => entity.type === type)
    const linkEntity = active.find((entity) => LINKING.includes(entity.type))
    const emoji = active.find((entity) => entity.type === 'customEmoji' && entity.mediaId)
    const segment: DiarySegment = {
      text: text.slice(start, end),
      bold: has('bold'),
      italic: has('italic'),
      underline: has('underline'),
      strikethrough: has('strikethrough'),
      code: has('code') || has('pre'),
      spoiler: has('spoiler'),
      quote: has('blockquote'),
      link: linkEntity ? linkFor(linkEntity, text) : null,
      customEmojiId: emoji?.mediaId ?? null
    }
    const previous = segments[segments.length - 1]
    if (previous && sameStyle(previous, segment) && !segment.customEmojiId) previous.text += segment.text
    else segments.push(segment)
  }
  return segments
}

function sameStyle(left: DiarySegment, right: DiarySegment): boolean {
  return left.bold === right.bold && left.italic === right.italic && left.underline === right.underline &&
    left.strikethrough === right.strikethrough && left.code === right.code && left.spoiler === right.spoiler &&
    left.quote === right.quote && left.customEmojiId === right.customEmojiId &&
    left.link?.kind === right.link?.kind && left.link?.value === right.link?.value
}

/**
 * Moves formatting to follow an edit. Entities before or after the changed stretch keep their
 * place; one that the edit cuts into is dropped, since what it marked is no longer there.
 */
export function rebaseEntities(before: string, after: string, entities: readonly DiaryEntity[]): DiaryEntity[] {
  let prefix = 0
  const shortest = Math.min(before.length, after.length)
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  const changedEnd = before.length - suffix
  const shift = after.length - before.length
  const kept: DiaryEntity[] = []
  for (const entity of entities) {
    const end = entity.offset + entity.length
    if (end <= prefix) kept.push({ ...entity })
    else if (entity.offset >= changedEnd) kept.push({ ...entity, offset: entity.offset + shift })
  }
  return kept
}

/** Lowercased hashtags in the order they appear, each once. */
export function diaryHashtags(text: string, entities: readonly DiaryEntity[] = []): string[] {
  const tags = new Set<string>()
  const marked = entities.filter((entity) => entity.type === 'hashtag')
    .map((entity) => text.slice(entity.offset, entity.offset + entity.length))
  for (const tag of [...marked, ...detectDiaryLinks(text).filter((entity) => entity.type === 'hashtag')
    .map((entity) => text.slice(entity.offset, entity.offset + entity.length))]) {
    tags.add(tag.toLowerCase())
  }
  return [...tags]
}

/** What search looks through: the text, file names, song titles, and a forward's sender. */
export function diarySearchText(message: Pick<DiaryMessageInput, 'text' | 'attachments' | 'forwardedFrom'>): string {
  const parts = [message.text, message.forwardedFrom ?? '']
  for (const attachment of message.attachments) {
    parts.push(attachment.fileName ?? '', attachment.title ?? '', attachment.performer ?? '')
  }
  return parts.join('\n').toLowerCase()
}

/** Every word of the query has to appear, in any order. */
export function matchesDiaryQuery(searchText: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0)
  return terms.length > 0 && terms.every((term) => searchText.includes(term))
}

/** The line a reply quote, a pin bar, or a search result shows for a message. */
export function diaryPreviewText(message: Pick<DiaryMessageInput, 'text' | 'attachments'>): string {
  const text = message.text.replace(/\s+/g, ' ').trim()
  if (text) return text
  const first = message.attachments[0]
  if (!first) return 'Message'
  const count = message.attachments.length
  switch (first.kind) {
    case 'photo': return count > 1 ? `${count} photos` : 'Photo'
    case 'video': return count > 1 ? `${count} videos` : 'Video'
    case 'animation': return 'GIF'
    case 'videoNote': return 'Video message'
    case 'voice': return 'Voice message'
    case 'audio': return [first.performer, first.title].filter(Boolean).join(' - ') || first.fileName || 'Audio'
    case 'sticker': return first.emoji ? `${first.emoji} Sticker` : 'Sticker'
    case 'file': return first.fileName ?? 'File'
  }
}
