import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native'
import { KeyboardScrollView } from '../../../components/ui/keyboard'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Copy, Ellipsis, Trash2 } from 'lucide-react-native'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import { SHEET_TEXT_LIMIT, type SheetCellValue } from '@ego/core'
import { HeaderIcon, MenuSheet } from '../../../components/gym/ui'
import { Field } from '../../../components/sheets/Fields'
import { SheetsError, SheetsGate, SheetsHeaderRight, SheetsMessage } from '../../../components/sheets/ui'
import { Button } from '../../../components/ui/button'
import { Text as UiText } from '../../../components/ui/text'
import { formatIso, timeAgo } from '../../../lib/dates'
import { withCell } from '../../../lib/sheets/edits'
import { useSheets } from '../../../lib/sheets/context'
import { formColumns, nameColumn, rowName } from '../../../lib/sheets/view'
import { localDay } from '../../../lib/tasks/board'

function TypeChoice({ sheet, typeId, onChange }: { sheet: SheetRecord; typeId: string | null; onChange: (typeId: string) => void }): React.ReactElement {
  return <View className="mb-6 flex-row flex-wrap gap-2">
    {sheet.rowTypes.map((type) => {
      const selected = type.id === typeId
      return <Pressable
        key={type.id}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={() => onChange(type.id)}
        className={`h-10 justify-center rounded-full px-4 ${selected ? 'bg-white' : 'border border-surface-700 active:bg-surface-800'}`}
      >
        <Text className={`text-[15px] font-semibold ${selected ? 'text-black' : 'text-surface-200'}`}>{type.name}</Text>
      </Pressable>
    })}
  </View>
}

/** The row's name, written large. A saved row saves it when the field loses focus or the page closes. */
function NameInput({ value, live, onCommit }: { value: string; live: boolean; onCommit: (name: string) => void }): React.ReactElement {
  const [text, setText] = useState(value)
  const latest = useRef({ text, value, onCommit })
  latest.current = { text, value, onCommit }
  useEffect(() => { if (!live) setText(value) }, [live, value])
  const commit = (): void => {
    const { text: current, value: saved } = latest.current
    if (current.trim() !== '' && current.trim() !== saved.trim()) latest.current.onCommit(current.trim())
  }
  useEffect(() => () => { if (!live) commit() }, [])
  return <TextInput
    value={text}
    onChangeText={(next) => {
      setText(next)
      if (live) onCommit(next)
    }}
    onEndEditing={live ? undefined : commit}
    autoFocus={live}
    multiline
    blurOnSubmit
    returnKeyType="done"
    placeholder="Name"
    placeholderTextColor="#525252"
    accessibilityLabel="Name"
    maxLength={SHEET_TEXT_LIMIT}
    className="mb-5 text-[26px] font-bold leading-9 text-white"
    style={{ padding: 0 }}
  />
}

