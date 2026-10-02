import { afterEach, expect, it } from 'vitest'
import type { LocalDatabase } from '../src/database/types'
import { createDiaryDraftStore, diaryDraftStore } from '../src/diary/draft'
import { openTestLedger } from './local-db'

const databases: LocalDatabase[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})
async function database() {
  const db = await openTestLedger()
  databases.push(db)
  return db
}

it('restores the exact text from disk after leaving the composer', async () => {
  const db = await database()
  const store = diaryDraftStore(db)
  await store.flushed()
  store.setText('  A thought\nfor tomorrow 🙂')
  expect(diaryDraftStore(db).getSnapshot().text).toBe('  A thought\nfor tomorrow 🙂')
  await store.flushed()
  const reopened = createDiaryDraftStore(db)
  await reopened.flushed()
  expect(reopened.getSnapshot()).toEqual({ text: '  A thought\nfor tomorrow 🙂', ready: true, error: false })
})

it('orders rapid changes and removes a cleared draft from disk', async () => {
  const db = await database()
  const store = createDiaryDraftStore(db)
  await store.flushed()
  store.setText('a')
  store.setText('ab')
  store.setText('abc')
  store.setText('')
  await store.flushed()
  expect(await db.all('SELECT * FROM diary_draft')).toEqual([])
})

it('keeps drafts separate for different databases', async () => {
  const first = diaryDraftStore(await database())
  const second = diaryDraftStore(await database())
  await Promise.all([first.flushed(), second.flushed()])
  first.setText('Private thought')
  await first.flushed()
  expect(second.getSnapshot().text).toBe('')
})

it('keeps the text in memory and reports a failed save', async () => {
  const db = await database()
  const store = createDiaryDraftStore({ ...db, transaction: async () => { throw new Error('Disk full') } })
  await store.flushed()
  store.setText('Keep this')
  await store.flushed()
  expect(store.getSnapshot()).toEqual({ text: 'Keep this', ready: true, error: true })
})
