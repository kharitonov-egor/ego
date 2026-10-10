import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import { HOTKEY_ACTIONS, type HotkeyActionId } from '@ego/core'
import { Blurred } from '../../lib/blur'
import { useHotkeys } from '../../lib/hotkeys'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { isTyping } from '../money/PeriodSwipe'
import { KeyCaps } from '../settings/HotkeysSection'
import { hasOpenLayer } from '../ui/dialog'
import { PopupMenu, anchorBelow, type MenuAnchor } from '../ui/menu'
import { listHex } from './ColumnHeader'
import { CardFace } from './ui'

const WIDTH = 320
const CENTER = 1.3
const SIDE = 0.95
const GAP = 28
const FALLBACK_HEIGHT = 90
const REACH = 2
const WHEEL_STEP = 40
const WHEEL_PAUSE_MS = 280

const HINTS: HotkeyActionId[] = ['card.open', 'card.done', 'card.archive', 'card.labels']

export interface FocusViewProps {
  list: TaskListRecord
  lists: readonly TaskListRecord[]
  /** The list's cards after the board's filters, in order. */
  cards: readonly TaskCardRecord[]
  labels: readonly TaskLabelRecord[]
  now: Date
  uploads: ReadonlyMap<string, 'sending' | 'failed'>
  linked?: ReadonlySet<string>
  onPickList: (listId: string) => void
  onExit: () => void
  onOpenCard: (cardId: string) => void
  onCardMenu: (cardId: string, rect: DOMRect) => void
  onToggleDone: (cardId: string) => void
  /** The card in the middle, which the keyboard shortcuts act on. */
  onCurrent: (cardId: string | null, element: HTMLElement | null) => void
}

/**
 * One list's cards one at a time: the current card large in the middle, the one before above it
 * and the one after below, smaller and grayed. The arrow keys, the wheel, or a click on a gray
 * card move through them, and the stack slides. A card marked done hands the middle to the next.
 */
