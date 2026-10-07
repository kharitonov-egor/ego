import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Plus } from 'lucide-react'
import type { FridgeItemRecord } from '@ego/api-contracts'
import { addedLabel } from '@ego/local/food/drafts'
import { newId } from '@ego/local/sync/commands'
import { DraftCard } from '../../components/food/DraftCard'
import { PhotoDropZone } from '../../components/food/PhotoDrop'
import { AddSheet, BarcodeSheet, FridgeDraftSheet, type AddChoice } from '../../components/food/sheets'
import { FoodError, FoodGate, FoodHeader, FridgeIcon } from '../../components/food/ui'
import { Screen } from '../../components/screen'
import { TextSheet } from '../../components/tasks/sheets'
import { IconButton } from '../../components/ui/button'
import { SaveCountdown } from '../../components/ui/countdown'
import { Blurred } from '../../lib/blur'
import { useFood } from '../../lib/food/context'
import { chooseFoodPhoto, photoFromFile } from '../../lib/food/photo'
import { color } from '../../lib/tokens'

const SOURCE_LABELS: Record<FridgeItemRecord['source'], string | null> = {
  receipt: 'from a receipt', barcode: 'scanned', photo: 'from a photo', assistant: 'from the AI', manual: null
}

const ItemRow = memo(function ItemRow({ item, today, onUsedUp }: {
  item: FridgeItemRecord
  today: string
  onUsedUp: (item: FridgeItemRecord) => void
}): React.ReactElement {
  const source = SOURCE_LABELS[item.source]
  return <div className="mb-2 flex min-h-16 items-center rounded-2xl border border-border bg-card py-2 pl-3 pr-1">
    <FridgeIcon icon={item.icon} />
    <div className="ml-3 min-w-0 flex-1">
      <Blurred><p className="truncate text-[16px] font-semibold">{item.name}</p></Blurred>
      <p className="truncate text-[13px] text-muted-foreground">
        {[item.brand, addedLabel(item.addedAt, today), source].filter(Boolean).join(' · ')}
      </p>
    </div>
    <button
      type="button"
      aria-label={`${item.name} is used up`}
      title="Used up. Takes it out of the fridge"
      onClick={() => onUsedUp(item)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-800 active:bg-surface-800"
    ><CircleCheck color={color.textMuted} size={22} /></button>
  </div>
})

interface Leaving {
  key: string
  items: FridgeItemRecord[]
}

export default function Fridge(): React.ReactElement {
  const food = useFood()
  const [adding, setAdding] = useState(false)
  const [naming, setNaming] = useState(false)
  const [scanning, setScanning] = useState(false)

  const pick = (choice: AddChoice): void => {
    setAdding(false)
    if (choice === 'library') void food.stockPhoto(chooseFoodPhoto)
    else if (choice === 'barcode') setScanning(true)
    else setNaming(true)
  }

  return <Screen>
    <FoodHeader right={food.data && <IconButton label="Add to the fridge" onClick={() => setAdding(true)} className="h-10 w-10 text-foreground">
      <Plus size={23} />
    </IconButton>} />
    <FoodGate><FridgeList onTypeName={() => setNaming(true)} /></FoodGate>
    <AddSheet visible={adding} mode="fridge" onPick={pick} onClose={() => setAdding(false)} />
    <BarcodeSheet visible={scanning} mode="fridge" onClose={() => setScanning(false)} onLookUp={(barcode) => {
      setScanning(false)
      void food.stockBarcode(barcode)
    }} />
    <TextSheet
      visible={naming}
      title="Add to the fridge"
      value=""
      placeholder="Greek yogurt"
      confirm="Add"
      onClose={() => setNaming(false)}
      onSave={(name) => {
        setNaming(false)
        void food.stockByName(name)
      }}
    />
  </Screen>
}

function FridgeList({ onTypeName }: { onTypeName: () => void }): React.ReactElement {
  const food = useFood()
  const [editing, setEditing] = useState(false)
  const [leaving, setLeavingState] = useState<Leaving | null>(null)
  const leavingRef = useRef<Leaving | null>(null)
  const { removeFridgeItems, pauseDraft } = food
  const draft = food.draft?.kind === 'fridge' ? food.draft : null

  // A draft emptied or saved elsewhere must not reopen the sheet when the next one arrives.
  useEffect(() => {
    if (!draft) setEditing(false)
  }, [draft])

  // The sheet holds the timer, so leaving the list any way, like a notification click, lets it run again.
  useEffect(() => {
    if (!editing) return
    return () => pauseDraft(false)
  }, [editing, pauseDraft])

  const setLeaving = useCallback((next: Leaving | null): void => {
    leavingRef.current = next
    setLeavingState(next)
  }, [])

  const remove = useRef(removeFridgeItems)
  remove.current = removeFridgeItems
  // Items taken out and not put back before the screen closes are gone, like any card that runs out.
  useEffect(() => () => {
    const pending = leavingRef.current
    if (pending) void remove.current(pending.items)
  }, [])

  // Ctrl+Z puts them back while the bar runs, as Undo does.
  useEffect(() => {
    if (!leaving) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      event.preventDefault()
      setLeaving(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leaving, setLeaving])

  const usedUp = useCallback((item: FridgeItemRecord): void => {
    const current = leavingRef.current
    setLeaving({ key: newId(), items: [...(current?.items ?? []), item] })
  }, [setLeaving])

  const hidden = new Set(leaving?.items.map((item) => item.id) ?? [])
  const items = (food.data?.fridge ?? []).filter((item) => !hidden.has(item.id))

  return <PhotoDropZone label="Drop a photo of groceries" onPhoto={(file) => void food.stockPhoto(() => photoFromFile(file))} className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 pt-5" style={{ paddingBottom: leaving ? 140 : 40 }}>
        <FoodError />
        {draft && <DraftCard
          draft={draft}
          onUndo={food.undoDraft}
          onEdit={() => {
            food.pauseDraft(true)
            setEditing(true)
          }}
          onRetry={() => void food.retryDraft()}
          onLabelPhoto={() => undefined}
          onTypeName={onTypeName}
        />}
        {items.length > 0 && <p className="mb-2 px-1 text-[13px] text-surface-500">
          {items.length === 1 ? '1 item' : `${items.length} items`}, newest first
        </p>}
        {items.map((item) => <ItemRow key={item.id} item={item} today={food.today} onUsedUp={usedUp} />)}
        {items.length === 0 && !draft && <div className="flex flex-col items-center px-8 py-12 text-center">
          <p className="text-[18px] font-semibold text-surface-100">The fridge is empty</p>
          <p className="mt-2 max-w-md text-[15px] leading-6 text-surface-400">
            Type a barcode, paste or drop a photo of your groceries, or type a name. Grocery receipts you send to the AI tile land here too.
          </p>
        </div>}
      </div>
    </div>
    {leaving && <div className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto max-w-2xl px-6">
      <div className="pointer-events-auto rounded-3xl border border-surface-700 bg-surface-900 px-4 py-3 shadow-2xl">
        <p className="mb-1 truncate text-[15px] font-semibold">
          {leaving.items.length === 1 ? `Took out ${leaving.items[0].name}` : `Took out ${leaving.items.length} items`}
        </p>
        <SaveCountdown
          runKey={leaving.key}
          paused={false}
          label="Off the list in 3 seconds"
          onElapsed={() => {
            const done = leavingRef.current
            setLeaving(null)
            if (done) void removeFridgeItems(done.items)
          }}
          onUndo={() => setLeaving(null)}
        />
      </div>
    </div>}
    <FridgeDraftSheet
      visible={editing && draft !== null}
      items={draft?.items ?? []}
      onChange={food.editDraftItems}
      onSave={() => {
        setEditing(false)
        void food.saveDraft()
      }}
      onClose={() => setEditing(false)}
    />
  </PhotoDropZone>
}
