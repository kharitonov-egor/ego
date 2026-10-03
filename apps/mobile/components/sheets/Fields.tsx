import React, { useEffect, useRef, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import { CalendarDays, ChevronRight, X } from 'lucide-react-native'
import {
  SHEET_COLUMN_TYPE_LABELS, SHEET_TEXT_LIMIT, cellFits, cellText, isEmptyCell, parseSheetNumber,
  type SheetCellValue, type SheetColumn
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { dateLabel, optionOf } from '@ego/local/sheets/view'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { ContactActions, OptionList } from './OptionList'
import { FieldLabel, OptionPill, UNFIT } from './ui'

const KEYBOARDS: Partial<Record<SheetColumn['type'], 'phone-pad' | 'email-address' | 'url' | 'decimal-pad'>> = {
  phone: 'phone-pad', email: 'email-address', link: 'url', number: 'decimal-pad'
}

function textOf(column: SheetColumn, value: SheetCellValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'number') return String(value)
  return cellText(column, value)
}

/**
 * A typed field. A new row's form passes `live` and gets every keystroke; a saved row gets one
 * save when the field loses focus or the screen goes away.
 */
function TypedField({ column, value, live, onCommit }: {
  column: SheetColumn
  value: SheetCellValue | undefined
  live: boolean
  onCommit: (value: SheetCellValue | null) => void
}): React.ReactElement {
  const [text, setText] = useState(() => textOf(column, value))
  const [invalid, setInvalid] = useState(false)
  const latest = useRef({ text, saved: textOf(column, value), onCommit })
  latest.current = { text, saved: textOf(column, value), onCommit }

  const savedText = textOf(column, value)
  useEffect(() => { if (!live) setText(savedText) }, [live, savedText])

  const parse = (raw: string): { ok: boolean; value: SheetCellValue | null } => {
    const trimmed = column.type === 'longText' ? raw.replace(/\s+$/, '') : raw.trim()
    if (trimmed === '') return { ok: true, value: null }
    if (column.type !== 'number') return { ok: true, value: trimmed }
    const number = parseSheetNumber(trimmed)
    return number === null ? { ok: false, value: null } : { ok: true, value: number }
  }

  const commit = (): void => {
    const { text: current, saved } = latest.current
    if (current.trim() === saved.trim()) return
    const parsed = parse(current)
    if (!parsed.ok) {
      setInvalid(true)
      return
    }
    latest.current.onCommit(parsed.value)
  }

  useEffect(() => () => { if (!live) commit() }, [])

  return <View>
    <TextInput
      value={text}
      onChangeText={(next) => {
        setText(next)
        setInvalid(false)
        if (!live) return
        const parsed = parse(next)
        if (parsed.ok) onCommit(parsed.value)
        else setInvalid(true)
      }}
      onEndEditing={live ? undefined : commit}
      multiline={column.type === 'longText'}
      textAlignVertical={column.type === 'longText' ? 'top' : 'center'}
      keyboardType={KEYBOARDS[column.type] ?? 'default'}
      autoCapitalize={column.type === 'email' || column.type === 'link' ? 'none' : 'sentences'}
      autoCorrect={column.type === 'text' || column.type === 'longText'}
      placeholder={`Add ${SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}`}
      placeholderTextColor="#525252"
      accessibilityLabel={column.name}
      maxLength={SHEET_TEXT_LIMIT}
      className={inputClass}
      style={column.type === 'longText' ? { minHeight: 110 } : undefined}
    />
    {invalid && <Text style={{ color: UNFIT }} className="mt-2 text-[14px]">That isn’t a number.</Text>}
    {(column.type === 'phone' || column.type === 'email' || column.type === 'link') && text.trim() !== '' &&
      <View className="mt-2"><ContactActions type={column.type} value={text} /></View>}
  </View>
}

function DateField({ column, value, onCommit }: {
  column: SheetColumn
  value: SheetCellValue | undefined
  onCommit: (value: SheetCellValue | null) => void
}): React.ReactElement {
  const [picking, setPicking] = useState(false)
  const iso = typeof value === 'string' && cellFits(column, value) ? value : null
  return <View className="flex-row items-center gap-2">
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${column.name}: ${iso ? dateLabel(iso, new Date()) : 'no date'}`}
      onPress={() => setPicking(true)}
      className="min-h-[52px] flex-1 flex-row items-center rounded-xl border border-input bg-surface-900 px-4 active:bg-surface-800"
    >
      <CalendarDays color="#a3a3a3" size={18} />
      <Text className={`ml-3 text-[17px] ${iso ? 'text-foreground' : 'text-surface-600'}`}>{iso ? dateLabel(iso, new Date()) : 'Pick a date'}</Text>
    </Pressable>
    {value !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${column.name}`} onPress={() => onCommit(null)} className="h-[52px] w-12 items-center justify-center rounded-xl active:bg-surface-800">
      <X color="#a3a3a3" size={18} />
    </Pressable>}
    <CalendarDialog
      visible={picking}
      value={iso ?? isoToday()}
      onCancel={() => setPicking(false)}
      onConfirm={(next) => {
        setPicking(false)
        onCommit(next)
      }}
    />
  </View>
}

