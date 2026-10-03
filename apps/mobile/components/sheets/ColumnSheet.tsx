import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Check, Plus, Trash2 } from 'lucide-react-native'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_COLUMN_NAME_LIMIT, SHEET_COLUMN_TYPES, SHEET_COLUMN_TYPE_LABELS, SHEET_OPTION_LIMIT, SHEET_OPTION_NAME_LIMIT,
  SHEET_SHADES, nextShade,
  type SheetColumn, type SheetColumnType, type SheetOption
} from '@ego/core'
import { sheetInput, unfitAfter } from '@ego/local/sheets/edits'
import { useSheets } from '../../lib/sheets/context'
import { newId } from '@ego/local/sync/commands'
import { BottomSheet, inputClass } from '../money/Common'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { COLUMN_TYPE_ICONS, SHADES, UNFIT } from './ui'

function Heading({ children }: { children: string }): React.ReactElement {
  return <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">{children}</Text>
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected }}
    onPress={onPress}
    className={`min-h-11 flex-row items-center justify-center rounded-xl border px-3.5 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    <Text className={`text-[15px] font-semibold ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</Text>
  </Pressable>
}

function usedBy(rows: readonly SheetRowRecord[], columnId: string, optionIds: ReadonlySet<string>): number {
  return rows.filter((row) => {
    const value = row.cells[columnId]
    const ids = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    return ids.some((id) => optionIds.has(id))
  }).length
}

