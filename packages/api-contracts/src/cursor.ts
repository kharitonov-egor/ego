import { isDateString } from '@ego/core'
import { invalid, type ApiResult } from './errors'
import { transactionQueryIdentity, type TransactionFilters } from './filters'

export const CURSOR_VERSION = 1

/** The final row of the preceding page. */
export interface FeedCursor {
  date: string
  createdAt: string
  id: string
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function toBase64Url(bytes: number[]): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    const size = bytes.length - index
    output += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63]
    output += size > 1 ? ALPHABET[(chunk >> 6) & 63] : ''
    output += size > 2 ? ALPHABET[chunk & 63] : ''
  }
  return output
}

function fromBase64Url(value: string): number[] | null {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of value) {
    const digit = ALPHABET.indexOf(character)
    if (digit < 0) return null
    buffer = (buffer << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return bytes
}

function encodeUtf8(value: string): number[] {
  const bytes: number[] = []
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if (point < 0x80) bytes.push(point)
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f))
    else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
  }
  return bytes
}

function decodeUtf8(bytes: number[]): string | null {
  let output = ''
  let index = 0
  while (index < bytes.length) {
    const lead = bytes[index]
    const extra = lead < 0x80 ? 0 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : -1
    if (extra < 0 || index + extra >= bytes.length) return null
    let point = extra === 0 ? lead : lead & (0x3f >> extra)
    for (let offset = 1; offset <= extra; offset += 1) {
      const next = bytes[index + offset]
      if ((next & 0xc0) !== 0x80) return null
      point = (point << 6) | (next & 0x3f)
    }
    output += String.fromCodePoint(point)
    index += extra + 1
  }
  return output
}

interface CursorPayload {
  v: number
  d: string
  c: string
  i: string
  q: string
}

export function encodeCursor(cursor: FeedCursor, filters: TransactionFilters): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    d: cursor.date,
    c: cursor.createdAt,
    i: cursor.id,
    q: transactionQueryIdentity(filters)
  }
  return toBase64Url(encodeUtf8(JSON.stringify(payload)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function decodeCursor(raw: string, filters: TransactionFilters): ApiResult<FeedCursor> {
  const bytes = fromBase64Url(raw)
  if (!bytes) return invalid('The page cursor is not readable')
  const text = decodeUtf8(bytes)
  if (text === null) return invalid('The page cursor is not readable')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalid('The page cursor is not readable')
  }
  if (!isRecord(parsed)) return invalid('The page cursor is not readable')
  if (parsed.v !== CURSOR_VERSION) return invalid('The page cursor is from an older app version')
  if (typeof parsed.d !== 'string' || !isDateString(parsed.d)) return invalid('The page cursor has an invalid date')
  if (typeof parsed.c !== 'string' || parsed.c.length === 0 || parsed.c.length > 40) return invalid('The page cursor has an invalid creation time')
  if (typeof parsed.i !== 'string' || parsed.i.length === 0 || parsed.i.length > 64) return invalid('The page cursor has an invalid ID')
  if (parsed.q !== transactionQueryIdentity(filters)) return invalid('The page cursor belongs to a different search')
  return { ok: true, data: { date: parsed.d, createdAt: parsed.c, id: parsed.i } }
}