function OptionField({ column, value, onCommit, onCreate }: {
  column: SheetColumn
  value: SheetCellValue | undefined
  onCommit: (value: SheetCellValue | null) => void
  onCreate: (name: string) => Promise<string | null>
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selected = column.type === 'dropdown'
    ? typeof value === 'string' ? [value] : []
    : Array.isArray(value) ? value : []
  const options = selected.flatMap((id) => {
    const option = optionOf(column, id)
    return option ? [option] : []
  })
  const toggle = (id: string): void => {
    if (column.type === 'dropdown') {
      onCommit(selected.includes(id) ? null : id)
      setOpen(false)
      return
    }
    onCommit(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }
  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${column.name}: ${options.map((option) => option.name).join(', ') || 'none'}`}
      onPress={() => setOpen(true)}
      className="min-h-[52px] flex-row items-center rounded-xl border border-input bg-surface-900 px-3 py-2 active:bg-surface-800"
    >
      <View className="flex-1 flex-row flex-wrap gap-1.5">
        {options.length > 0
          ? options.map((option) => <OptionPill key={option.id} option={option} large />)
          : <Text className="px-1 text-[17px] text-surface-600">{column.type === 'tags' ? 'Choose tags' : 'Choose an option'}</Text>}
      </View>
      <ChevronRight color="#737373" size={18} />
    </Pressable>
    <BottomSheet visible={open} title={column.name} onClose={() => setOpen(false)}>
      <OptionList
        column={column}
        selected={selected}
        onToggle={toggle}
        onCreate={(name) => void onCreate(name).then((id) => {
          if (!id) return
          onCommit(column.type === 'dropdown' ? id : [...selected, id])
          if (column.type === 'dropdown') setOpen(false)
        })}
      />
    </BottomSheet>
  </>
}

/** One column of a row, as the row's page shows it. */
export function Field({ column, value, live, onCommit, onCreateOption }: {
  column: SheetColumn
  value: SheetCellValue | undefined
  live: boolean
  onCommit: (value: SheetCellValue | null) => void
  onCreateOption: (name: string) => Promise<string | null>
}): React.ReactElement {
  const unfit = value !== undefined && !isEmptyCell(value) && !cellFits(column, value)
  return <View className="mb-5">
    <FieldLabel type={column.type} name={column.name} />
    {unfit && <Text style={{ color: UNFIT }} className="mb-2 text-[14px] leading-5">
      “{cellText(column, value) || 'A removed option'}” doesn’t fit {SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}.
    </Text>}
    {column.type === 'date' && <DateField column={column} value={value} onCommit={onCommit} />}
    {column.type === 'checkbox' && <View className="min-h-[52px] flex-row items-center rounded-xl border border-input bg-surface-900 px-4">
      <Text className="flex-1 text-[17px] text-foreground">{value === true ? 'Checked' : 'Not checked'}</Text>
      <Switch
        value={value === true}
        onValueChange={(on) => onCommit(on ? true : null)}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={value === true ? '#0a0a0a' : '#d4d4d4'}
        accessibilityLabel={column.name}
      />
    </View>}
    {(column.type === 'dropdown' || column.type === 'tags') &&
      <OptionField column={column} value={value} onCommit={onCommit} onCreate={onCreateOption} />}
    {column.type !== 'date' && column.type !== 'checkbox' && column.type !== 'dropdown' && column.type !== 'tags' &&
      <TypedField column={column} value={value} live={live} onCommit={onCommit} />}
  </View>
}
