export type ContentKind = 'link' | 'article' | 'video' | 'image' | 'document'
export interface ContentItemInput {
  url: string
  title: string
  description: string
  coverUrl: string | null
  collectionId: string | null
  tags: string[]
  notes: string
  trashedAt: string | null
  favorite: boolean
  kind: ContentKind
}
export interface ContentCollectionInput { name: string }
export interface ContentItem extends ContentItemInput { id: string; createdAt: string; updatedAt: string }
export interface ContentCollection extends ContentCollectionInput { id: string; createdAt: string; updatedAt: string }

export function contentUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch { return null }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit }
export function isContentItemInput(value: unknown): value is ContentItemInput {
  return object(value) && contentUrl(value.url) !== null && text(value.title, 500) && value.title.trim().length > 0 &&
    text(value.description, 4000) && text(value.notes, 20000) &&
    (value.coverUrl === null || contentUrl(value.coverUrl) !== null) &&
    (value.collectionId === null || (text(value.collectionId, 64) && value.collectionId.length > 0)) &&
    Array.isArray(value.tags) && value.tags.length <= 30 && value.tags.every(tag => text(tag, 80) && tag.trim().length > 0) &&
    (value.trashedAt === null || (text(value.trashedAt, 40) && Number.isFinite(Date.parse(value.trashedAt)))) &&
    typeof value.favorite === 'boolean' && ['link', 'article', 'video', 'image', 'document'].includes(String(value.kind))
}
export function isContentCollectionInput(value: unknown): value is ContentCollectionInput {
  return object(value) && text(value.name, 100) && value.name.trim().length > 0
}
export function cleanContentItem(input: ContentItemInput): ContentItemInput {
  return {
    url: contentUrl(input.url) ?? input.url, title: input.title.trim(), description: input.description.trim(),
    coverUrl: input.coverUrl === null ? null : contentUrl(input.coverUrl), collectionId: input.collectionId,
    tags: [...new Set(input.tags.map(tag => tag.trim().toLowerCase()))], notes: input.notes.trim(),
    trashedAt: input.trashedAt, favorite: input.favorite, kind: input.kind
  }
}
export function emptyContentItem(url = ''): ContentItemInput {
  return { url, title: '', description: '', coverUrl: null, collectionId: null, tags: [], notes: '', favorite: false, trashedAt: null, kind: 'link' }
}
export function contentDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
export function filterContent<T extends ContentItem>(items: T[], collections: ContentCollection[], filter: string, search: string, tag = '', kind = ''): T[] {
  const ids = new Set(collections.map(collection => collection.id))
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(item => {
    if (filter === 'trash' ? !item.trashedAt : item.trashedAt) return false
    if (filter === 'favorites' && !item.favorite) return false
    if (filter === 'unsorted' && item.collectionId && ids.has(item.collectionId)) return false
    if (!['all', 'favorites', 'unsorted', 'trash'].includes(filter) && item.collectionId !== filter) return false
    if (tag && !item.tags.includes(tag)) return false
    if (kind && item.kind !== kind) return false
    const haystack = [item.title, item.description, item.url, item.notes, ...item.tags].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}
