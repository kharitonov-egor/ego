import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Archive, ArrowRight, Clock, Copy, Flag, PanelTop, Tag, type LucideIcon } from 'lucide-react'
import { boardLabels } from '@ego/local/tasks/board'
import { useBlur } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { Modal } from '../ui/dialog'
import { LabelPicker, anchorOf, type PickerAnchor } from './LabelPicker'
import { DueSheet, MoveSheet, PrioritySheet } from './sheets'
import { CardFace } from './ui'

export interface QuickEditTarget {
  cardId: string
  rect: { top: number; left: number; width: number }
}

const ACTIONS_WIDTH = 180
const GAP = 8
const MARGIN = 8

/**
 * Trello's quick card editor: the card stays where it was with its title in a text box, and the
 * actions sit beside it over the dimmed board. Enter or a click outside saves the title, Escape
 * drops it.
 */
export function QuickEdit({ target, onOpen, onClose }: {
  target: QuickEditTarget
  onOpen: (cardId: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const tasks = useTasks()
  const { blurred } = useBlur()
  const card = tasks.data?.cards.find((item) => item.id === target.cardId)
  const [title, setTitle] = useState(card?.title ?? '')
  const [sheet, setSheet] = useState<'due' | 'priority' | 'move' | 'copy' | null>(null)
  const [labelsAt, setLabelsAt] = useState<PickerAnchor | null>(null)
  const [top, setTop] = useState(target.rect.top)
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { field.current?.select() }, [])

  useLayoutEffect(() => {
    const height = box.current?.getBoundingClientRect().height ?? 0
    const fitted = Math.max(MARGIN, Math.min(target.rect.top, window.innerHeight - height - MARGIN))
    setTop((current) => current === fitted ? current : fitted)
  })

  const gone = card === undefined
  useEffect(() => { if (gone) onClose() }, [gone, onClose])
  if (!card || !tasks.data) return null

  const update = tasks.updateCard.bind(null, card.id)
  const renamedTo = (): string | null => {
    const next = title.trim()
    return !blurred && next !== '' && next !== card.title ? next : null
  }
  const finish = (): void => {
    const next = renamedTo()
    if (next) void update((input) => ({ ...input, title: next }))
    onClose()
  }
  const archive = (): void => {
    const next = renamedTo()
    void update((input) => ({ ...input, ...(next ? { title: next } : {}), archivedAt: new Date().toISOString() }))
    onClose()
  }
  const closeSheet = (): void => {
    setSheet(null)
    requestAnimationFrame(() => field.current?.focus())
  }

  const actions: Array<{ label: string; Icon: LucideIcon; onPress: (button: HTMLElement) => void }> = [
    { label: 'Open card', Icon: PanelTop, onPress: () => { finish(); onOpen(card.id) } },
    { label: 'Edit labels', Icon: Tag, onPress: (button) => setLabelsAt(anchorOf(button)) },
    { label: 'Edit dates', Icon: Clock, onPress: () => setSheet('due') },
    { label: 'Priority', Icon: Flag, onPress: () => setSheet('priority') },
    { label: 'Move', Icon: ArrowRight, onPress: () => setSheet('move') },
    { label: 'Copy card', Icon: Copy, onPress: () => setSheet('copy') },
    { label: 'Archive', Icon: Archive, onPress: archive }
  ]
  const onRight = target.rect.left + target.rect.width + GAP + ACTIONS_WIDTH <= window.innerWidth - MARGIN

  return <Modal visible onClose={finish} onEscape={onClose} dismissOnBackdrop backdropClassName="bg-black/60" className="contents">
    <div
      ref={box}
      className="fixed flex items-start"
      style={{ top, left: onRight ? target.rect.left : target.rect.left - GAP - ACTIONS_WIDTH, gap: GAP, flexDirection: onRight ? 'row' : 'row-reverse' }}
    >
      <div className="shrink-0" style={{ width: target.rect.width }}>
        <CardFace
          card={card}
          labels={boardLabels(tasks.data, card.boardId)}
          now={tasks.now}
          upload={tasks.data.uploads.get(card.id)}
          onToggleDone={() => void update((input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
          title={blurred ? undefined : <textarea
            ref={field}
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              finish()
            }}
            rows={1}
            maxLength={500}
            aria-label="Card title"
            className="min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-5 text-surface-100 outline-none [field-sizing:content]"
          />}
        />
        {!blurred && <button
          type="button"
          onClick={finish}
          className="mt-2 min-h-10 rounded-lg bg-primary px-5 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 active:opacity-80"
        >Save</button>}
      </div>
      <div className={onRight ? 'flex flex-col items-start gap-1.5' : 'flex flex-col items-end gap-1.5'} style={{ width: ACTIONS_WIDTH }}>
        {actions.map((action) => <button
          key={action.label}
          type="button"
          onClick={(event) => action.onPress(event.currentTarget)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-surface-800 px-3 text-[14px] font-semibold text-surface-100 shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-colors hover:bg-surface-700"
        >
          <action.Icon color={color.textSecondary} size={16} />
          {action.label}
        </button>)}
      </div>
    </div>

    {labelsAt && <LabelPicker cardId={card.id} anchor={labelsAt} onClose={(outside) => {
      setLabelsAt(null)
      if (outside) finish()
      else requestAnimationFrame(() => field.current?.focus())
    }} />}
    <DueSheet visible={sheet === 'due'} card={card} onSave={(value) => void update((input) => ({ ...input, ...value }))} onClose={closeSheet} />
    <PrioritySheet visible={sheet === 'priority'} value={card.priority} onChange={(priority) => void update((input) => ({ ...input, priority }))} onClose={closeSheet} />
    <MoveSheet visible={sheet === 'move'} mode="move" card={card} onDone={finish} onClose={closeSheet} />
    <MoveSheet visible={sheet === 'copy'} mode="copy" card={card} onDone={finish} onClose={closeSheet} />
  </Modal>
}