function RowPage({ rowId, sheetId, initialType }: { rowId: string; sheetId: string; initialType: string | null }): React.ReactElement {
  const sheets = useSheets()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const isNew = rowId === 'new'
  const row: SheetRowRecord | undefined = isNew ? undefined : sheets.data?.rows.find((item) => item.id === rowId)
  const sheet = sheets.data?.sheets.find((item) => item.id === (row?.sheetId ?? sheetId))
  const [draft, setDraft] = useState<Record<string, SheetCellValue>>({})
  const [draftType, setDraftType] = useState<string | null>(initialType)
  const [menu, setMenu] = useState(false)
  const saving = useRef(false)
  const leaving = useRef(false)

  const typeId = isNew ? draftType : row?.typeId ?? null
  const name = sheet ? (isNew ? rowName(sheet, { cells: draft }) : row ? rowName(sheet, row) : '') : ''
  const canSave = isNew && sheet !== undefined && name.trim() !== '' && (!sheet.typesEnabled || typeId !== null)

  const save = (): void => {
    if (!sheet || !canSave || saving.current) return
    saving.current = true
    void sheets.createRow(sheet.id, typeId, withCell(draft, nameColumn(sheet).id, name.trim())).then((id) => {
      saving.current = false
      if (id) router.back()
    })
  }
  const latestSave = useRef(save)
  latestSave.current = save

  useLayoutEffect(() => {
    navigation.setOptions({
      title: sheet ? (isNew ? `New in ${sheet.name}` : sheet.name) : '',
      headerRight: () => <SheetsHeaderRight>
        {isNew
          ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={() => latestSave.current()} hitSlop={8} className="h-10 justify-center px-2">
            <Text className={`text-[17px] font-bold ${canSave ? 'text-white' : 'text-surface-600'}`}>Save</Text>
          </Pressable>
          : <HeaderIcon label="Row menu" onPress={() => {
            Keyboard.dismiss()
            setMenu(true)
          }}><Ellipsis color="#fafafa" size={22} /></HeaderIcon>}
      </SheetsHeaderRight>
    })
  }, [canSave, isNew, navigation, sheet])

  if (!sheet || (!isNew && !row)) {
    if (leaving.current) return <View className="flex-1 bg-surface-950" />
    return <SheetsMessage title="This row is gone" detail="It was deleted, maybe on another device." action="Back" onAction={() => router.back()} />
  }

  const cells = isNew ? draft : row?.cells ?? {}
  const commit = (columnId: string) => (value: SheetCellValue | null): void => {
    if (isNew) setDraft((current) => withCell(current, columnId, value))
    else if (row) void sheets.setCell(row.id, columnId, value)
  }
  const chooseType = (next: string): void => {
    if (isNew) setDraftType(next)
    else if (row && next !== row.typeId) void sheets.updateRow(row.id, (input) => ({ ...input, typeId: next }))
  }
  const asking = isNew && sheet.typesEnabled && typeId === null

  return <View className="flex-1 bg-surface-950">
    <KeyboardScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 48 }}>
      <SheetsError />
      {asking
        ? <View>
          <Text className="mb-1 text-[22px] font-bold text-white">What kind of row is this?</Text>
          <Text className="mb-5 text-[15px] leading-6 text-surface-400">The type decides which columns it has.</Text>
          <TypeChoice sheet={sheet} typeId={null} onChange={chooseType} />
        </View>
        : <>
          <NameInput value={name} live={isNew} onCommit={commit(nameColumn(sheet).id)} />
          {sheet.typesEnabled && sheet.rowTypes.length > 0 && <TypeChoice sheet={sheet} typeId={typeId} onChange={chooseType} />}
          {formColumns(sheet, typeId).map((column) => <Field
            key={`${column.id}:${column.type}`}
            column={column}
            value={cells[column.id]}
            live={isNew}
            onCommit={commit(column.id)}
            onCreateOption={(optionName) => sheets.addOption(sheet.id, column.id, optionName)}
          />)}
          {formColumns(sheet, typeId).length === 0 && <Text className="mb-5 text-[15px] leading-6 text-surface-500">
            This sheet has no other columns yet. Add them from the grid’s header.
          </Text>}
          {isNew
            ? <Button size="lg" className="mt-2" disabled={!canSave} onPress={save}><UiText>Add row</UiText></Button>
            : row && <Text className="mt-2 text-[13px] text-surface-500">
              Added {formatIso(localDay(new Date(row.createdAt)))} · Edited {timeAgo(row.updatedAt, new Date())}
            </Text>}
        </>}
    </KeyboardScrollView>
    {row && <MenuSheet visible={menu} title={name || 'Untitled'} onClose={() => setMenu(false)} items={[
      { label: 'Duplicate', Icon: Copy, onPress: () => void sheets.duplicateRow(row.id).then((id) => { if (id) router.replace({ pathname: '/sheets/row/[id]', params: { id } }) }) },
      {
        label: 'Delete', Icon: Trash2, destructive: true,
        onPress: () => {
          leaving.current = true
          sheets.deleteRow(row.id)
          router.back()
        }
      }
    ]} />}
  </View>
}

export default function RowScreen(): React.ReactElement {
  const { id, sheetId, typeId } = useLocalSearchParams<{ id: string; sheetId?: string; typeId?: string }>()
  return <SheetsGate><RowPage rowId={id} sheetId={sheetId ?? ''} initialType={typeId ? typeId : null} /></SheetsGate>
}
