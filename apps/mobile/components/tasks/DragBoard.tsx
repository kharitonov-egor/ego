import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated, PanResponder, Pressable, ScrollView, Text, TextInput, Vibration, View, useWindowDimensions,
  type GestureResponderEvent, type LayoutChangeEvent
} from 'react-native'
import { Ellipsis, GraduationCap, Inbox, Plus, X } from 'lucide-react-native'
import type { TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import { Blurred } from '../../lib/blur'
import { color } from '../money/tokens'
import { CardFace } from './ui'
import { USF_GREEN } from './UsfColumn'

const PAD = 12
const GAP = 10
const HEADER = 52
const CARD_GAP = 8
const CONTENT_TOP = 2
const INSET = 8
const EDGE = 44
const EDGE_Y = 64
const PAGE_DELAY_MS = 550
const SCROLL_STEP = 14
const DEFAULT_CARD_HEIGHT = 72

type Drag =
  | { kind: 'card'; card: TaskCardRecord; fromListId: string; fromIndex: number; offsetX: number; offsetY: number }
  | { kind: 'list'; list: TaskListRecord; fromIndex: number; offsetX: number; offsetY: number }

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
  onToggleDone: (cardId: string) => void
  onMoveCard: (cardId: string, listId: string, index: number, siblingIds: string[]) => void
  onMoveList: (listId: string, index: number) => void
  onAddCard: (listId: string, title: string) => Promise<boolean>
  onListMenu: (list: TaskListRecord) => void
  onAddList: (name: string) => Promise<boolean>
  listExtras?: (list: TaskListRecord) => ListExtras | null
}

