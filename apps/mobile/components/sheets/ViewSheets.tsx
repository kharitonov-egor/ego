import React, { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { CalendarDays, Check, Eye, Plus, X } from 'lucide-react-native'
import type { SheetRecord } from '@ego/api-contracts'
import {
  SHEET_FILTER_LIMIT, SHEET_FILTER_TEXT_LIMIT, SHEET_SORT_LIMIT, parseSheetNumber,
  type SheetColumn, type SheetFilter, type SheetFilterOperator, type SheetSort
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { useSheets } from '../../lib/sheets/context'
import { OPERATOR_LABELS, dateLabel, operatorTakesValue, operatorsFor, sortLabels } from '@ego/local/sheets/view'
import { newId } from '@ego/local/sync/commands'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { COLUMN_TYPE_ICONS, OptionPill } from './ui'

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="radio"
    accessibilityState={{ checked: selected }}
    onPress={onPress}
    className={`min-h-10 justify-center rounded-lg border px-3 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    <Text className={`text-[14px] font-semibold ${selected ? 'text-primary-foreground' : 'text-surface-200'}`}>{label}</Text>
  </Pressable>
}

function ColumnRow({ column, onPress, right }: { column: SheetColumn; onPress: () => void; right?: React.ReactNode }): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[column.type]
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900"
  >
    <Icon color="#a3a3a3" size={18} />
    <Text numberOfLines={1} className="ml-3 flex-1 text-[17px] text-foreground">{column.name}</Text>
    {right}
  </Pressable>
}

function ColumnPicker({ columns, onPick, onCancel }: {
  columns: readonly SheetColumn[]
  onPick: (column: SheetColumn) => void
  onCancel: () => void
}): React.ReactElement {
  return <View className="mt-2 rounded-2xl border border-surface-800 px-4 pb-2 pt-3">
    <View className="mb-1 flex-row items-center">
      <Text className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Choose a column</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={8}><X color="#a3a3a3" size={18} /></Pressable>
    </View>
    {columns.map((column) => <ColumnRow key={column.id} column={column} onPress={() => onPick(column)} />)}
    {columns.length === 0 && <Text className="py-3 text-[15px] text-surface-500">No columns left to add.</Text>}
  </View>
}

/** Keeps a draft while open and saves it once on close, so a typed filter is one sync, not one per letter. */
function useViewDraft<T>(visible: boolean, saved: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(saved)
  useEffect(() => { if (visible) setDraft(saved) }, [visible])
  return [draft, setDraft]
}

export function SortSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [sorts, setSorts] = useViewDraft<SheetSort[]>(visible, sheet.view.sorts)
  const [picking, setPicking] = useState(false)
  const close = (): void => {
    setPicking(false)
    onClose()
    if (JSON.stringify(sorts) !== JSON.stringify(sheet.view.sorts)) {
      void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, sorts } }))
    }
  }
  const unused = sheet.columns.filter((column) => !sorts.some((sort) => sort.columnId === column.id))
  return <BottomSheet visible={visible} title="Sort" onClose={close}>
    {sorts.length === 0 && <Text className="mb-2 text-[15px] leading-6 text-surface-400">Unsorted rows show newest first.</Text>}
    {sorts.map((sort, index) => {
      const column = sheet.columns.find((item) => item.id === sort.columnId)
      if (!column) return null
      const labels = sortLabels(column.type)
      return <View key={sort.columnId} className="mb-3 rounded-2xl border border-surface-800 p-3">
        <View className="flex-row items-center">
          <Text className="text-[13px] font-semibold uppercase tracking-wide text-surface-500">{index === 0 ? 'Sort by' : 'Then by'}</Text>
          <Text numberOfLines={1} className="ml-2 flex-1 text-[16px] font-semibold text-foreground">{column.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Stop sorting by ${column.name}`} onPress={() => setSorts(sorts.filter((_, at) => at !== index))} hitSlop={8}>
            <X color="#a3a3a3" size={18} />
          </Pressable>
        </View>
        <View className="mt-3 flex-row gap-2">
          {(['asc', 'desc'] as const).map((direction) => <Choice
            key={direction}
            label={labels[direction]}
            selected={sort.direction === direction}
            onPress={() => setSorts(sorts.map((item, at) => at === index ? { ...item, direction } : item))}
          />)}
        </View>
      </View>
    })}
    {picking
      ? <ColumnPicker columns={unused} onCancel={() => setPicking(false)} onPick={(column) => {
        setSorts([...sorts, { columnId: column.id, direction: 'asc' }])
        setPicking(false)
      }} />
      : sorts.length < SHEET_SORT_LIMIT && <Button variant="outline" className="mt-1" onPress={() => setPicking(true)}>
        <Plus color="#fafafa" size={18} /><UiText>{sorts.length === 0 ? 'Add a sort' : 'Then by another column'}</UiText>
      </Button>}
    <Button size="lg" className="mt-5" onPress={close}><UiText>Done</UiText></Button>
  </BottomSheet>
}

