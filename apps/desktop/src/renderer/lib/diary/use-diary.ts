import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rebaseEntities, type DiaryMessageInput } from '@ego/core'
import { diaryInputOf, localDiaryMessages, localDiaryRevision, type LocalDiaryMessage } from '@ego/local/diary/repository'
import { queueUploads, retryMessageUploads, type QueuedUpload } from '@ego/local/diary/uploads'
import { createDiaryMessage, deleteDiaryMessage, newId, updateDiaryMessage } from '@ego/local/sync/commands'
import { useLedger, type LocalWrite } from '../ledger'
import { persistDraft, type DraftFile } from './compose'
import { deleteLocalFiles } from './media'

export interface DiaryDraft {
  text: string
  files: DraftFile[]
  replyToId: string | null
}

export interface Diary {
  enabled: boolean
  /** Oldest first. Null until the local database has been read. */
  messages: LocalDiaryMessage[] | null
  /** Files this window sent, by media ID, so they show at once instead of waiting on the upload record. */
  localFiles: ReadonlyMap<string, string>
  error: string | null
  dismissError: () => void
  send: (draft: DiaryDraft) => Promise<boolean>
  edit: (message: LocalDiaryMessage, text: string) => Promise<boolean>
  remove: (message: LocalDiaryMessage) => Promise<boolean>
  setPinned: (message: LocalDiaryMessage, pinned: boolean) => Promise<boolean>
  retry: (message: LocalDiaryMessage) => Promise<boolean>
}

function replaced(messages: LocalDiaryMessage[] | null, id: string, change: (message: LocalDiaryMessage) => LocalDiaryMessage | null): LocalDiaryMessage[] | null {
  if (!messages) return messages
  const next: LocalDiaryMessage[] = []
  for (const message of messages) {
    const updated = message.id === id ? change(message) : message
    if (updated) next.push(updated)
  }
  return next
}

/**
 * The diary shares the ledger's database and outbox. A sent message is on disk before this
 * resolves; its files upload on the next sync, and the message follows once they are up.
 */
export function useDiary(): Diary {
  const { db, ready, enabled, diaryVersion, write } = useLedger()
  const [messages, setMessages] = useState<LocalDiaryMessage[] | null>(null)
  const [localFiles, setLocalFiles] = useState<ReadonlyMap<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  /** A read that lands while a write is still queued would undo what the screen already shows. */
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!db || !ready) {
      setMessages(null)
      return
    }
    let active = true
    void localDiaryMessages(db)
      .then((rows) => {
        if (!active || pending.current > 0) return
        setMessages(rows)
      })
      .catch(() => { if (active) setError('This computer could not read the diary') })
    return () => { active = false }
  }, [db, ready, diaryVersion, reloads])

  const queued = useCallback(async (work: LocalWrite): Promise<boolean> => {
    pending.current += 1
    const next = queue.current.then(() => write(work, 'diary'))
    queue.current = next.catch(() => undefined)
    const saved = await next.catch(() => false)
    pending.current -= 1
    if (pending.current === 0) setReloads((count) => count + 1)
    return saved
  }, [write])

  const send = useCallback(async (draft: DiaryDraft): Promise<boolean> => {
    const text = draft.text.trim()
    if (!text && draft.files.length === 0) return false
    let persisted: Awaited<ReturnType<typeof persistDraft>>[]
    try {
      persisted = await Promise.all(draft.files.map(persistDraft))
    } catch {
      setError('This computer could not read one of those files')
      return false
    }
    const id = newId()
    const sentAt = new Date().toISOString()
    const input: DiaryMessageInput = {
      sentAt, text, entities: [], attachments: persisted.map((item) => item.attachment), replyToId: draft.replyToId,
      forwarded: false, forwardedFrom: null, pinnedAt: null, editedAt: null, source: 'app'
    }
    const uploads: QueuedUpload[] = persisted.flatMap((item) => item.uploads.map((upload) => ({ ...upload, messageId: id })))
    setLocalFiles((current) => new Map([...current, ...persisted.flatMap((item) => item.shown)]))
    setMessages((current) => current && [...current, {
      ...input, id, createdAt: sentAt, updatedAt: sentAt, revision: 1, delivery: 'sending', searchText: text.toLowerCase()
    }])
    const saved = await queued((database, now) => database.transaction(async (tx) => {
      await createDiaryMessage(tx, input, now, id, uploads.length > 0)
      await queueUploads(tx, uploads, now)
    }))
    if (!saved) {
      deleteLocalFiles(uploads.map((upload) => upload.localUri))
      setError('This computer could not save that message')
    }
    return saved
  }, [queued])

  const update = useCallback(async (message: LocalDiaryMessage, change: (input: DiaryMessageInput, now: string) => DiaryMessageInput, failure: string): Promise<boolean> => {
    const shown = change(diaryInputOf(message), new Date().toISOString())
    setMessages((current) => replaced(current, message.id, (item) => ({ ...item, ...shown })))
    const saved = await queued(async (database, now) => {
      const revision = await localDiaryRevision(database, message.id)
      if (revision === null) throw new Error('That message was deleted')
      await updateDiaryMessage(database, message.id, revision, change(diaryInputOf(message), now), now)
    })
    if (!saved) setError(failure)
    return saved
  }, [queued])

  const edit = useCallback(async (message: LocalDiaryMessage, text: string): Promise<boolean> => {
    if (text === message.text) return true
    if (text.trim().length === 0 && message.attachments.length === 0) {
      setError('A message needs text or a file. Delete it instead.')
      return false
    }
    return update(message, (input, now) => ({
      ...input, text, entities: rebaseEntities(message.text, text, message.entities), editedAt: now
    }), 'This computer could not save that edit')
  }, [update])

  const setPinned = useCallback((message: LocalDiaryMessage, pinned: boolean): Promise<boolean> =>
    update(message, (input, now) => ({ ...input, pinnedAt: pinned ? now : null }),
      pinned ? 'This computer could not pin that message' : 'This computer could not unpin that message'), [update])

  const remove = useCallback(async (message: LocalDiaryMessage): Promise<boolean> => {
    setMessages((current) => replaced(current, message.id, () => null))
    let files: string[] = []
    const saved = await queued(async (database, now) => {
      const revision = await localDiaryRevision(database, message.id)
      if (revision !== null) files = await deleteDiaryMessage(database, message.id, revision, now)
    })
    if (saved) deleteLocalFiles(files)
    else setError('This computer could not delete that message')
    return saved
  }, [queued])

  const retry = useCallback(async (message: LocalDiaryMessage): Promise<boolean> => {
    const saved = await queued((database) => retryMessageUploads(database, message.id))
    if (!saved) setError('This computer could not try that message again')
    return saved
  }, [queued])

  const dismissError = useCallback(() => setError(null), [])
  return useMemo(() => ({
    enabled, messages, localFiles, error, dismissError, send, edit, remove, setPinned, retry
  }), [dismissError, edit, enabled, error, localFiles, messages, remove, retry, send, setPinned])
}