function Placeholder({ height, width }: { height: number; width?: number }): React.ReactElement {
  return <View style={{ height, width, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#525252', backgroundColor: 'rgba(250,250,250,0.04)' }} />
}

/**
 * A board's lists side by side, one screen wide each, with Trello's drag and drop: hold a card to
 * lift it and drop it anywhere on the board, or hold a list's header to move the list. The board
 * turns a page when the finger rests at a side, and a list scrolls when it rests at the top or
 * bottom. Everything is measured from the layout itself, so a drag never waits on the native side.
 */
export function DragBoard(props: DragBoardProps): React.ReactElement {
  const { lists, cards, labels, now, uploads } = props
  const { width: screenWidth } = useWindowDimensions()
  const columnWidth = Math.min(Math.round(screenWidth * 0.84), 360)
  const step = columnWidth + GAP
  const cardWidth = columnWidth - INSET * 2

  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [boardHeight, setBoardHeight] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [addingList, setAddingList] = useState(false)
  const [listDraft, setListDraft] = useState('')

  const latest = useRef(props)
  latest.current = props
  const dragRef = useRef<Drag | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const rootActive = useRef(false)
  const root = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const rootView = useRef<View>(null)
  const listTop = useRef(0)
  /** How far a list's controls push its cards below the header. */
  const extraTops = useRef(new Map<string, number>())
  const scrollX = useRef(0)
  const horizontal = useRef<ScrollView>(null)
  const verticals = useRef(new Map<string, ScrollView>())
  const columnViews = useRef(new Map<string, View>())
  const scrollY = useRef(new Map<string, number>())
  const viewportHeight = useRef(new Map<string, number>())
  const contentHeight = useRef(new Map<string, number>())
  const heights = useRef(new Map<string, number>())
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const ghost = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  const cardsTop = useCallback((listId: string): number => listTop.current + (extraTops.current.get(listId) ?? 0), [])

  const measureRoot = useCallback((): void => {
    rootView.current?.measureInWindow((x, y, width, height) => { root.current = { x, y, width, height } })
  }, [])

  const displayed = useCallback((listId: string): readonly TaskCardRecord[] => latest.current.cards.get(listId) ?? [], [])

  const cardTop = useCallback((listId: string, index: number, skip: string | null): number => {
    let y = CONTENT_TOP
    const shown = displayed(listId).filter((card) => card.id !== skip)
    for (let position = 0; position < index && position < shown.length; position += 1) {
      y += (heights.current.get(shown[position].id) ?? DEFAULT_CARD_HEIGHT) + CARD_GAP
    }
    return y
  }, [displayed])

  const columnAt = useCallback((pageX: number): number => {
    const contentX = pageX - root.current.x + scrollX.current - PAD
    const count = latest.current.lists.length
    return Math.max(0, Math.min(count - 1, Math.floor((contentX + GAP / 2) / step)))
  }, [step])

  const updateHover = useCallback((): void => {
    const current = dragRef.current
    const { lists: order } = latest.current
    if (!current || order.length === 0) return
    const { x, y } = pointer.current
    let next: Hover
    if (current.kind === 'list') {
      next = { listId: current.list.id, index: columnAt(x) }
    } else {
      const list = order[columnAt(x)]
      const contentY = y - cardsTop(list.id) + (scrollY.current.get(list.id) ?? 0)
      const shown = displayed(list.id).filter((card) => card.id !== current.card.id)
      let top = CONTENT_TOP
      let index = shown.length
      for (let position = 0; position < shown.length; position += 1) {
        const height = heights.current.get(shown[position].id) ?? DEFAULT_CARD_HEIGHT
        if (contentY < top + height / 2) {
          index = position
          break
        }
        top += height + CARD_GAP
      }
      next = { listId: list.id, index }
    }
    const previous = hoverRef.current
    if (previous && previous.listId === next.listId && previous.index === next.index) return
    hoverRef.current = next
    setHover(next)
  }, [columnAt, displayed])

  const stopTimers = useCallback((): void => {
    if (pageTimer.current) clearTimeout(pageTimer.current)
    if (scrollTimer.current) clearInterval(scrollTimer.current)
    pageTimer.current = null
    scrollTimer.current = null
  }, [])

  const turnPage = useCallback((direction: -1 | 1): void => {
    const maxPage = Math.max(0, latest.current.lists.length - 1)
    const page = Math.max(0, Math.min(maxPage, Math.round(scrollX.current / step) + direction))
    horizontal.current?.scrollTo({ x: page * step, animated: true })
  }, [step])

  const autoScroll = useCallback((): void => {
    const current = dragRef.current
    if (!current) return
    const { x, y } = pointer.current
    const side = x < root.current.x + EDGE ? -1 : x > root.current.x + root.current.width - EDGE ? 1 : 0
    if (side === 0 && pageTimer.current) {
      clearTimeout(pageTimer.current)
      pageTimer.current = null
    }
    if (side !== 0 && !pageTimer.current) {
      const repeat = (): void => {
        turnPage(side)
        pageTimer.current = setTimeout(repeat, PAGE_DELAY_MS)
      }
      pageTimer.current = setTimeout(repeat, PAGE_DELAY_MS)
    }
    if (current.kind !== 'card') return
    const listId = hoverRef.current?.listId
    const viewport = listId ? viewportHeight.current.get(listId) ?? 0 : 0
    const vertical = !listId || viewport === 0 ? 0
      : y > cardsTop(listId) + viewport - EDGE_Y ? 1 : y < cardsTop(listId) + EDGE_Y ? -1 : 0
    if (vertical === 0 && scrollTimer.current) {
      clearInterval(scrollTimer.current)
      scrollTimer.current = null
    }
    if (vertical !== 0 && !scrollTimer.current && listId) {
      scrollTimer.current = setInterval(() => {
        const target = hoverRef.current?.listId
        if (!target) return
        const view = verticals.current.get(target)
        const limit = Math.max(0, (contentHeight.current.get(target) ?? 0) - (viewportHeight.current.get(target) ?? 0))
        const from = scrollY.current.get(target) ?? 0
        const to = Math.max(0, Math.min(limit, from + vertical * SCROLL_STEP))
        if (to === from || !view) return
        scrollY.current.set(target, to)
        view.scrollTo({ y: to, animated: false })
        updateHover()
      }, 16)
    }
  }, [turnPage, updateHover])

  const finish = useCallback((): void => {
    stopTimers()
    const current = dragRef.current
    const target = hoverRef.current
    dragRef.current = null
    hoverRef.current = null
    rootActive.current = false
    setDrag(null)
    setHover(null)
    if (!current || !target) return
    if (current.kind === 'list') {
      if (target.index !== current.fromIndex) latest.current.onMoveList(current.list.id, target.index)
      return
    }
    if (target.listId === current.fromListId && target.index === current.fromIndex) return
    const siblings = displayed(target.listId).filter((card) => card.id !== current.card.id).map((card) => card.id)
    latest.current.onMoveCard(current.card.id, target.listId, target.index, siblings)
  }, [displayed, stopTimers])

  const move = useCallback((x: number, y: number): void => {
    const current = dragRef.current
    if (!current) return
    pointer.current = { x, y }
    ghost.setValue({ x: x - root.current.x - current.offsetX, y: y - root.current.y - current.offsetY })
    updateHover()
    autoScroll()
  }, [autoScroll, ghost, updateHover])

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => dragRef.current !== null,
    onPanResponderGrant: () => { rootActive.current = true },
    onPanResponderMove: (_event, gesture) => move(gesture.moveX, gesture.moveY),
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true
  }), [finish, move])

  useEffect(() => stopTimers, [stopTimers])

  const lift = (next: Drag, pageX: number, pageY: number, left: number, top: number): void => {
    Vibration.vibrate(12)
    const lifted = { ...next, offsetX: pageX - left, offsetY: pageY - top }
    dragRef.current = lifted
    pointer.current = { x: pageX, y: pageY }
    ghost.setValue({ x: left - root.current.x, y: top - root.current.y })
    const start: Hover = next.kind === 'card' ? { listId: next.fromListId, index: next.fromIndex } : { listId: next.list.id, index: next.fromIndex }
    hoverRef.current = start
    setHover(start)
    setDrag(lifted)
  }

  const columnLeft = (index: number): number => root.current.x + PAD + index * step - scrollX.current

  const liftCard = (card: TaskCardRecord, listId: string, event: GestureResponderEvent): void => {
    const listIndex = latest.current.lists.findIndex((list) => list.id === listId)
    const fromIndex = displayed(listId).findIndex((item) => item.id === card.id)
    if (listIndex < 0 || fromIndex < 0) return
    const left = columnLeft(listIndex) + INSET
    const top = cardsTop(listId) + cardTop(listId, fromIndex, null) - (scrollY.current.get(listId) ?? 0)
    lift({ kind: 'card', card, fromListId: listId, fromIndex, offsetX: 0, offsetY: 0 }, event.nativeEvent.pageX, event.nativeEvent.pageY, left, top)
  }

  const liftList = (list: TaskListRecord, event: GestureResponderEvent): void => {
    const fromIndex = latest.current.lists.findIndex((item) => item.id === list.id)
    if (fromIndex < 0) return
    lift({ kind: 'list', list, fromIndex, offsetX: 0, offsetY: 0 }, event.nativeEvent.pageX, event.nativeEvent.pageY,
      columnLeft(fromIndex), listTop.current - HEADER)
  }

  /** A long press that ends without moving never hands the touch to the board, so it ends here. */
  const releasedInPlace = (): void => {
    if (dragRef.current && !rootActive.current) finish()
  }

  const submitCard = async (listId: string): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    if (await props.onAddCard(listId, title)) setTimeout(() => verticals.current.get(listId)?.scrollToEnd({ animated: true }), 50)
  }

  const submitList = async (): Promise<void> => {
    const name = listDraft.trim()
    if (!name) return
    setListDraft('')
    if (await props.onAddList(name)) setTimeout(() => horizontal.current?.scrollToEnd({ animated: true }), 50)
  }

  const columnHeight = Math.max(0, boardHeight - 12)
  const dragging = drag !== null
  const order = lists.filter((list) => !(drag?.kind === 'list' && list.id === drag.list.id))
  const columns: Array<TaskListRecord | 'placeholder'> = [...order]
  if (drag?.kind === 'list' && hover) columns.splice(Math.min(hover.index, columns.length), 0, 'placeholder')

  const renderColumn = (list: TaskListRecord): React.ReactElement => {
    const all = cards.get(list.id) ?? []
    const shown = drag?.kind === 'card' ? all.filter((card) => card.id !== drag.card.id) : all
    const items: Array<TaskCardRecord | 'placeholder'> = [...shown]
    if (drag?.kind === 'card' && hover?.listId === list.id) {
      items.splice(Math.min(hover.index, items.length), 0, 'placeholder')
    }
    const placeholderHeight = drag?.kind === 'card' ? heights.current.get(drag.card.id) ?? DEFAULT_CARD_HEIGHT : 0
    const extras = props.listExtras?.(list) ?? null
    if (extras?.top === undefined) extraTops.current.delete(list.id)
    const usf = list.kind === 'usf'
    return <View
      key={list.id}
      ref={(view) => {
        if (view) columnViews.current.set(list.id, view)
        else columnViews.current.delete(list.id)
      }}
      style={{ width: columnWidth, maxHeight: columnHeight }}
      className="rounded-2xl bg-surface-900"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${list.name}${list.kind === 'inbox' ? ', the Inbox' : usf ? ', with Canvas assignments' : ''}, ${all.length} cards. Hold to move the list.`}
        onPress={() => props.onListMenu(list)}
        onLongPress={(event) => liftList(list, event)}
        onPressOut={releasedInPlace}
        delayLongPress={300}
        style={{ height: HEADER, backgroundColor: usf ? USF_GREEN : undefined }}
        className="flex-row items-center rounded-t-2xl pl-4 pr-1"
      >
        {list.kind === 'inbox' && <Inbox color={color.textSecondary} size={17} style={{ marginRight: 8 }} />}
        {usf && <GraduationCap color="#ffffff" size={18} style={{ marginRight: 8 }} />}
        <Blurred tint="#fafafa"><Text numberOfLines={1} className={`flex-1 text-[16px] font-bold ${usf ? 'text-white' : 'text-surface-100'}`}>{list.name}</Text></Blurred>
        <Text className={`ml-2 text-[14px] font-semibold ${usf ? 'text-white/70' : 'text-surface-500'}`}>{all.length}</Text>
        {extras?.action}
        <View className="h-11 w-11 items-center justify-center"><Ellipsis color={usf ? '#ffffff' : color.textMuted} size={20} /></View>
      </Pressable>
      {extras?.top !== undefined && <View onLayout={(event) => extraTops.current.set(list.id, event.nativeEvent.layout.height)}>
        {extras.top}
      </View>}
      <ScrollView
        ref={(view) => {
          if (view) verticals.current.set(list.id, view)
          else verticals.current.delete(list.id)
        }}
        style={{ flexGrow: 0 }}
        scrollEnabled={!dragging}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current.set(list.id, event.nativeEvent.contentOffset.y)
          if (dragRef.current) updateHover()
        }}
        onLayout={(event: LayoutChangeEvent) => {
          viewportHeight.current.set(list.id, event.nativeEvent.layout.height)
          columnViews.current.get(list.id)?.measureInWindow((_x, y) => { if (y > 0) listTop.current = y + HEADER })
        }}
        onContentSizeChange={(_width, height) => contentHeight.current.set(list.id, height)}
        contentContainerStyle={{ paddingHorizontal: INSET, paddingTop: CONTENT_TOP, paddingBottom: CARD_GAP, gap: CARD_GAP }}
      >
        {items.map((item) => item === 'placeholder'
          ? <Placeholder key="placeholder" height={placeholderHeight} />
          : <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityHint="Opens the card. Hold to move it."
            onLayout={(event) => heights.current.set(item.id, event.nativeEvent.layout.height)}
            onPress={() => { if (!dragRef.current) props.onOpenCard(item.id) }}
            onLongPress={(event) => liftCard(item, list.id, event)}
            onPressOut={releasedInPlace}
            delayLongPress={300}
          >
            <CardFace card={item} labels={labels} now={now} upload={uploads.get(item.id)} onToggleDone={() => props.onToggleDone(item.id)} />
          </Pressable>)}
        {extras?.bottom}
      </ScrollView>
      {adding === list.id
        ? <View className="px-2 pb-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Card title"
            placeholderTextColor="#737373"
            autoFocus
            blurOnSubmit={false}
            onSubmitEditing={() => void submitCard(list.id)}
            returnKeyType="done"
            className="min-h-12 rounded-xl bg-card px-3 text-[16px] text-foreground"
          />
          <View className="mt-2 flex-row items-center gap-2">
            <Pressable accessibilityRole="button" onPress={() => void submitCard(list.id)} className="min-h-11 flex-1 items-center justify-center rounded-xl bg-primary active:opacity-80">
              <Text className="text-[15px] font-semibold text-primary-foreground">Add card</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop adding cards" onPress={() => { setAdding(null); setDraft('') }} className="h-11 w-11 items-center justify-center rounded-xl active:bg-surface-800">
              <X color={color.textMuted} size={20} />
            </Pressable>
          </View>
        </View>
        : <Pressable
          accessibilityRole="button"
          onPress={() => { setAdding(list.id); setDraft('') }}
          className="min-h-12 flex-row items-center rounded-b-2xl px-4 active:bg-surface-800"
        >
          <Plus color={color.textMuted} size={18} />
          <Text className="ml-2 text-[15px] font-semibold text-surface-400">Add a card</Text>
        </Pressable>}
    </View>
  }

  return <View
    ref={rootView}
    style={{ flex: 1 }}
    onLayout={(event) => {
      setBoardHeight(event.nativeEvent.layout.height)
      measureRoot()
    }}
    {...responder.panHandlers}
  >
    <ScrollView
      ref={horizontal}
      horizontal
      scrollEnabled={!dragging}
      showsHorizontalScrollIndicator={false}
      snapToInterval={step}
      decelerationRate="fast"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrollX.current = event.nativeEvent.contentOffset.x
        if (dragRef.current) updateHover()
      }}
      onMomentumScrollEnd={measureRoot}
      contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: 4, gap: GAP, alignItems: 'flex-start' }}
    >
      {columns.map((column) => column === 'placeholder'
        ? <Placeholder key="list-placeholder" width={columnWidth} height={Math.min(columnHeight, 260)} />
        : renderColumn(column))}
      <View style={{ width: columnWidth }} className="rounded-2xl bg-surface-900/60">
        {addingList
          ? <View className="p-2">
            <TextInput
              value={listDraft}
              onChangeText={setListDraft}
              placeholder="List name"
              placeholderTextColor="#737373"
              autoFocus
              onSubmitEditing={() => void submitList()}
              returnKeyType="done"
              className="min-h-12 rounded-xl bg-card px-3 text-[16px] text-foreground"
            />
            <View className="mt-2 flex-row items-center gap-2">
              <Pressable accessibilityRole="button" onPress={() => void submitList()} className="min-h-11 flex-1 items-center justify-center rounded-xl bg-primary active:opacity-80">
                <Text className="text-[15px] font-semibold text-primary-foreground">Add list</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Stop adding a list" onPress={() => { setAddingList(false); setListDraft('') }} className="h-11 w-11 items-center justify-center rounded-xl active:bg-surface-800">
                <X color={color.textMuted} size={20} />
              </Pressable>
            </View>
          </View>
          : <Pressable accessibilityRole="button" onPress={() => setAddingList(true)} className="min-h-14 flex-row items-center rounded-2xl px-4 active:bg-surface-800">
            <Plus color={color.textMuted} size={18} />
            <Text className="ml-2 text-[15px] font-semibold text-surface-400">Add another list</Text>
          </Pressable>}
      </View>
    </ScrollView>
    {drag && <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: drag.kind === 'card' ? cardWidth : columnWidth,
        transform: [...ghost.getTranslateTransform(), { rotate: '3deg' }],
        opacity: 0.95,
        elevation: 12,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 }
      }}
    >
      {drag.kind === 'card'
        ? <CardFace card={drag.card} labels={labels} now={now} lifted />
        : <View className="rounded-2xl border border-surface-600 bg-surface-800 px-4 pb-3" style={{ minHeight: HEADER }}>
          <View style={{ height: HEADER }} className="flex-row items-center">
            <Text numberOfLines={1} className="flex-1 text-[16px] font-bold text-surface-100">{drag.list.name}</Text>
            <Text className="text-[14px] font-semibold text-surface-500">{(cards.get(drag.list.id) ?? []).length}</Text>
          </View>
          {(cards.get(drag.list.id) ?? []).slice(0, 3).map((card) => <View key={card.id} className="mb-2 rounded-xl bg-card px-3 py-2.5">
            <Text numberOfLines={1} className="text-[15px] text-surface-200">{card.title}</Text>
          </View>)}
        </View>}
    </Animated.View>}
  </View>
}
