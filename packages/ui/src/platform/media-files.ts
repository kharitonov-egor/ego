import type { MediaScope } from '@ego/api-contracts'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'application/json': '.json'
}

export function extensionFor(mimeType: string, fileName: string | null): string {
  const known = EXTENSIONS[mimeType]
  if (known) return known
  const dot = fileName?.lastIndexOf('.') ?? -1
  return fileName && dot > 0 ? fileName.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
}

export const isMediaScope = (value: string): value is MediaScope => value === 'diary' || value === 'tasks' || value === 'food'

export const MEDIA_ID = /^[A-Za-z0-9_-]{1,80}$/