export function FocusView(props: FocusViewProps): React.ReactElement {
  const { list, cards } = props
  const hotkeys = useHotkeys()
  const [currentId, setCurrentId] = useState<string | null>(cards[0]?.id ?? null)
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const [shown, setShown] = useState(false)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const lastIndex = useRef(0)
  const views = useRef(new Map<string, HTMLDivElement>())
  const doneBefore = useRef<{ id: string; done: boolean } | null>(null)
  const wheel = useRef({ total: 0, at: 0 })

  const found = cards.findIndex((card) => card.id === currentId)
  const index = found >= 0 ? found : Math.min(lastIndex.current, cards.length - 1)
  const current = index >= 0 ? cards[index] : null

  const latest = useRef({ props, index, current })
  latest.current = { props, index, current }

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    lastIndex.current = Math.max(0, index)
    if (current && current.id !== currentId) setCurrentId(current.id)
  }, [current, currentId, index])

  useEffect(() => {
    if (!current) {
      doneBefore.current = null
      return
    }
    const done = current.doneAt !== null
    const before = doneBefore.current
    doneBefore.current = { id: current.id, done }
    const next = cards[index + 1]
    if (before?.id === current.id && !before.done && done && next) setCurrentId(next.id)
  }, [cards, current, index])

  const currentKey = current?.id ?? null
  useEffect(() => {
    latest.current.props.onCurrent(currentKey, currentKey ? views.current.get(currentKey) ?? null : null)
  }, [currentKey])

  useEffect(() => () => latest.current.props.onCurrent(null, null), [])

  useLayoutEffect(() => {
    let changed = false
    const next = new Map(heights)
    for (const [id, view] of views.current) {
      if (next.get(id) !== view.offsetHeight) {
        next.set(id, view.offsetHeight)
        changed = true
      }
    }
    if (changed) setHeights(next)
  })

  const go = (step: number): void => {
    const { index: at } = latest.current
    const target = latest.current.props.cards[at + step]
    if (target) setCurrentId(target.id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || hasOpenLayer() || isTyping(event.target) || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        go(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        latest.current.props.onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onWheel = (event: React.WheelEvent): void => {
    const now = Date.now()
    const state = wheel.current
    if (now - state.at < WHEEL_PAUSE_MS) return
    state.total += event.deltaY
    if (Math.abs(state.total) < WHEEL_STEP) return
    go(state.total > 0 ? 1 : -1)
    state.total = 0
    state.at = now
  }

  const heightOf = (at: number): number => heights.get(cards[at]?.id ?? '') ?? FALLBACK_HEIGHT
  const offsets = new Map<number, number>([[index, 0]])
  for (let step = 1; step <= REACH; step += 1) {
    const above = index - step
    const below = index + step
    const nearAbove = offsets.get(above + 1) ?? 0
    const nearBelow = offsets.get(below - 1) ?? 0
    const scaleNearAbove = step === 1 ? CENTER : SIDE
    offsets.set(above, nearAbove - (heightOf(above + 1) * scaleNearAbove / 2 + GAP + heightOf(above) * SIDE / 2))
    offsets.set(below, nearBelow + (heightOf(below - 1) * scaleNearAbove / 2 + GAP + heightOf(below) * SIDE / 2))
  }
  const windowed = cards
    .map((card, at) => ({ card, at }))
    .filter(({ at }) => Math.abs(at - index) <= REACH)

  const hex = listHex(list)

  return <div
    onWheel={onWheel}
    className="relative flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-300"
    style={{ opacity: shown ? 1 : 0 }}
  >
    <div className="relative z-10 flex items-center gap-3 px-5 pt-3">
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(event) => setMenu(anchorBelow(event.currentTarget, 'start'))}
        className="flex min-h-10 items-center gap-2 rounded-xl bg-surface-900 px-3 text-[15px] font-semibold text-surface-100 hover:bg-surface-800"
        style={hex ? { boxShadow: `inset 3px 0 0 ${hex}` } : undefined}
      >
        {list.icon && <span aria-hidden className="text-[16px] leading-none">{list.icon}</span>}
        <Blurred><span className="max-w-[240px] truncate">{list.name}</span></Blurred>
        <ChevronDown color={color.textMuted} size={16} />
      </button>
      {current && <span className="tabular text-[14px] font-semibold text-surface-500">{index + 1} of {cards.length}</span>}
      <button
        type="button"
        onClick={props.onExit}
        className="ml-auto flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold text-surface-300 hover:bg-surface-900"
      ><X size={16} />Back to the board</button>
    </div>
    <div className="relative min-h-0 flex-1">
      {cards.length === 0
        ? <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-[18px] font-semibold text-surface-200">Nothing in {list.name}</p>
          <p className="text-[15px] text-surface-500">Pick another list above, or go back to the board.</p>
        </div>
        : windowed.map(({ card, at }) => {
          const distance = Math.abs(at - index)
          const middle = distance === 0
          const scale = middle ? CENTER : SIDE
          const opacity = middle ? 1 : distance === 1 ? 0.42 : 0
          return <div
            key={card.id}
            ref={(view) => {
              if (view) views.current.set(card.id, view)
              else views.current.delete(card.id)
            }}
            role="button"
            tabIndex={middle ? 0 : -1}
            aria-hidden={distance > 1}
            aria-label={middle ? undefined : `Go to ${card.title}`}
            onClick={() => middle ? props.onOpenCard(card.id) : setCurrentId(card.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              if (middle) props.onCardMenu(card.id, event.currentTarget.getBoundingClientRect())
            }}
            className={cn('absolute left-1/2 top-1/2 cursor-pointer select-none rounded-xl',
              middle ? 'shadow-[0_12px_40px_rgba(0,0,0,0.55)]' : 'hover:!opacity-70')}
            style={{
              width: WIDTH,
              opacity,
              pointerEvents: distance > 1 ? 'none' : undefined,
              filter: middle ? undefined : 'grayscale(1)',
              transform: `translate(-50%, -50%) translateY(${offsets.get(at) ?? 0}px) scale(${scale})`,
              transition: 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease, filter 300ms ease',
              zIndex: middle ? 2 : 1
            }}
          >
            <CardFace
              card={card}
              labels={props.labels}
              now={props.now}
              upload={props.uploads.get(card.id)}
              synced={props.linked?.has(card.id)}
              onToggleDone={middle ? () => props.onToggleDone(card.id) : undefined}
            />
          </div>
        })}
    </div>
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 pb-4 text-[13px] text-surface-500">
      <span className="flex items-center gap-1.5"><KeyCaps combo="ArrowUp" /><KeyCaps combo="ArrowDown" />Move</span>
      {HINTS.map((id) => {
        const combo = hotkeys.keys[id]
        const action = HOTKEY_ACTIONS.find((item) => item.id === id)
        return combo && action ? <span key={id} className="flex items-center gap-1.5"><KeyCaps combo={combo} />{action.label}</span> : null
      })}
      <span className="flex items-center gap-1.5"><KeyCaps combo="Escape" />Leave</span>
    </div>
    <PopupMenu
      anchor={menu}
      title="Focus on"
      items={props.lists.map((item) => ({
        label: `${item.icon ? `${item.icon} ` : ''}${item.name}`,
        swatch: listHex(item) ?? undefined,
        onPress: () => props.onPickList(item.id)
      }))}
      onClose={() => setMenu(null)}
    />
  </div>
}
