import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { FoodEntryRecord, FridgeItemRecord } from '@ego/api-contracts'
import {
  SAVE_DELAY_MS, foodDays, isFoodGoalInput, isFridgeItemInput,
  type FoodDay, type FoodEntryInput, type FoodGoalInput, type FridgeItemInput
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { deleteLocalFiles } from '../diary/media'
import { localMediaFiles, queueUploads, retryRecordUploads } from '@ego/local/diary/uploads'
import { useLedger, type LocalWrite } from '../ledger-context'
import {
  createFridgeItem, deleteFoodEntry, deleteFridgeItem, newId, saveFoodEntry, saveFoodGoal
} from '@ego/local/sync/commands'
import {
  cleanEntry, entryFromMeal, entryFromProduct, fridgeItemFromProduct, fridgeItemsFrom
} from '@ego/local/food/drafts'
import { discardPhoto, type PhotoPick, type PreparedPhoto } from './photo'
import { failedFoodUploads, localFood, localFoodRevision, type FoodData } from '@ego/local/food/repository'

const PICTURES_KEY = 'ego.food.pictures'
const WRITE_ATTEMPTS = 4
const WRITE_RETRY_MS = 250

export type DraftState = 'reading' | 'ready' | 'failed'

interface DraftBase {
  /** A new key restarts the countdown. */
  key: string
  state: DraftState
  message: string | null
  /** Held while the user edits it, so it cannot save out from under them. */
  paused: boolean
  /** A barcode no database knows, so the card can offer another way in. */
  unknownBarcode: string | null
}

export interface MealDraft extends DraftBase {
  kind: 'meal'
  entry: FoodEntryInput | null
  photo: PreparedPhoto | null
  /** What the user typed with it, kept for Try again. */
  hint: string
}

export interface FridgeDraft extends DraftBase {
  kind: 'fridge'
  items: FridgeItemInput[]
  /** The photo the items were read from. It is only shown on the card, never kept. */
  photo: PreparedPhoto | null
}

export type FoodDraft = MealDraft | FridgeDraft

interface FoodContextValue {
  enabled: boolean
  data: FoodData | null
  days: FoodDay<FoodEntryRecord>[]
  today: string
  /** Photos this phone took and still has, by media ID. */
  localPhotos: ReadonlyMap<string, string>
  /** Entries whose photo the server refused. They stay on this phone until `retryUpload`. */
  failedUploads: ReadonlySet<string>
  retryUpload: (entryId: string) => Promise<boolean>
  picturesOn: boolean
  setPicturesOn: (on: boolean) => void
  /** What the camera, a barcode, or a description is about to add. One at a time. */
  draft: FoodDraft | null
  error: string | null
  dismissError: () => void
  logPhoto: (pick: () => Promise<PhotoPick>, hint?: string) => Promise<void>
  logText: (text: string) => Promise<void>
  logBarcode: (barcode: string, photo: PreparedPhoto | null) => Promise<void>
  stockPhoto: (pick: () => Promise<PhotoPick>) => Promise<void>
  stockBarcode: (barcode: string) => Promise<void>
  stockByName: (name: string) => Promise<boolean>
  saveDraft: () => Promise<void>
  undoDraft: () => void
  retryDraft: () => Promise<void>
  pauseDraft: (paused: boolean) => void
  editDraftEntry: (entry: FoodEntryInput) => void
  editDraftItems: (items: FridgeItemInput[]) => void
  saveEntry: (record: FoodEntryRecord, input: FoodEntryInput) => Promise<boolean>
  removeEntry: (record: FoodEntryRecord) => Promise<boolean>
  removeFridgeItems: (items: readonly FridgeItemRecord[]) => Promise<boolean>
  saveGoal: (goal: FoodGoalInput) => Promise<boolean>
}

const FoodContext = createContext<FoodContextValue | null>(null)

function failed<T extends FoodDraft>(draft: T, message: string, unknownBarcode: string | null = null): T {
  return { ...draft, state: 'failed', message, unknownBarcode }
}

export function FoodProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { api, db, enabled, ready, foodVersion, write } = useLedger()
  const [data, setData] = useState<FoodData | null>(null)
  const [localPhotos, setLocalPhotos] = useState<ReadonlyMap<string, string>>(new Map())
  const [failedUploads, setFailedUploads] = useState<ReadonlySet<string>>(new Set())
  const [today, setToday] = useState(isoToday)
  const [picturesOn, setPictures] = useState(true)
  const [draft, setDraftState] = useState<FoodDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const draftRef = useRef<FoodDraft | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const setDraft = useCallback((next: FoodDraft | null): void => {
    draftRef.current = next
    setDraftState(next)
  }, [])

  useEffect(() => {
    if (!db || !ready) {
      setData(null)
      return
    }
    let active = true
    void Promise.all([localFood(db), localMediaFiles(db, 'food'), failedFoodUploads(db)])
      .then(([next, photos, failed]) => {
        if (!active) return
        setData(next)
        setLocalPhotos(photos)
        setFailedUploads(failed)
      })
      .catch(() => { if (active) setError('This phone could not read its food log') })
    return () => { active = false }
  }, [db, ready, foodVersion])

  useEffect(() => {
    void SecureStore.getItemAsync(PICTURES_KEY).then((value) => setPictures(value !== 'off')).catch(() => undefined)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(isoToday())
    })
    return () => subscription.remove()
  }, [])

  const setPicturesOn = useCallback((on: boolean): void => {
    setPictures(on)
    void SecureStore.setItemAsync(PICTURES_KEY, on ? 'on' : 'off').catch(() => undefined)
  }, [])

  /**
   * The ledger turns away a write while any other app's write runs, so Food's writes wait their
   * turn and try a few more times before giving up.
   */
  const queued = useCallback((work: LocalWrite): Promise<boolean> => {
    const attempt = async (): Promise<boolean> => {
      for (let tries = 1; tries < WRITE_ATTEMPTS; tries += 1) {
        if (await write(work, 'food')) return true
        await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_MS))
      }
      return write(work, 'food')
    }
    const next = queue.current.then(attempt)
    queue.current = next.catch(() => undefined)
    return next
  }, [write])

  const commit = useCallback(async (current: FoodDraft): Promise<void> => {
    if (current.state !== 'ready') return
    const at = new Date()
    if (current.kind === 'meal') {
      const entry = current.entry ? cleanEntry(current.entry) : null
      if (!entry) {
        discardPhoto(current.photo)
        setError('That food needs a name, and its numbers must be zero or more')
        return
      }
      const id = newId()
      const photo = current.photo
      const saved = await queued(async (database, now) => {
        await database.transaction(async (tx) => {
          await saveFoodEntry(tx, id, null, entry, now, photo !== null)
          if (photo) await queueUploads(tx, photo.uploads.map((upload) => ({ ...upload, messageId: id })), now)
        })
      })
      if (!saved) {
        discardPhoto(photo)
        setError('This phone could not save that food')
      }
      return
    }
    discardPhoto(current.photo)
    const items = current.items.filter(isFridgeItemInput)
    if (items.length === 0) return
    const saved = await queued((database, now) => database.transaction(async (tx) => {
      for (const item of items) await createFridgeItem(tx, { ...item, addedAt: at.toISOString() }, now)
    }))
    if (!saved) setError('This phone could not add that to the fridge')
  }, [queued])

  /**
   * A card still counting down was never undone, so starting another one saves it first. The new
   * draft takes its place before that save, so the old card's timer cannot save it a second time.
   */
  const begin = useCallback(async (next: FoodDraft): Promise<void> => {
    const current = draftRef.current
    setError(null)
    setDraft(next)
    if (current?.state === 'ready') await commit(current)
    else if (current && current.photo !== next.photo) discardPhoto(current.photo)
  }, [commit, setDraft])

  /** Applies an answer only to the draft that asked for it, in case the user moved on meanwhile. */
  const settle = useCallback((key: string, update: (current: FoodDraft) => FoodDraft): void => {
    const current = draftRef.current
    if (current?.key === key) setDraft(update(current))
  }, [setDraft])

  const readMeal = useCallback(async (photo: PreparedPhoto | null, text: string): Promise<void> => {
    const key = newId()
    await begin({ kind: 'meal', key, state: 'reading', message: null, paused: false, unknownBarcode: null, entry: null, photo, hint: text })
    const result = await api.foodAnalyze({ mode: 'meal', image: photo?.image ?? null, text })
    settle(key, (current) => {
      if (current.kind !== 'meal') return current
      if (!result.ok) return failed(current, result.error.message)
      if (result.data.mode !== 'meal') return failed(current, 'The server answered with something else. Try again.')
      return {
        ...current, state: 'ready', key: newId(),
        entry: entryFromMeal(result.data.meal, photo ? 'photo' : 'text', photo?.photo ?? null, new Date())
      }
    })
  }, [api, begin, settle])

  const logPhoto = useCallback(async (pick: () => Promise<PhotoPick>, hint = ''): Promise<void> => {
    const picked = await pick()
    if (!picked.ok) {
      if (picked.message) setError(picked.message)
      return
    }
    await readMeal(picked.photo, hint)
  }, [readMeal])

  const logText = useCallback((text: string): Promise<void> => readMeal(null, text), [readMeal])

  const logBarcode = useCallback(async (barcode: string, photo: PreparedPhoto | null): Promise<void> => {
    const key = newId()
    await begin({ kind: 'meal', key, state: 'reading', message: null, paused: false, unknownBarcode: null, entry: null, photo, hint: '' })
    const result = await api.foodProduct(barcode)
    settle(key, (current) => {
      if (current.kind !== 'meal') return current
      if (!result.ok) return failed(current, result.error.message)
      if (!result.data.product) {
        discardPhoto(photo)
        return failed({ ...current, photo: null }, 'No food database knows this barcode. A photo of the label works instead.', barcode)
      }
      return { ...current, state: 'ready', key: newId(), entry: entryFromProduct(result.data.product, photo?.photo ?? null, new Date()) }
    })
  }, [api, begin, settle])

  const readFridge = useCallback(async (photo: PreparedPhoto): Promise<void> => {
    const key = newId()
    await begin({ kind: 'fridge', key, state: 'reading', message: null, paused: false, unknownBarcode: null, items: [], photo })
    const result = await api.foodAnalyze({ mode: 'fridge', image: photo.image, text: '' })
    settle(key, (current) => {
      if (current.kind !== 'fridge') return current
      if (!result.ok) return failed(current, result.error.message)
      if (result.data.mode !== 'fridge') return failed(current, 'The server answered with something else. Try again.')
      return { ...current, state: 'ready', key: newId(), items: fridgeItemsFrom(result.data.items, 'photo', new Date()) }
    })
  }, [api, begin, settle])

  const stockPhoto = useCallback(async (pick: () => Promise<PhotoPick>): Promise<void> => {
    const picked = await pick()
    if (!picked.ok) {
      if (picked.message) setError(picked.message)
      return
    }
    await readFridge(picked.photo)
  }, [readFridge])

  const stockBarcode = useCallback(async (barcode: string): Promise<void> => {
    const key = newId()
    await begin({ kind: 'fridge', key, state: 'reading', message: null, paused: false, unknownBarcode: null, items: [], photo: null })
    const result = await api.foodProduct(barcode)
    settle(key, (current) => {
      if (current.kind !== 'fridge') return current
      if (!result.ok) return failed(current, result.error.message)
      if (!result.data.product) return failed(current, 'No food database knows this barcode. Type the name instead.', barcode)
      return { ...current, state: 'ready', key: newId(), items: [fridgeItemFromProduct(result.data.product, new Date())] }
    })
  }, [api, begin, settle])

  const stockByName = useCallback(async (name: string): Promise<boolean> => {
    const barcode = draftRef.current?.kind === 'fridge' ? draftRef.current.unknownBarcode : null
    const item: FridgeItemInput = {
      name: name.trim(), icon: '', brand: null, barcode, source: barcode ? 'barcode' : 'manual', purchaseId: null,
      addedAt: new Date().toISOString()
    }
    if (!isFridgeItemInput(item)) {
      setError('Give the item a name')
      return false
    }
    if (draftRef.current?.kind === 'fridge' && draftRef.current.state === 'failed') setDraft(null)
    const saved = await queued(async (database, now) => { await createFridgeItem(database, item, now) })
    if (!saved) setError('This phone could not add that to the fridge')
    return saved
  }, [queued, setDraft])

  const saveDraft = useCallback(async (): Promise<void> => {
    const current = draftRef.current
    if (!current || current.state !== 'ready') return
    setDraft(null)
    await commit(current)
  }, [commit, setDraft])

  // The timer lives here rather than on the card, so leaving the screen cannot strand a draft.
  useEffect(() => {
    if (!draft || draft.state !== 'ready' || draft.paused) return
    const key = draft.key
    const timer = setTimeout(() => {
      if (draftRef.current?.key === key) void saveDraft()
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft, saveDraft])

  const undoDraft = useCallback((): void => {
    discardPhoto(draftRef.current?.photo ?? null)
    setDraft(null)
  }, [setDraft])

  /** Reads the same photo or words again after the server or the network failed. */
  const retryDraft = useCallback(async (): Promise<void> => {
    const current = draftRef.current
    if (!current || current.state !== 'failed') return
    if (current.kind === 'meal' && (current.photo || current.hint)) await readMeal(current.photo, current.hint)
    else if (current.kind === 'fridge' && current.photo) await readFridge(current.photo)
  }, [readFridge, readMeal])

  const pauseDraft = useCallback((paused: boolean): void => {
    const current = draftRef.current
    if (current && current.paused !== paused) setDraft({ ...current, paused, key: paused ? current.key : newId() })
  }, [setDraft])

  const editDraftEntry = useCallback((entry: FoodEntryInput): void => {
    const current = draftRef.current
    if (current?.kind === 'meal') setDraft({ ...current, entry })
  }, [setDraft])

  const editDraftItems = useCallback((items: FridgeItemInput[]): void => {
    const current = draftRef.current
    if (current?.kind !== 'fridge') return
    if (items.length === 0) {
      undoDraft()
      return
    }
    setDraft({ ...current, items })
  }, [setDraft, undoDraft])

  const saveEntry = useCallback(async (record: FoodEntryRecord, input: FoodEntryInput): Promise<boolean> => {
    const entry = cleanEntry(input)
    if (!entry) {
      setError('That food needs a name, and its numbers must be zero or more')
      return false
    }
    const saved = await queued(async (database, now) => {
      const revision = await localFoodRevision(database, 'food_entries', record.id)
      if (revision === null) throw new Error('That entry was deleted')
      await saveFoodEntry(database, record.id, revision, entry, now)
    })
    if (!saved) setError('This phone could not save that change')
    return saved
  }, [queued])

  const removeEntry = useCallback(async (record: FoodEntryRecord): Promise<boolean> => {
    let leftovers: string[] = []
    const saved = await queued(async (database, now) => {
      const revision = await localFoodRevision(database, 'food_entries', record.id)
      if (revision !== null) leftovers = await deleteFoodEntry(database, record.id, revision, now)
    })
    deleteLocalFiles(leftovers)
    if (!saved) setError('This phone could not delete that entry')
    return saved
  }, [queued])

  const removeFridgeItems = useCallback(async (items: readonly FridgeItemRecord[]): Promise<boolean> => {
    const saved = await queued((database, now) => database.transaction(async (tx) => {
      for (const item of items) {
        const revision = await localFoodRevision(tx, 'fridge_items', item.id)
        if (revision !== null) await deleteFridgeItem(tx, item.id, revision, now)
      }
    }))
    if (!saved) setError('This phone could not take that out of the fridge')
    return saved
  }, [queued])

  const saveGoal = useCallback(async (goal: FoodGoalInput): Promise<boolean> => {
    if (!isFoodGoalInput(goal)) {
      setError('Targets are numbers above zero, or empty for none')
      return false
    }
    const saved = await queued(async (database, now) => {
      await saveFoodGoal(database, goal, await localFoodRevision(database, 'food_goals', 'daily'), now)
    })
    if (!saved) setError('This phone could not save the targets')
    return saved
  }, [queued])

  const retryUpload = useCallback(async (entryId: string): Promise<boolean> => {
    const saved = await queued((database) => retryRecordUploads(database, 'foodEntry', entryId))
    if (!saved) setError('This phone could not try that photo again')
    return saved
  }, [queued])

  const days = useMemo(() => foodDays(data?.entries ?? []), [data])

  const value = useMemo<FoodContextValue>(() => ({
    enabled, data, days, today, localPhotos, failedUploads, retryUpload, picturesOn, setPicturesOn, draft, error,
    dismissError: () => setError(null),
    logPhoto, logText, logBarcode, stockPhoto, stockBarcode, stockByName, saveDraft, undoDraft, retryDraft, pauseDraft,
    editDraftEntry, editDraftItems, saveEntry, removeEntry, removeFridgeItems, saveGoal
  }), [
    data, days, draft, editDraftEntry, editDraftItems, enabled, error, failedUploads, localPhotos, logBarcode, logPhoto, logText,
    pauseDraft, retryUpload,
    picturesOn, removeEntry, removeFridgeItems, retryDraft, saveDraft, saveEntry, saveGoal, setPicturesOn, stockBarcode,
    stockByName, stockPhoto, today, undoDraft
  ])

  return <FoodContext.Provider value={value}>{children}</FoodContext.Provider>
}

export function useFood(): FoodContextValue {
  const context = useContext(FoodContext)
  if (!context) throw new Error('useFood must be used inside FoodProvider')
  return context
}
