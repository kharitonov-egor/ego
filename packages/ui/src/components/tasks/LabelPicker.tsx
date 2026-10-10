import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { boardLabels } from '@ego/local/tasks/board'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { Modal } from '../ui/dialog'
import { LabelEditor, LabelRow } from './sheets'
import { LABEL_COLOR_NAMES } from './ui'

/** The screen box the picker opens beside, like a card or the button that opened it. */
export interface PickerAnchor {
  top: number
  left: number
  right: number
}

export function anchorOf(element: Element): PickerAnchor {
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, right: rect.right }
}

export function toggledLabel(labelIds: readonly string[], labelId: string): string[] {
  return labelIds.includes(labelId) ? labelIds.filter((id) => id !== labelId) : [...labelIds, labelId]
}

const WIDTH = 288
const GAP = 8
const MARGIN = 8

/**
 * Trello's label popover: the board's labels in short rows beside the card, a search field on
 * top, and the label editor in place of the list. A click outside closes it with `outside` set,
 * so a quick editor under it can close too. Escape backs out of the editor first.
 */
export function LabelPicker({ cardId, anchor, onClose }: {
  cardId: string
  anchor: PickerAnchor
  onClose: (outside: boolean) => void
}): React.ReactElement | null {
  const tasks = useTasks()
  const card = tasks.data?.cards.find((item) => item.id === cardId)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [top, setTop] = useState(anchor.top)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const height = box.current?.getBoundingClientRect().height ?? 0
    const fitted = Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - height - MARGIN))
    setTop((current) => current === fitted ? current : fitted)
  })

  const gone = card === undefined
  useEffect(() => { if (gone) onClose(false) }, [gone, onClose])
  useEffect(() => { if (editing === null) search.current?.focus() }, [editing])
  if (!card || !tasks.data) return null

  const labels = boardLabels(tasks.data, card.boardId)
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? labels : labels.filter((label) => (label.name || LABEL_COLOR_NAMES[label.color]).toLowerCase().includes(needle))
  const toggle = (labelId: string): void => {
    void tasks.updateCard(card.id, (input) => ({ ...input, labelIds: toggledLabel(input.labelIds, labelId) }))
  }
  const fitsRight = anchor.right + GAP + WIDTH <= window.innerWidth - MARGIN
  const left = fitsRight ? anchor.right + GAP : Math.max(MARGIN, anchor.left - GAP - WIDTH)

  return <Modal
    visible
    onClose={() => onClose(true)}
    onEscape={() => editing === null ? onClose(false) : setEditing(null)}
    dismissOnBackdrop
    backdropClassName="bg-transparent"
    className="contents"
  >
    <div
      ref={box}
      className="fixed flex max-h-[calc(100vh-16px)] flex-col rounded-xl border border-surface-800 bg-popover p-2 shadow-[0_8px_30px_rgba(0,0,0,0.65)]"
      style={{ top, left, width: WIDTH }}
    >
      <div className="flex items-center pb-1 pl-1.5">
        <span className="flex-1 text-[14px] font-semibold text-surface-200">
          {editing === null ? 'Labels' : editing === 'new' ? 'New label' : 'Edit label'}
        </span>
        <button
          type="button"
          aria-label="Close labels"
          onClick={() => onClose(false)}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-800"
        ><X color={color.textMuted} size={15} /></button>
      </div>
      {editing !== null
        ? <LabelEditor compact boardId={card.boardId} labelId={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        : <>
          <input
            ref={search}
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || shown.length === 0) return
              event.preventDefault()
              toggle(shown[0].id)
            }}
            placeholder="Search labels"
            aria-label="Search labels"
            className="min-h-8 w-full rounded-lg border border-input bg-surface-900 px-2.5 text-[13px] text-foreground outline-none focus:border-surface-500"
          />
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
            {shown.map((label) => <LabelRow
              key={label.id}
              label={label}
              checked={card.labelIds.includes(label.id)}
              onPress={() => toggle(label.id)}
              onEdit={() => setEditing(label.id)}
            />)}
            {shown.length === 0 && <p className="px-1.5 py-2 text-[13px] text-surface-500">
              {labels.length === 0 ? 'This board has no labels yet.' : 'No label matches.'}
            </p>}
          </div>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="mt-1 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-surface-800 text-[13px] font-semibold text-surface-100 hover:bg-surface-700"
          ><Plus color="#fafafa" size={14} />Create a label</button>
        </>}
    </div>
  </Modal>
}
