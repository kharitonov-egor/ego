import React, { memo, useMemo, useRef, useState } from 'react'
import { Animated, FlatList, Pressable, Text, View } from 'react-native'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Plus } from 'lucide-react-native'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import type { SheetColumn, SheetColumnType, SheetSort } from '@ego/core'
import {
  cellState, dateLabel, linkLabel, numberLabel, optionOf, rowName, rowTypeOf, type GridItem
} from '@ego/local/sheets/view'
import { COLUMN_TYPE_ICONS, OptionPill, UNFIT } from './ui'

export const NAME_WIDTH = 168
const ROW_HEIGHT = 48
const HEADER_HEIGHT = 42
const SECTION_HEIGHT = 44
const ADD_WIDTH = 56
const LINE = '#1f1f1f'
const PINNED_LINE = '#3a3a3a'
const SCREEN = '#0a0a0a'
const HEADER = '#141414'

const WIDTHS: Record<SheetColumnType, number> = {
  text: 160, longText: 200, number: 104, date: 116, checkbox: 76, dropdown: 144, tags: 188, phone: 152, email: 200, link: 168
}

export function columnWidth(column: SheetColumn): number {
  return WIDTHS[column.type]
}

export interface GridHandlers {
  openRow: (row: SheetRowRecord) => void
  rowMenu: (row: SheetRowRecord) => void
  editCell: (row: SheetRowRecord, column: SheetColumn) => void
  toggleCell: (row: SheetRowRecord, column: SheetColumn) => void
  columnMenu: (column: SheetColumn) => void
  addColumn: () => void
  toggleSection: (key: string) => void
}

function CellBody({ sheet, column, row, today }: {
  sheet: SheetRecord
  column: SheetColumn
  row: SheetRowRecord
  today: Date
}): React.ReactElement | null {
  const state = cellState(sheet, column, row)
  if (state.kind === 'none') return <Text className="text-center text-[15px] text-surface-700">–</Text>
  if (state.kind === 'empty') {
    if (column.type !== 'checkbox') return null
    return <View className="h-5 w-5 self-center rounded-md border-2 border-surface-600" />
  }
  if (state.kind === 'mismatch') return <Text numberOfLines={1} style={{ color: UNFIT }} className="text-[14px]">{state.text}</Text>
  const value = state.value
  switch (column.type) {
    case 'checkbox':
      return <View className="h-5 w-5 items-center justify-center self-center rounded-md bg-white"><Check color="#0a0a0a" size={14} strokeWidth={3.5} /></View>
    case 'number':
      return <Text numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }} className="text-right text-[14px] text-surface-100">{typeof value === 'number' ? numberLabel(value) : ''}</Text>
    case 'date':
      return <Text numberOfLines={1} className="text-[14px] text-surface-100">{typeof value === 'string' ? dateLabel(value, today) : ''}</Text>
    case 'link':
      return <Text numberOfLines={1} className="text-[14px] text-surface-100 underline">{typeof value === 'string' ? linkLabel(value) : ''}</Text>
    case 'dropdown': {
      const option = typeof value === 'string' ? optionOf(column, value) : null
      return option ? <View className="flex-row"><OptionPill option={option} /></View> : null
    }
    case 'tags': {
      const options = (Array.isArray(value) ? value : []).flatMap((id) => {
        const option = optionOf(column, id)
        return option ? [option] : []
      })
      const shown = options.slice(0, 2)
      return <View className="flex-row items-center gap-1 overflow-hidden">
        {shown.map((option) => <View key={option.id} style={{ maxWidth: options.length > 1 ? 72 : 150 }}><OptionPill option={option} /></View>)}
        {options.length > shown.length && <Text className="text-[12px] font-semibold text-surface-400">+{options.length - shown.length}</Text>}
      </View>
    }
    default:
      return <Text numberOfLines={1} className="text-[14px] text-surface-100">{typeof value === 'string' ? value.split('\n')[0] : ''}</Text>
  }
}

const GridRow = memo(function GridRow({ sheet, columns, row, today, pinned, handlers }: {
  sheet: SheetRecord
  columns: readonly SheetColumn[]
  row: SheetRowRecord
  today: Date
  pinned: Animated.AnimatedInterpolation<number>
  handlers: React.RefObject<GridHandlers>
}): React.ReactElement {
  const name = rowName(sheet, row)
  const type = sheet.view.typeId === null ? rowTypeOf(sheet, row.typeId) : null
  return <View style={{ height: ROW_HEIGHT, flexDirection: 'row', borderBottomWidth: 1, borderColor: LINE }}>
    <View style={{ width: NAME_WIDTH }} />
    {columns.slice(1).map((column) => {
      const applies = cellState(sheet, column, row).kind !== 'none'
      return <Pressable
        key={column.id}
        accessibilityRole="button"
        accessibilityLabel={`${column.name} for ${name || 'untitled row'}`}
        disabled={!applies}
        onPress={() => column.type === 'checkbox'
          ? handlers.current?.toggleCell(row, column)
          : handlers.current?.editCell(row, column)}
        style={{ width: columnWidth(column), borderRightWidth: 1, borderColor: LINE }}
        className="justify-center px-2.5 active:bg-surface-900"
      ><CellBody sheet={sheet} column={column} row={row} today={today} /></Pressable>
    })}
    <View style={{ width: ADD_WIDTH }} />
    <Animated.View style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: NAME_WIDTH, backgroundColor: SCREEN,
      borderRightWidth: 1, borderColor: PINNED_LINE, transform: [{ translateX: pinned }]
    }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name || 'untitled row'}`}
        accessibilityHint="Hold for more"
        onPress={() => handlers.current?.openRow(row)}
        onLongPress={() => handlers.current?.rowMenu(row)}
        className="flex-1 justify-center px-3 active:bg-surface-900"
      >
        <Text numberOfLines={1} className={`text-[15px] font-semibold ${name ? 'text-white' : 'text-surface-600'}`}>{name || 'Untitled'}</Text>
        {type && <Text numberOfLines={1} className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{type.name}</Text>}
      </Pressable>
    </Animated.View>
  </View>
})

function HeaderCell({ column, sort, sortCount, onPress, width }: {
  column: SheetColumn
  sort: { index: number; sort: SheetSort } | null
  sortCount: number
  onPress: () => void
  width: number
}): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[column.type]
  const Arrow = sort?.sort.direction === 'desc' ? ArrowDown : ArrowUp
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${column.name} column`}
    accessibilityHint="Opens the column menu"
    onPress={onPress}
    style={{ width, height: HEADER_HEIGHT, borderRightWidth: 1, borderColor: LINE }}
    className="flex-row items-center px-2.5 active:bg-surface-800"
  >
    <Icon color="#737373" size={14} />
    <Text numberOfLines={1} className="ml-1.5 flex-1 text-[13px] font-semibold text-surface-200">{column.name}</Text>
    {sort && <View className="ml-1 flex-row items-center">
      <Arrow color="#fafafa" size={13} />
      {sortCount > 1 && <Text className="text-[10px] font-bold text-white">{sort.index + 1}</Text>}
    </View>}
  </Pressable>
}