/** Adds a column, or edits one: its name, its type, its options, and which row types it applies to. */
export function ColumnSheet({ sheet, column, visible, onClose }: {
  sheet: SheetRecord
  /** Null adds a new column. */
  column: SheetColumn | null
  visible: boolean
  onClose: () => void
}): React.ReactElement {
  const sheets = useSheets()
  const isName = column !== null && sheet.columns[0]?.id === column.id
  const [name, setName] = useState('')
  const [type, setType] = useState<SheetColumnType>('text')
  const [options, setOptions] = useState<SheetOption[]>([])
  const [typeIds, setTypeIds] = useState<string[] | null>(null)
  const [adding, setAdding] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(column?.name ?? '')
    setType(column?.type ?? 'text')
    setOptions(column?.options ?? [])
    setTypeIds(column?.typeIds ?? null)
    setAdding('')
  }, [column, visible])

  const rows = useMemo(() => sheets.data?.rows.filter((row) => row.sheetId === sheet.id) ?? [], [sheet.id, sheets.data])
  const draft: SheetColumn = {
    id: column?.id ?? 'draft',
    name: name.trim(),
    type,
    options: options.map((option) => ({ ...option, name: option.name.trim() })).filter((option) => option.name !== ''),
    typeIds: isName ? null : typeIds,
    hidden: column?.hidden ?? false
  }
  const holdsOptions = type === 'dropdown' || type === 'tags'
  const unfit = column ? unfitAfter(sheetInput(sheet), rows, draft) : 0
  const removed = column ? new Set(column.options.filter((option) => !draft.options.some((kept) => kept.id === option.id)).map((option) => option.id)) : new Set<string>()
  const clearing = column && holdsOptions && removed.size > 0 ? usedBy(rows, column.id, removed) : 0
  const fromText = column !== null && column.type !== 'dropdown' && column.type !== 'tags' && holdsOptions && rows.some((row) => row.cells[column.id] !== undefined)

  const addOption = (): void => {
    const text = adding.trim()
    if (text === '' || options.length >= SHEET_OPTION_LIMIT) return
    if (options.some((option) => option.name.trim().toLowerCase() === text.toLowerCase())) {
      setAdding('')
      return
    }
    setOptions([...options, { id: newId(), name: text, shade: nextShade(options) }])
    setAdding('')
  }

  const save = (): void => {
    if (draft.name === '') return
    const next: SheetColumn = { ...draft, id: column?.id ?? newId() }
    onClose()
    void sheets.saveColumn(sheet.id, next)
  }

  const toggleType = (id: string): void => {
    const current = typeIds ?? []
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    setTypeIds(next.length === 0 || next.length === sheet.rowTypes.length ? null : next)
  }

  return <BottomSheet visible={visible} title={column ? 'Edit column' : 'New column'} onClose={onClose}>
    <TextInput
      value={name}
      onChangeText={setName}
      placeholder="Column name"
      placeholderTextColor="#737373"
      accessibilityLabel="Column name"
      autoFocus={column === null}
      maxLength={SHEET_COLUMN_NAME_LIMIT}
      className={inputClass}
    />

    <Heading>Type</Heading>
    {isName
      ? <Text className="text-[15px] leading-5 text-surface-400">The first column names each row, so it is always text.</Text>
      : <View className="flex-row flex-wrap gap-2">
        {SHEET_COLUMN_TYPES.map((item) => {
          const Icon = COLUMN_TYPE_ICONS[item]
          const selected = item === type
          return <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => setType(item)}
            className={`min-h-12 w-[48%] flex-row items-center rounded-xl border px-3 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
          >
            <Icon color={selected ? '#0a0a0a' : '#d4d4d4'} size={18} />
            <Text className={`ml-2.5 text-[15px] font-semibold ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{SHEET_COLUMN_TYPE_LABELS[item]}</Text>
          </Pressable>
        })}
      </View>}

    {holdsOptions && <>
      <Heading>Options</Heading>
      {options.map((option, index) => {
        const shade = SHADES[option.shade]
        return <View key={option.id} className="mb-2 flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Shade for ${option.name || 'this option'}`}
            accessibilityHint="Changes to the next grey"
            onPress={() => setOptions(options.map((item, at) => at === index
              ? { ...item, shade: SHEET_SHADES[(SHEET_SHADES.indexOf(item.shade) + 1) % SHEET_SHADES.length] }
              : item))}
            style={{ backgroundColor: shade.background, borderColor: shade.border, borderWidth: 1 }}
            className="h-11 w-11 rounded-full"
          />
          <TextInput
            value={option.name}
            onChangeText={(text) => setOptions(options.map((item, at) => at === index ? { ...item, name: text } : item))}
            accessibilityLabel="Option name"
            maxLength={SHEET_OPTION_NAME_LIMIT}
            className={`${inputClass} flex-1`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${option.name || 'option'}`}
            onPress={() => setOptions(options.filter((_, at) => at !== index))}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"
          ><Trash2 color="#a3a3a3" size={18} /></Pressable>
        </View>
      })}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={adding}
          onChangeText={setAdding}
          onSubmitEditing={addOption}
          blurOnSubmit={false}
          placeholder="New option"
          placeholderTextColor="#737373"
          accessibilityLabel="New option"
          returnKeyType="done"
          maxLength={SHEET_OPTION_NAME_LIMIT}
          className={`${inputClass} flex-1`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add option"
          onPress={addOption}
          className="h-[52px] w-[52px] items-center justify-center rounded-xl bg-surface-800 active:bg-surface-700"
        ><Plus color="#fafafa" size={20} /></Pressable>
      </View>
      <Text className="mt-2 text-[13px] leading-5 text-surface-500">Tap a circle to change its grey.</Text>
      {fromText && <Text className="mt-1 text-[13px] leading-5 text-surface-400">Every value already in this column becomes an option when you save.</Text>}
    </>}

    {sheet.typesEnabled && !isName && sheet.rowTypes.length > 0 && <>
      <Heading>Applies to</Heading>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="All types" selected={typeIds === null} onPress={() => setTypeIds(null)} />
        {sheet.rowTypes.map((rowType) => <Chip
          key={rowType.id}
          label={rowType.name}
          selected={typeIds !== null && typeIds.includes(rowType.id)}
          onPress={() => toggleType(rowType.id)}
        />)}
      </View>
      <Text className="mt-2 text-[13px] leading-5 text-surface-500">Rows of other types show a dash in this column.</Text>
    </>}

    {(unfit > 0 || clearing > 0) && <View className="mt-5 rounded-2xl border border-red-400/40 px-4 py-3">
      {unfit > 0 && <Text style={{ color: UNFIT }} className="text-[15px] leading-5">
        {unfit === 1 ? '1 value doesn’t' : `${unfit} values don’t`} fit {SHEET_COLUMN_TYPE_LABELS[type].toLowerCase()}. They stay as typed and show in red until you fix them.
      </Text>}
      {clearing > 0 && <Text style={{ color: UNFIT }} className={`text-[15px] leading-5 ${unfit > 0 ? 'mt-2' : ''}`}>
        Removing {removed.size === 1 ? 'that option' : 'those options'} clears {clearing === 1 ? 'it from 1 row' : `them from ${clearing} rows`}.
      </Text>}
    </View>}

    <Button size="lg" className="mt-6" disabled={draft.name === ''} onPress={save}>
      <Check color="#0a0a0a" size={18} /><UiText>{column ? 'Save column' : 'Add column'}</UiText>
    </Button>
  </BottomSheet>
}
