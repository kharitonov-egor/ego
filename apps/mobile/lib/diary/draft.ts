import type { LocalDatabase } from '../database/types'

export function createDiaryDraftStore(db: LocalDatabase) {
  let snapshot = { text: '', ready: false, error: false }
  const listeners = new Set<() => void>()
  const publish = (next: typeof snapshot): void => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }
  let queue = db.all<{ text: string }>('SELECT text FROM diary_draft WHERE id = 1')
    .then((rows) => publish({ text: rows[0]?.text ?? '', ready: true, error: false }))
    .catch(() => publish({ text: '', ready: false, error: true }))

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setText: (text: string): void => {
      if (!snapshot.ready) return
      publish({ text, ready: true, error: false })
      // Keep writes ordered even if the composer unmounts between keystrokes.
      queue = queue.then(() => db.transaction(async (tx) => {
        if (text.length === 0) await tx.run('DELETE FROM diary_draft WHERE id = 1')
        else await tx.run('INSERT INTO diary_draft (id, text) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text', [text])
      })).catch(() => publish({ ...snapshot, error: true }))
    },
    flushed: () => queue
  }
}

const stores = new WeakMap<LocalDatabase, ReturnType<typeof createDiaryDraftStore>>()

export function diaryDraftStore(db: LocalDatabase) {
  let store = stores.get(db)
  if (!store) {
    store = createDiaryDraftStore(db)
    stores.set(db, store)
  }
  return store
}