/**
 * The grid scrolls sideways as one piece inside a horizontal scroll view, and the name column is
 * pushed back by exactly the distance scrolled, so it stays put while every other column moves.
 */
export function Grid({ sheet, columns, items, today, empty, bottomInset, handlers }: {
  sheet: SheetRecord
  columns: readonly SheetColumn[]
  items: readonly GridItem<SheetRowRecord>[]
  today: Date
  empty: React.ReactNode
  bottomInset: number
  handlers: GridHandlers
}): React.ReactElement {
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const scrollX = useRef(new Animated.Value(0)).current
  const pinned = useMemo(() => scrollX.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }), [scrollX])
  const latest = useRef<GridHandlers>(handlers)
  latest.current = handlers
  const rest = columns.slice(1)
  const width = Math.max(NAME_WIDTH + rest.reduce((total, column) => total + columnWidth(column), 0) + ADD_WIDTH, viewport.width)
  const sorts = sheet.view.sorts
  const sortOf = (column: SheetColumn): { index: number; sort: SheetSort } | null => {
    const index = sorts.findIndex((sort) => sort.columnId === column.id)
    return index < 0 ? null : { index, sort: sorts[index] }
  }

  const header = <View style={{ height: HEADER_HEIGHT, flexDirection: 'row', backgroundColor: HEADER, borderBottomWidth: 1, borderColor: PINNED_LINE }}>
    <View style={{ width: NAME_WIDTH }} />
    {rest.map((column) => <HeaderCell
      key={column.id}
      column={column}
      sort={sortOf(column)}
      sortCount={sorts.length}
      width={columnWidth(column)}
      onPress={() => latest.current.columnMenu(column)}
    />)}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a column"
      onPress={() => latest.current.addColumn()}
      style={{ width: ADD_WIDTH, height: HEADER_HEIGHT }}
      className="items-center justify-center active:bg-surface-800"
    ><Plus color="#d4d4d4" size={20} /></Pressable>
    <Animated.View style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: NAME_WIDTH, backgroundColor: HEADER,
      borderRightWidth: 1, borderColor: PINNED_LINE, transform: [{ translateX: pinned }]
    }}>
      <HeaderCell column={columns[0]} sort={sortOf(columns[0])} sortCount={sorts.length} width={NAME_WIDTH} onPress={() => latest.current.columnMenu(columns[0])} />
    </Animated.View>
  </View>

  const renderItem = ({ item }: { item: GridItem<SheetRowRecord> }): React.ReactElement => {
    if (item.kind === 'row') {
      return <GridRow sheet={sheet} columns={columns} row={item.row} today={today} pinned={pinned} handlers={latest} />
    }
    const Chevron = item.collapsed ? ChevronRight : ChevronDown
    return <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !item.collapsed }}
      accessibilityLabel={`${item.title}, ${item.count} ${item.count === 1 ? 'row' : 'rows'}`}
      onPress={() => latest.current.toggleSection(item.key)}
      style={{ height: SECTION_HEIGHT, width, backgroundColor: '#101010', borderBottomWidth: 1, borderColor: LINE, justifyContent: 'center' }}
    >
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, transform: [{ translateX: pinned }] }}>
        <Chevron color="#a3a3a3" size={18} />
        <View className="ml-2 flex-row">
          {item.option ? <OptionPill option={item.option} /> : <Text className="text-[14px] font-semibold text-surface-300">{item.title}</Text>}
        </View>
        <Text className="ml-2 text-[13px] font-semibold text-surface-500">{item.count}</Text>
      </Animated.View>
    </Pressable>
  }

  return <View style={{ flex: 1 }} onLayout={(event) => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
    <Animated.ScrollView
      horizontal
      bounces={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
      style={{ flex: 1 }}
    >
      {viewport.height > 0 && <FlatList
        style={{ width, height: viewport.height }}
        data={items}
        keyExtractor={(item) => item.kind === 'section' ? `section:${item.key}` : item.row.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        stickyHeaderIndices={[0]}
        ListEmptyComponent={<Animated.View style={{ transform: [{ translateX: pinned }] }}>{empty}</Animated.View>}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        initialNumToRender={24}
        windowSize={11}
        keyboardShouldPersistTaps="handled"
      />}
    </Animated.ScrollView>
  </View>
}