function FilterValue({ column, filter, onChange }: {
  column: SheetColumn
  filter: SheetFilter
  onChange: (value: SheetFilter['value']) => void
}): React.ReactElement | null {
  const [picking, setPicking] = useState(false)
  const [number, setNumber] = useState(typeof filter.value === 'number' ? String(filter.value) : '')
  if (!operatorTakesValue(filter.operator)) return null
  if (column.type === 'dropdown' || column.type === 'tags') {
    const chosen = Array.isArray(filter.value) ? filter.value : []
    return <View className="mt-3 flex-row flex-wrap gap-2">
      {column.options.map((option) => {
        const on = chosen.includes(option.id)
        return <Pressable
          key={option.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={option.name}
          onPress={() => onChange(on ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
          className={`flex-row items-center rounded-full border-2 p-0.5 ${on ? 'border-white' : 'border-transparent'}`}
        >
          <OptionPill option={option} large />
        </Pressable>
      })}
      {column.options.length === 0 && <Text className="text-[15px] text-surface-500">This column has no options yet.</Text>}
    </View>
  }
  if (column.type === 'date') {
    const iso = typeof filter.value === 'string' ? filter.value : null
    return <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        className="mt-3 min-h-12 flex-row items-center rounded-xl border border-input bg-surface-900 px-4 active:bg-surface-800"
      >
        <CalendarDays color="#a3a3a3" size={18} />
        <Text className={`ml-3 text-[16px] ${iso ? 'text-foreground' : 'text-surface-500'}`}>{iso ? dateLabel(iso, new Date()) : 'Pick a date'}</Text>
      </Pressable>
      <CalendarDialog visible={picking} value={iso ?? isoToday()} onCancel={() => setPicking(false)} onConfirm={(next) => {
        setPicking(false)
        onChange(next)
      }} />
    </>
  }
  if (column.type === 'number') {
    return <TextInput
      value={number}
      onChangeText={(text) => {
        setNumber(text)
        onChange(parseSheetNumber(text))
      }}
      keyboardType="decimal-pad"
      placeholder="A number"
      placeholderTextColor="#737373"
      accessibilityLabel="Number to compare"
      className={`${inputClass} mt-3`}
    />
  }
  return <TextInput
    value={typeof filter.value === 'string' ? filter.value : ''}
    onChangeText={onChange}
    placeholder="Text"
    placeholderTextColor="#737373"
    accessibilityLabel="Text to compare"
    autoCapitalize="none"
    maxLength={SHEET_FILTER_TEXT_LIMIT}
    className={`${inputClass} mt-3`}
  />
}

export function FilterSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [filters, setFilters] = useViewDraft<SheetFilter[]>(visible, sheet.view.filters)
  const [picking, setPicking] = useState(false)
  const close = (): void => {
    setPicking(false)
    onClose()
    if (JSON.stringify(filters) !== JSON.stringify(sheet.view.filters)) {
      void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, filters } }))
    }
  }
  const change = (id: string, patch: Partial<SheetFilter>): void => setFilters(filters.map((filter) => filter.id === id ? { ...filter, ...patch } : filter))
  return <BottomSheet visible={visible} title="Filter" onClose={close}>
    {filters.length === 0 && <Text className="mb-2 text-[15px] leading-6 text-surface-400">Show only the rows that match every filter.</Text>}
    {filters.map((filter) => {
      const column = sheet.columns.find((item) => item.id === filter.columnId)
      if (!column) return null
      return <View key={filter.id} className="mb-3 rounded-2xl border border-surface-800 p-3">
        <View className="flex-row items-center">
          <Text numberOfLines={1} className="flex-1 text-[16px] font-semibold text-foreground">{column.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove the ${column.name} filter`} onPress={() => setFilters(filters.filter((item) => item.id !== filter.id))} hitSlop={8}>
            <X color="#a3a3a3" size={18} />
          </Pressable>
        </View>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {operatorsFor(column.type).map((operator: SheetFilterOperator) => <Choice
            key={operator}
            label={OPERATOR_LABELS[operator]}
            selected={filter.operator === operator}
            onPress={() => change(filter.id, {
              operator,
              value: operatorTakesValue(operator) === operatorTakesValue(filter.operator) ? filter.value : null
            })}
          />)}
        </View>
        <FilterValue key={filter.operator} column={column} filter={filter} onChange={(value) => change(filter.id, { value })} />
      </View>
    })}
    {picking
      ? <ColumnPicker columns={sheet.columns} onCancel={() => setPicking(false)} onPick={(column) => {
        setFilters([...filters, { id: newId(), columnId: column.id, operator: operatorsFor(column.type)[0], value: null }])
        setPicking(false)
      }} />
      : filters.length < SHEET_FILTER_LIMIT && <Button variant="outline" className="mt-1" onPress={() => setPicking(true)}>
        <Plus color="#fafafa" size={18} /><UiText>Add a filter</UiText>
      </Button>}
    {filters.length > 0 && <Button variant="ghost" className="mt-2" onPress={() => setFilters([])}><UiText>Clear all filters</UiText></Button>}
    <Button size="lg" className="mt-5" onPress={close}><UiText>Done</UiText></Button>
  </BottomSheet>
}

export function GroupSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const dropdowns = sheet.columns.filter((column) => column.type === 'dropdown')
  const pick = (groupBy: string | null): void => {
    onClose()
    if (groupBy !== sheet.view.groupBy) void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, groupBy } }))
  }
  const tick = <Check color="#fafafa" size={20} strokeWidth={2.5} />
  return <BottomSheet visible={visible} title="Group by" onClose={onClose} dismissOnBackdrop>
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: sheet.view.groupBy === null }} onPress={() => pick(null)} className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900">
      <Text className="flex-1 text-[17px] text-foreground">No grouping</Text>
      {sheet.view.groupBy === null && tick}
    </Pressable>
    {dropdowns.map((column) => <ColumnRow key={column.id} column={column} onPress={() => pick(column.id)} right={sheet.view.groupBy === column.id ? tick : undefined} />)}
    {dropdowns.length === 0 && <Text className="mt-3 text-[15px] leading-6 text-surface-400">Grouping splits the grid by a dropdown column. This sheet has none yet.</Text>}
  </BottomSheet>
}

export function HiddenSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const hidden = sheet.columns.filter((column) => column.hidden)
  const show = (columnId: string): void => {
    if (hidden.length === 1) onClose()
    void sheets.updateSheet(sheet.id, (input) => ({
      ...input, columns: input.columns.map((column) => column.id === columnId ? { ...column, hidden: false } : column)
    }))
  }
  return <BottomSheet visible={visible} title="Hidden columns" onClose={onClose} dismissOnBackdrop>
    <Text className="mb-2 text-[15px] leading-6 text-surface-400">Hidden columns stay on each row’s page.</Text>
    {hidden.map((column) => <ColumnRow key={column.id} column={column} onPress={() => show(column.id)} right={<View className="flex-row items-center">
      <Eye color="#d4d4d4" size={18} /><Text className="ml-2 text-[15px] font-semibold text-surface-200">Show</Text>
    </View>} />)}
    {hidden.length === 0 && <Text className="text-[15px] text-surface-500">Nothing is hidden.</Text>}
  </BottomSheet>
}
