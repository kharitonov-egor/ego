import type { ContentItemInput, ContentCollectionInput } from '@ego/core'
import { query } from './reads'
export interface ContentRow { id: string; data: string; created_at: string; updated_at: string; revision: number }
const meta = (row: ContentRow) => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision })
export const contentItemRecord = (row: ContentRow) => ({ ...JSON.parse(row.data) as ContentItemInput, ...meta(row) })
export const contentCollectionRecord = (row: ContentRow) => ({ ...JSON.parse(row.data) as ContentCollectionInput, ...meta(row) })
export async function readContent(db: D1Database) {
  const [items, collections] = await Promise.all([
    query<ContentRow>(db, 'SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY created_at DESC'),
    query<ContentRow>(db, 'SELECT * FROM content_collections WHERE deleted_at IS NULL ORDER BY created_at')
  ])
  return { contentItems: items.map(contentItemRecord), contentCollections: collections.map(contentCollectionRecord) }
}
