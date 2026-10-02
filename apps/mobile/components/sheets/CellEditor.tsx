import React, { useEffect, useRef, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react-native'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_COLUMN_TYPE_LABELS, SHEET_TEXT_LIMIT, parseSheetNumber,
  type SheetCellValue, type SheetColumn
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { useSheets } from '../../lib/sheets/context'
import { cellState, dateLabel, numberLabel, rowName } from '@ego/local/sheets/view'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { ContactActions, OptionList } from './OptionList'
import { UNFIT } from './ui'

const TYPED: readonly SheetColumn['type'][] = ['text', 'longText', 'number', 'phone', 'email', 'link']

function keyboardFor(type: SheetColumn['type']): 'default' | 'phone-pad' | 'email-address' | 'url' | 'decimal-pad' {
  switch (type) {
    case 'phone': return 'phone-pad'
    case 'email': return 'email-address'
    case 'link': return 'url'
    case 'number': return 'decimal-pad'
    default: return 'default'
  }
}

/** What goes in the text box: the stored value, or the text of one that does not fit. */
function draftOf(sheet: SheetRecord, column: SheetColumn, row: SheetRowRecord): string {
  const state = cellState(sheet, column, row)
  if (state.kind === 'mismatch') return state.text
  if (state.kind !== 'value') return ''
  if (typeof state.value === 'number') return String(state.value)
  return typeof state.value === 'string' ? state.value : ''
}

/**
 * Edits one cell in a bottom sheet. Typed values save when the sheet closes or the arrows move to
 * the next cell; picks and switches save as they are tapped.
 */
export function CellEditor({ sheet, row, column, onClose, onStep }: {
  sheet: SheetRecord
  row: SheetRowRecord | null
  column: SheetColumn | null
  onClose: () => void
  onStep: ((direction: -1 | 1) => void) | null
}): React.ReactElement {
  const sheets = useSheets()
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [picking, setPicking] = useState(false)
  const key = row && column ? `${row.id}:${column.id}` : null
  const opened = useRef<string | null>(null)

  useEffect(() => {
    if (!row || !column || opened.current === key) return
    opened.current = key
    setDraft(draftOf(sheet, column, row))
    setInvalid(false)
  }, [column, key, row, sheet])
  useEffect(() => { if (!key) opened.current = null }, [key])

  if (!row || !column) return <BottomSheet visible={false} title="" onClose={onClose}><View /></BottomSheet>

  const state = cellState(sheet, column, row)
  const stored = row.cells[column.id]
  const typed = TYPED.includes(column.type)

  /** Saves a typed draft. False keeps the sheet open on a number that does not read as one. */
  const saveDraft = (): boolean => {
    if (!typed) return true
    const text = column.type === 'longText' ? draft.replace(/\s+$/, '') : draft.trim()
    if (text === draftOf(sheet, column, row).trim()) return true
    let value: SheetCellValue | null = text === '' ? null : text
    if (column.type === 'number' && text !== '') {
      value = parseSheetNumber(text)
      if (value === null) {
        setInvalid(true)
        return false
      }
    }
    void sheets.setCell(row.id, column.id, value)
    return true
  }

  const close = (): void => {
    if (saveDraft()) onClose()
  }

  const step = (direction: -1 | 1): void => {
    if (!saveDraft() || !onStep) return
    opened.current = null
    onStep(direction)
  }

  const selected = column.type === 'dropdown'
    ? typeof stored === 'string' ? [stored] : []
    : Array.isArray(stored) ? stored : []

  const choose = (optionId: string): void => {
    if (column.type === 'dropdown') {
      void sheets.setCell(row.id, column.id, selected.includes(optionId) ? null : optionId)
      return
    }
    void sheets.setCell(row.id, column.id, selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
  }

  const create = async (name: string): Promise<void> => {
    const id = await sheets.addOption(sheet.id, column.id, name)
    if (!id) return
    void sheets.setCell(row.id, column.id, column.type === 'dropdown' ? id : [...selected, id])
  }

  const name = rowName(sheet, row) || 'Untitled'
  return <BottomSheet visible title={column.name} onClose={close}>
    <Text numberOfLines={1} className="-mt-2 mb-4 text-[15px] text-surface-400">{name} · {SHEET_COLUMN_TYPE_LABELS[column.type]}</Text>
    {state.kind === 'mismatch' && <View className="mb-4 rounded-2xl border border-red-400/40 px-4 py-3">
      <Text style={{ color: UNFIT }} className="text-[15px] leading-5">
        “{state.text}” doesn’t fit {SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}. Change it, or clear it.
      </Text>
    </View>}

    {typed && <>
      <TextInput
        key={key}
        value={draft}
        onChangeText={(text) => {
          setDraft(text)
          setInvalid(false)
        }}
        onSubmitEditing={column.type === 'longText' ? undefined : () => { if (onStep) step(1); else close() }}
        autoFocus
        multiline={column.type === 'longText'}
        textAlignVertical={column.type === 'longText' ? 'top' : 'center'}
        keyboardType={keyboardFor(column.type)}
        autoCapitalize={column.type === 'email' || column.type === 'link' ? 'none' : 'sentences'}
        autoCorrect={column.type === 'text' || column.type === 'longText'}
        returnKeyType={onStep ? 'next' : 'done'}
        submitBehavior={column.type === 'longText' ? 'newline' : onStep ? 'submit' : 'blurAndSubmit'}
        placeholder={`Add ${SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}`}
        placeholderTextColor="#737373"
        accessibilityLabel={column.name}
        maxLength={SHEET_TEXT_LIMIT}
        className={inputClass}
        style={column.type === 'longText' ? { minHeight: 150 } : undefined}
      />
      {invalid && <Text style={{ color: UNFIT }} className="mt-2 text-[14px]">That isn’t a number.</Text>}
      {column.type === 'number' && !invalid && draft.trim() !== '' && parseSheetNumber(draft) !== null &&
        <Text className="mt-2 text-[14px] text-surface-500">Saves as {numberLabel(parseSheetNumber(draft) ?? 0)}</Text>}
      <View className="mt-3"><ContactActions type={column.type} value={draft} /></View>
    </>}

    {column.type === 'date' && <View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        className="min-h-14 flex-row items-center rounded-2xl border border-input bg-surface-900 px-4 active:bg-surface-800"
      >
        <CalendarDays color="#d4d4d4" size={20} />
        <Text className="ml-3 flex-1 text-[17px] text-white">
          {state.kind === 'value' && typeof state.value === 'string' ? dateLabel(state.value, new Date()) : 'Pick a date'}
        </Text>
      </Pressable>
      <View className="mt-3 flex-row gap-2">
        <Button variant="outline" size="sm" onPress={() => void sheets.setCell(row.id, column.id, isoToday())}><UiText>Today</UiText></Button>
        {stored !== undefined && <Button variant="ghost" size="sm" onPress={() => void sheets.setCell(row.id, column.id, null)}><X color="#d4d4d4" size={16} /><UiText>Clear</UiText></Button>}
      </View>
      <CalendarDialog
        visible={picking}
        value={state.kind === 'value' && typeof state.value === 'string' ? state.value : isoToday()}
        onCancel={() => setPicking(false)}
        onConfirm={(iso) => {
          setPicking(false)
          void sheets.setCell(row.id, column.id, iso)
        }}
      />
    </View>}

    {column.type === 'checkbox' && <View className="min-h-14 flex-row items-center rounded-2xl border border-input bg-surface-900 px-4">
      <Text className="flex-1 text-[17px] text-white">{stored === true ? 'Checked' : 'Not checked'}</Text>
      <Switch
        value={stored === true}
        onValueChange={(on) => void sheets.setCell(row.id, column.id, on ? true : null)}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={stored === true ? '#0a0a0a' : '#d4d4d4'}
        accessibilityLabel={column.name}
      />
    </View>}

    {(column.type === 'dropdown' || column.type === 'tags') && <>
      <OptionList column={column} selected={selected} onToggle={choose} onCreate={(text) => void create(text)} />
      {selected.length > 0 && <Button variant="ghost" size="sm" className="mt-2 self-start" onPress={() => void sheets.setCell(row.id, column.id, null)}>
        <X color="#d4d4d4" size={16} /><UiText>Clear</UiText>
      </Button>}
    </>}

    <View className="mt-6 flex-row items-center gap-2">
      {onStep && <Pressable accessibilityRole="button" accessibilityLabel="Previous cell" onPress={() => step(-1)} className="h-14 w-14 items-center justify-center rounded-2xl border border-input active:bg-surface-800">
        <ChevronLeft color="#fafafa" size={22} />
      </Pressable>}
      <Button size="lg" className="flex-1" onPress={close}><UiText>Done</UiText></Button>
      {onStep && <Pressable accessibilityRole="button" accessibilityLabel="Next cell" onPress={() => step(1)} className="h-14 w-14 items-center justify-center rounded-2xl border border-input active:bg-surface-800">
        <ChevronRight color="#fafafa" size={22} />
      </Pressable>}
    </View>
  </BottomSheet>
}
