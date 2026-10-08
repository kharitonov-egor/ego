import type { ContentItemRecord, ContentCollectionRecord } from '@ego/api-contracts'
import type { ContentItemInput, ContentCollectionInput } from '@ego/core'
import type { LocalDatabase } from '../database/types'
interface Row { id: string; data: string; created_at: string; updated_at: string; revision: number }
export async function localContent(db: LocalDatabase): Promise<{ items: ContentItemRecord[]; collections: ContentCollectionRecord[] }> {
  const [items, collections] = await Promise.all([
    db.all<Row>('SELECT * FROM content_items WHERE deleted_at IS NULL ORDER BY created_at DESC, id'),
    db.all<Row>("SELECT * FROM content_collections WHERE deleted_at IS NULL ORDER BY json_extract(data, '$.name') COLLATE NOCASE")
  ])
  const meta = (row: Row) => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision })
  return {
    items: items.map(row => ({ ...JSON.parse(row.data) as ContentItemInput, ...meta(row) })),
    collections: collections.map(row => ({ ...JSON.parse(row.data) as ContentCollectionInput, ...meta(row) }))
  }
}
