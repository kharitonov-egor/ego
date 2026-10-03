import React from 'react'
import { Image as ImageIcon, Keyboard, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { formatCalories } from '@ego/core'
import type { FoodDraft } from '../../lib/food/context'
import { color } from '../../lib/tokens'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { SAVE_DELAY_MS, SaveCountdown } from '../ui/countdown'
import { Spinner } from '../ui/spinner'
import { FoodPhotoView, FoodThumb, FridgeIcon, macroText } from './ui'

const SECONDS = SAVE_DELAY_MS / 1000
const SHOWN_PARTS = 6
const SHOWN_ITEMS = 8

function readingLabel(draft: FoodDraft): string {
  if (draft.photo) return draft.kind === 'meal' ? 'Reading the photo' : 'Finding the food in the photo'
  if (draft.kind === 'meal' && draft.hint) return 'Working out what that was'
  return 'Looking up the barcode'
}

/**
 * What a photo, a barcode, or a description is about to add. The Food context saves it when the
 * bar runs out, even if this card is off screen by then; Undo throws it away, and clicking it holds
 * the timer while the user edits.
 */
export function DraftCard({ draft, editing = false, onUndo, onEdit, onRetry, onLabelPhoto, onTypeName }: {
  draft: FoodDraft
  /** Its editor is open beside the log. */
  editing?: boolean
  onUndo: () => void
  onEdit: () => void
  onRetry: () => void
  onLabelPhoto: () => void
  onTypeName: () => void
}): React.ReactElement {
  if (draft.state === 'reading') {
    return <Card className="mb-3 flex items-center p-4">
      {draft.photo && <FoodPhotoView photo={null} uri={draft.photo.previewUri} className="shrink-0" style={{ width: 52, height: 52, borderRadius: 12 }} />}
      <Spinner className={draft.photo ? 'ml-3.5' : undefined} />
      <p aria-live="polite" className="ml-3 flex-1 text-[15px] text-muted-foreground">{readingLabel(draft)}</p>
      <button
        type="button"
        aria-label="Cancel"
        title="Cancel"
        onClick={onUndo}
        className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-surface-800 active:bg-surface-800"
      ><X color={color.textSecondary} size={20} /></button>
    </Card>
  }

  if (draft.state === 'failed') {
    const retryable = draft.unknownBarcode === null && (draft.photo !== null || (draft.kind === 'meal' && draft.hint !== ''))
    return <Card className="mb-3 p-4">
      <div className="flex items-start">
        <TriangleAlert color={color.attention} size={18} className="mt-0.5 shrink-0" />
        <p className="ml-2.5 flex-1 text-[15px] leading-6">{draft.message}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {retryable && <Button variant="secondary" size="sm" onClick={onRetry}><RotateCcw color={color.text} size={16} />Try again</Button>}
        {draft.unknownBarcode !== null && draft.kind === 'meal' && <Button variant="secondary" size="sm" onClick={onLabelPhoto}>
          <ImageIcon color={color.text} size={16} />Photo of the label
        </Button>}
        {draft.unknownBarcode !== null && draft.kind === 'fridge' && <Button variant="secondary" size="sm" onClick={onTypeName}>
          <Keyboard color={color.text} size={16} />Type the name
        </Button>}
        <Button variant="ghost" size="sm" onClick={onUndo}>Dismiss</Button>
      </div>
    </Card>
  }

  const countdown = <SaveCountdown
    runKey={draft.key}
    paused={draft.paused}
    startedAt={draft.startedAt}
    label={`Saves in ${SECONDS} seconds. Click to edit.`}
    onUndo={onUndo}
  />

  if (draft.kind === 'meal' && draft.entry) {
    const entry = draft.entry
    const parts = entry.parts.length > 1 ? entry.parts : []
    return <Card className={editing ? 'mb-3 overflow-hidden border-surface-500' : 'mb-3 overflow-hidden'}>
      <div className="border-b border-surface-800 px-4 py-3">{countdown}</div>
      <button
        type="button"
        title="Holds the timer and opens the editor"
        onClick={onEdit}
        className="block w-full p-4 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
      >
        <span className="flex">
          {draft.photo
            ? <FoodPhotoView photo={null} uri={draft.photo.previewUri} className="shrink-0" style={{ width: 64, height: 64, borderRadius: 14 }} />
            : <FoodThumb entry={entry} size={64} />}
          <span className="ml-3 min-w-0 flex-1">
            <span className="line-clamp-2 text-[17px] font-semibold">{entry.name}</span>
            {entry.serving !== '' && <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{entry.serving}</span>}
            <span className="tabular mt-1 block text-[15px]">
              <span className="font-semibold">{formatCalories(entry.calories)} kcal</span>
              <span className="whitespace-pre text-muted-foreground">{`  ${macroText(entry)}`}</span>
            </span>
          </span>
        </span>
        {parts.length > 0 && <span className="mt-3 flex flex-col gap-1">
          {parts.slice(0, SHOWN_PARTS).map((part, index) => <span key={`${index}-${part.name}`} className="flex">
            <span className="min-w-0 flex-1 truncate text-[14px] text-surface-300">{part.name}</span>
            <span className="tabular ml-3 text-[14px] text-surface-400">{formatCalories(part.calories)} kcal</span>
          </span>)}
          {parts.length > SHOWN_PARTS && <span className="text-[13px] text-surface-500">and {parts.length - SHOWN_PARTS} more</span>}
        </span>}
        {entry.note !== '' && <span className="mt-2 block text-[13px] leading-5 text-surface-400">{entry.note}</span>}
      </button>
    </Card>
  }

  if (draft.kind === 'fridge') {
    return <Card className="mb-3 overflow-hidden">
      <div className="border-b border-surface-800 px-4 py-3">{countdown}</div>
      <button
        type="button"
        title="Holds the timer so you can drop items"
        onClick={onEdit}
        className="block w-full p-4 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
      >
        <span className="block text-[17px] font-semibold">
          {draft.items.length === 1 ? 'Add 1 item to the fridge' : `Add ${draft.items.length} items to the fridge`}
        </span>
        <span className="mt-2 flex flex-col gap-2">
          {draft.items.slice(0, SHOWN_ITEMS).map((item, index) => <span key={`${index}-${item.name}`} className="flex items-center">
            <FridgeIcon icon={item.icon} size={32} />
            <span className="ml-2.5 min-w-0 flex-1 truncate text-[15px]">
              {item.name}{item.brand ? <span className="whitespace-pre text-muted-foreground">{`  ${item.brand}`}</span> : null}
            </span>
          </span>)}
          {draft.items.length > SHOWN_ITEMS && <span className="text-[13px] text-surface-500">and {draft.items.length - SHOWN_ITEMS} more</span>}
        </span>
      </button>
    </Card>
  }

  return <Card className="mb-3 p-4"><p className="text-[15px] text-muted-foreground">Nothing to save.</p></Card>
}
