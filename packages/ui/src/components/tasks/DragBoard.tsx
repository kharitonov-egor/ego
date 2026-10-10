import React, { useLayoutEffect, useRef, useState } from 'react'
import { Ellipsis, GraduationCap, Inbox, Plus, X } from 'lucide-react'
import type { TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import { Blurred } from '../../lib/blur'
import { columnAt, dropIndex, edgeScroll, usePointerDrag } from '../../lib/tasks/drag'
import { color } from '../../lib/tokens'
import { CardFace, DraggingCursor } from './ui'
import { USF_GREEN } from './UsfColumn'

const COLUMN = 300
const GAP = 10
const PAD = 12
const STEP = COLUMN + GAP
const HEADER = 52
const CARD_GAP = 8
const CONTENT_TOP = 2
const INSET = 8
const EDGE = 72
const EDGE_Y = 56
const SCROLL_STEP = 16
const DEFAULT_CARD_HEIGHT = 72

type Pressed =
  | { kind: 'card'; card: TaskCardRecord; listId: string }
  | { kind: 'list'; list: TaskListRecord }

type Drag =
  | { kind: 'card'; card: TaskCardRecord; fromListId: string; fromIndex: number; offsetX: number; offsetY: number; width: number; height: number }
  | { kind: 'list'; list: TaskListRecord; fromIndex: number; offsetX: number; offsetY: number; width: number; height: number }

interface Hover {
  listId: string
  index: number
}

/** What a special list adds around its cards: a header button, controls on top, and items after the cards. */
export interface ListExtras {
  action?: React.ReactNode
  top?: React.ReactNode
  bottom?: React.ReactNode
}

export interface DragBoardProps {
  lists: readonly TaskListRecord[]
  /** The cards each list shows, in order, after the board's filters. */
  cards: ReadonlyMap<string, readonly TaskCardRecord[]>
  labels: readonly TaskLabelRecord[]
  now: Date
  uploads: ReadonlyMap<string, 'sending' | 'failed'>
  onOpenCard: (cardId: string) => void
  /** A right click on a card, with where the card sits on screen. */
  onCardMenu: (cardId: string, rect: DOMRect) => void
  onToggleDone: (cardId: string) => void
  onMoveCard: (cardId: string, listId: string, index: number, siblingIds: string[]) => void
  onMoveList: (listId: string, index: number) => void
  onAddCard: (listId: string, title: string) => Promise<boolean>
  onListMenu: (list: TaskListRecord) => void
  onAddList: (name: string) => Promise<boolean>
  listExtras?: (list: TaskListRecord) => ListExtras | null
}

function Placeholder({ height, width }: { height: number; width?: number }): React.ReactElement {
  return <div className="shrink-0" style={{ height, width, borderRadius: width ? 16 : 12, border: '1.5px dashed #525252', backgroundColor: 'rgba(250,250,250,0.04)' }} />
}

const COMPOSER_INPUT = 'min-h-12 w-full rounded-xl border border-transparent bg-card px-3 text-[16px] text-foreground outline-none focus:border-surface-600'
const COMPOSER_ADD = 'min-h-11 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 active:opacity-80'
const COMPOSER_CLOSE = 'flex h-11 w-11 items-center justify-center rounded-xl hover:bg-surface-800'

/**
 * A board's lists side by side at a fixed width, scrolling sideways, each list scrolling on its own.
 * Trello's drag and drop with the mouse: drag a card anywhere on the board, higher or lower in its
 * list or into another, or drag a list's header to move the list. Resting near a side scrolls the
 * board, and resting near the top or bottom of a list scrolls the list. Dragging the empty board
 * pans it. Drop positions come from the layout measured at the lift, so the drop gap moving under
 * the pointer never changes the answer.
 */
export function DragBoard(props: DragBoardProps): React.ReactElement {
  const { lists, cards, labels, now, uploads } = props
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [addingList, setAddingList] = useState(false)
  const [listDraft, setListDraft] = useState('')

  const latest = useRef(props)
  latest.current = props
  const dragRef = useRef<Drag | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const board = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const scrollers = useRef(new Map<string, HTMLDivElement>())
  const cardViews = useRef(new Map<string, HTMLElement>())
  const heights = useRef(new Map<string, number>())
  const pan = useRef<{ x: number; scrollLeft: number } | null>(null)

  const displayed = (listId: string): readonly TaskCardRecord[] => latest.current.cards.get(listId) ?? []

  const placeGhost = (): void => {
    const current = dragRef.current
    if (!current || !ghost.current) return
    ghost.current.style.transform = `translate(${pointer.current.x - current.offsetX}px, ${pointer.current.y - current.offsetY}px) rotate(3deg)`
  }

  useLayoutEffect(placeGhost, [drag])

  const updateHover = (): void => {
    const current = dragRef.current
    const view = board.current
    const order = latest.current.lists
    if (!current || !view || order.length === 0) return
    const column = columnAt(pointer.current.x - view.getBoundingClientRect().left + view.scrollLeft - PAD, STEP, GAP, order.length)
    let next: Hover
    if (current.kind === 'list') {
      next = { listId: current.list.id, index: column }
    } else {
      const list = order[column]
      const scroller = scrollers.current.get(list.id)
      const offset = scroller ? pointer.current.y - scroller.getBoundingClientRect().top + scroller.scrollTop - CONTENT_TOP : 0
      const shown = displayed(list.id).filter((card) => card.id !== current.card.id)
      next = { listId: list.id, index: dropIndex(offset, shown.map((card) => heights.current.get(card.id) ?? DEFAULT_CARD_HEIGHT), CARD_GAP) }
    }
    const previous = hoverRef.current
    if (previous && previous.listId === next.listId && previous.index === next.index) return
    hoverRef.current = next
    setHover(next)
  }

  const press = usePointerDrag<Pressed>({
    onLift: (item, x, y, element) => {
      for (const [id, view] of cardViews.current) heights.current.set(id, view.getBoundingClientRect().height)
      let next: Drag
      if (item.kind === 'card') {
        const fromIndex = displayed(item.listId).findIndex((card) => card.id === item.card.id)
        if (fromIndex < 0) return
        const rect = element.getBoundingClientRect()
        next = { kind: 'card', card: item.card, fromListId: item.listId, fromIndex, offsetX: x - rect.left, offsetY: y - rect.top, width: rect.width, height: rect.height }
      } else {
        const fromIndex = latest.current.lists.findIndex((list) => list.id === item.list.id)
        if (fromIndex < 0) return
        const rect = (element.closest('[data-column]') ?? element).getBoundingClientRect()
        next = { kind: 'list', list: item.list, fromIndex, offsetX: x - rect.left, offsetY: y - rect.top, width: rect.width, height: rect.height }
      }
      const start: Hover = next.kind === 'card' ? { listId: next.fromListId, index: next.fromIndex } : { listId: next.list.id, index: next.fromIndex }
      dragRef.current = next
      hoverRef.current = start
      pointer.current = { x, y }
      setDrag(next)
      setHover(start)
    },
    onMove: (x, y) => {
      pointer.current = { x, y }
      placeGhost()
      updateHover()
    },
    onFrame: (x, y) => {
      const current = dragRef.current
      const view = board.current
      if (!current || !view) return
      const rect = view.getBoundingClientRect()
      const sideways = edgeScroll(x, rect.left, rect.right, EDGE, SCROLL_STEP)
      let moved = false
      if (sideways !== 0) {
        const before = view.scrollLeft
        view.scrollLeft += sideways
        moved = view.scrollLeft !== before
      }
      const listId = current.kind === 'card' ? hoverRef.current?.listId : undefined
      const scroller = listId ? scrollers.current.get(listId) : undefined
      if (scroller) {
        const box = scroller.getBoundingClientRect()
        const vertical = y >= box.top - HEADER && y <= box.bottom + HEADER ? edgeScroll(y, box.top, box.bottom, EDGE_Y, SCROLL_STEP) : 0
        if (vertical !== 0) {
          const before = scroller.scrollTop
          scroller.scrollTop += vertical
          moved = moved || scroller.scrollTop !== before
        }
      }
      if (moved) updateHover()
    },
    onDrop: (commit) => {
      const current = dragRef.current
      const target = hoverRef.current
      dragRef.current = null
      hoverRef.current = null
      setDrag(null)
      setHover(null)
      if (!commit || !current || !target) return
      if (current.kind === 'list') {
        if (target.index !== current.fromIndex) latest.current.onMoveList(current.list.id, target.index)
        return
      }
      if (target.listId === current.fromListId && target.index === current.fromIndex) return
      const siblings = displayed(target.listId).filter((card) => card.id !== current.card.id).map((card) => card.id)
      latest.current.onMoveCard(current.card.id, target.listId, target.index, siblings)
    },
    onClick: (item) => {
      if (item.kind === 'card') latest.current.onOpenCard(item.card.id)
      else latest.current.onListMenu(item.list)
    }
  })

  const submitCard = async (listId: string): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    if (await props.onAddCard(listId, title)) {
      setTimeout(() => {
        const scroller = scrollers.current.get(listId)
        scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      }, 50)
    }
  }

  const submitList = async (): Promise<void> => {
    const name = listDraft.trim()
    if (!name) return
    setListDraft('')
    if (await props.onAddList(name)) {
      setTimeout(() => board.current?.scrollTo({ left: board.current.scrollWidth, behavior: 'smooth' }), 50)
    }
  }

  const stopAddingCards = (): void => {
    setAdding(null)
    setDraft('')
  }

  const stopAddingList = (): void => {
    setAddingList(false)
    setListDraft('')
  }

  const onScroll = (): void => { if (dragRef.current) updateHover() }

  const order = lists.filter((list) => !(drag?.kind === 'list' && list.id === drag.list.id))
  const columns: Array<TaskListRecord | 'placeholder'> = [...order]
  if (drag?.kind === 'list' && hover) columns.splice(Math.min(hover.index, columns.length), 0, 'placeholder')

  const renderColumn = (list: TaskListRecord): React.ReactElement => {
    const all = cards.get(list.id) ?? []
    const shown = drag?.kind === 'card' ? all.filter((card) => card.id !== drag.card.id) : all
    const items: Array<TaskCardRecord | 'placeholder'> = [...shown]
    if (drag?.kind === 'card' && hover?.listId === list.id) items.splice(Math.min(hover.index, items.length), 0, 'placeholder')
    const extras = props.listExtras?.(list) ?? null
    const usf = list.kind === 'usf'
    return <section key={list.id} data-column aria-label={list.name} className="flex max-h-full shrink-0 flex-col rounded-2xl bg-surface-900" style={{ width: COLUMN }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${list.name}${list.kind === 'inbox' ? ', the Inbox' : usf ? ', with Canvas assignments' : ''}, ${all.length} cards. Drag to move the list.`}
        onPointerDown={(event) => press(event, { kind: 'list', list })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          props.onListMenu(list)
        }}
        style={{ height: HEADER, backgroundColor: usf ? USF_GREEN : undefined }}
        className={usf
          ? 'flex shrink-0 cursor-pointer select-none items-center rounded-t-2xl pl-4 pr-1 transition-[filter] hover:brightness-110'
          : 'flex shrink-0 cursor-pointer select-none items-center rounded-t-2xl pl-4 pr-1 transition-colors hover:bg-surface-800/60'}
      >
        {list.kind === 'inbox' && <Inbox color={color.textSecondary} size={17} className="mr-2 shrink-0" />}
        {usf && <GraduationCap color="#ffffff" size={18} className="mr-2 shrink-0" />}
        <Blurred><span className={usf ? 'min-w-0 flex-1 truncate text-[16px] font-bold text-white' : 'min-w-0 flex-1 truncate text-[16px] font-bold text-surface-100'}>{list.name}</span></Blurred>
        <span className={usf ? 'tabular ml-2 text-[14px] font-semibold text-white/70' : 'tabular ml-2 text-[14px] font-semibold text-surface-500'}>{all.length}</span>
        {extras?.action}
        <span className="flex h-11 w-11 items-center justify-center"><Ellipsis color={usf ? '#ffffff' : color.textMuted} size={20} /></span>
      </div>
      {extras?.top}
      <div
        ref={(view) => {
          if (view) scrollers.current.set(list.id, view)
          else scrollers.current.delete(list.id)
        }}
        onScroll={onScroll}
        className="flex min-h-0 flex-col overflow-y-auto"
        style={{ padding: `${CONTENT_TOP}px ${INSET}px ${CARD_GAP}px`, gap: CARD_GAP }}
      >
        {items.map((item) => item === 'placeholder'
          ? <Placeholder key="placeholder" height={drag?.kind === 'card' ? drag.height : DEFAULT_CARD_HEIGHT} />
          : <div
            key={item.id}
            ref={(view) => {
              if (view) cardViews.current.set(item.id, view)
              else cardViews.current.delete(item.id)
            }}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => press(event, { kind: 'card', card: item, listId: list.id })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              props.onOpenCard(item.id)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              if (!dragRef.current) props.onCardMenu(item.id, event.currentTarget.getBoundingClientRect())
            }}
            className="shrink-0 cursor-pointer select-none rounded-xl transition-[filter] hover:brightness-125"
          >
            <CardFace card={item} labels={labels} now={now} upload={uploads.get(item.id)} onToggleDone={() => props.onToggleDone(item.id)} />
          </div>)}
        {extras?.bottom}
      </div>
      {adding === list.id
        ? <div className="shrink-0 px-2 pb-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitCard(list.id)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                stopAddingCards()
              }
            }}
            placeholder="Card title"
            aria-label="Card title"
            autoFocus
            maxLength={500}
            className={COMPOSER_INPUT}
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => void submitCard(list.id)} className={COMPOSER_ADD}>Add card</button>
            <button type="button" aria-label="Stop adding cards" title="Stop adding cards" onClick={stopAddingCards} className={COMPOSER_CLOSE}>
              <X color={color.textMuted} size={20} />
            </button>
          </div>
        </div>
        : <button
          type="button"
          onClick={() => {
            setAdding(list.id)
            setDraft('')
          }}
          className="flex min-h-12 shrink-0 items-center rounded-b-2xl px-4 transition-colors hover:bg-surface-800 active:bg-surface-800"
        >
          <Plus color={color.textMuted} size={18} />
          <span className="ml-2 text-[15px] font-semibold text-surface-400">Add a card</span>
        </button>}
    </section>
  }

  return <div className="relative min-h-0 flex-1">
    <div
      ref={board}
      onScroll={onScroll}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || event.button !== 0) return
        pan.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (pan.current) event.currentTarget.scrollLeft = pan.current.scrollLeft - (event.clientX - pan.current.x)
      }}
      onPointerUp={() => { pan.current = null }}
      onPointerCancel={() => { pan.current = null }}
      className="flex h-full items-start overflow-x-auto overflow-y-hidden"
      style={{ gap: GAP, padding: `4px ${PAD}px 12px` }}
    >
      {columns.map((column) => column === 'placeholder'
        ? <Placeholder key="list-placeholder" width={COLUMN} height={drag?.kind === 'list' ? drag.height : 260} />
        : renderColumn(column))}
      <div className="shrink-0 rounded-2xl bg-surface-900/60" style={{ width: COLUMN }}>
        {addingList
          ? <div className="p-2">
            <input
              value={listDraft}
              onChange={(event) => setListDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submitList()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  stopAddingList()
                }
              }}
              placeholder="List name"
              aria-label="List name"
              autoFocus
              maxLength={120}
              className={COMPOSER_INPUT}
            />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => void submitList()} className={COMPOSER_ADD}>Add list</button>
              <button type="button" aria-label="Stop adding a list" title="Stop adding a list" onClick={stopAddingList} className={COMPOSER_CLOSE}>
                <X color={color.textMuted} size={20} />
              </button>
            </div>
          </div>
          : <button type="button" onClick={() => setAddingList(true)} className="flex min-h-14 w-full items-center rounded-2xl px-4 transition-colors hover:bg-surface-800 active:bg-surface-800">
            <Plus color={color.textMuted} size={18} />
            <span className="ml-2 text-[15px] font-semibold text-surface-400">Add another list</span>
          </button>}
      </div>
    </div>
    {drag && <>
      <DraggingCursor />
      <div
        ref={ghost}
        className="pointer-events-none fixed left-0 top-0 z-40 opacity-95 shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
        style={{ width: drag.width }}
      >
        {drag.kind === 'card'
          ? <CardFace card={drag.card} labels={labels} now={now} lifted />
          : <div className="rounded-2xl border border-surface-600 bg-surface-800 px-4 pb-3" style={{ minHeight: HEADER }}>
            <div style={{ height: HEADER }} className="flex items-center">
              <Blurred><span className="min-w-0 flex-1 truncate text-[16px] font-bold text-surface-100">{drag.list.name}</span></Blurred>
              <span className="tabular text-[14px] font-semibold text-surface-500">{(cards.get(drag.list.id) ?? []).length}</span>
            </div>
            {(cards.get(drag.list.id) ?? []).slice(0, 3).map((card) => <div key={card.id} className="mb-2 rounded-xl bg-card px-3 py-2.5">
              <Blurred><span className="block truncate text-[15px] text-surface-200">{card.title}</span></Blurred>
            </div>)}
          </div>}
      </div>
    </>}
  </div>
}
