import type { ContentItemRecord, ContentCollectionRecord } from '@ego/api-contracts'
import { cleanContentItem, isContentItemInput, isContentCollectionInput, type ContentItemInput } from '@ego/core'
import type { LocalDatabase } from '../database/types'
import { newId, submit } from '../sync/commands'
export async function saveContent(db: LocalDatabase, input: ContentItemInput, current: ContentItemRecord | null, now: string): Promise<void> {
  if (!isContentItemInput(input)) throw new Error('Enter a title and a valid http or https URL. Check the cover URL and field lengths.')
  await submit(db, current?.id ?? newId(), current?.revision ?? null,
    { entity: 'contentItem', type: current ? 'update' : 'create', payload: cleanContentItem(input) }, now)
}
export async function saveCollection(db: LocalDatabase, name: string, current: ContentCollectionRecord | null, now: string): Promise<void> {
  if (!isContentCollectionInput({ name })) throw new Error('Enter a collection name under 100 characters.')
  await submit(db, current?.id ?? newId(), current?.revision ?? null,
    { entity: 'contentCollection', type: current ? 'update' : 'create', payload: { name: name.trim() } }, now)
}
export async function deleteCollection(db: LocalDatabase, current: ContentCollectionRecord, now: string): Promise<void> {
  await submit(db, current.id, current.revision, { entity: 'contentCollection', type: 'delete' }, now)
}
