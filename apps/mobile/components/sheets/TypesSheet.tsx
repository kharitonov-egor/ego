import React, { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { Pencil, Plus, Trash2 } from 'lucide-react-native'
import type { SheetRecord } from '@ego/api-contracts'
import { SHEET_ROW_TYPE_LIMIT, type SheetRowType } from '@ego/core'
import { useSheets } from '../../lib/sheets/context'
import { BottomSheet } from '../money/Common'
import { TextSheet } from '../tasks/sheets'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

type Naming = { kind: 'first' } | { kind: 'add' } | { kind: 'rename'; type: SheetRowType }

/** Turns row types on or off, and adds, renames, and deletes them. */
export function TypesSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [naming, setNaming] = useState<Naming | null>(null)
  const [deleting, setDeleting] = useState<SheetRowType | null>(null)
  const rows = sheets.data?.rows.filter((row) => row.sheetId === sheet.id) ?? []
  const countOf = (typeId: string): number => rows.filter((row) => row.typeId === typeId).length

  const toggle = (on: boolean): void => {
    if (on && sheet.rowTypes.length === 0) {
      setNaming({ kind: 'first' })
      return
    }
    void sheets.setTypesEnabled(sheet.id, on)
  }

  const save = (name: string): void => {
    const current = naming
    setNaming(null)
    if (!current) return
    if (current.kind === 'first') void sheets.setTypesEnabled(sheet.id, true, name)
    else void sheets.saveRowType(sheet.id, current.kind === 'rename' ? current.type.id : null, name)
  }

  const remove = (type: SheetRowType): void => {
    const others = sheet.rowTypes.filter((item) => item.id !== type.id)
    if (others.length === 0) return
    if (countOf(type.id) === 0) {
      void sheets.deleteRowType(sheet.id, type.id, others[0].id)
      return
    }
    setDeleting(type)
  }

  const others = deleting ? sheet.rowTypes.filter((item) => item.id !== deleting.id) : []
  const moving = deleting ? countOf(deleting.id) : 0

  return <BottomSheet visible={visible} title="Row types" onClose={onClose}>
    <View className="min-h-14 flex-row items-center">
      <View className="flex-1 pr-3">
        <Text className="text-[17px] text-foreground">Use row types</Text>
        <Text className="mt-0.5 text-[14px] leading-5 text-surface-400">Each row gets a type, and a column can apply to some types only.</Text>
      </View>
      <Switch
        value={sheet.typesEnabled}
        onValueChange={toggle}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={sheet.typesEnabled ? '#0a0a0a' : '#d4d4d4'}
        accessibilityLabel="Use row types"
      />
    </View>

    {sheet.typesEnabled && <View className="mt-3">
      {sheet.rowTypes.map((type) => {
        const count = countOf(type.id)
        return <View key={type.id} className="min-h-14 flex-row items-center border-b border-surface-900">
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[17px] text-foreground">{type.name}</Text>
            <Text className="text-[13px] text-surface-500">{count === 1 ? '1 row' : `${count} rows`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${type.name}`} onPress={() => setNaming({ kind: 'rename', type })} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
            <Pencil color="#d4d4d4" size={18} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${type.name}`}
            accessibilityState={{ disabled: sheet.rowTypes.length === 1 }}
            disabled={sheet.rowTypes.length === 1}
            onPress={() => remove(type)}
            className={`h-11 w-11 items-center justify-center rounded-full active:bg-surface-800 ${sheet.rowTypes.length === 1 ? 'opacity-30' : ''}`}
          ><Trash2 color="#fb7185" size={18} /></Pressable>
        </View>
      })}
      {sheet.rowTypes.length === 1 && <Text className="mt-2 text-[13px] leading-5 text-surface-500">A sheet with types keeps at least one. Turn types off to stop using them.</Text>}
      {sheet.rowTypes.length < SHEET_ROW_TYPE_LIMIT && <Button variant="outline" className="mt-4" onPress={() => setNaming({ kind: 'add' })}>
        <Plus color="#fafafa" size={18} /><UiText>Add a type</UiText>
      </Button>}
    </View>}
    {!sheet.typesEnabled && sheet.rowTypes.length > 0 && <Text className="mt-3 text-[14px] leading-5 text-surface-500">
      This sheet keeps its {sheet.rowTypes.length === 1 ? 'type' : `${sheet.rowTypes.length} types`} and each row’s type for when you turn them back on.
    </Text>}

    <TextSheet
      visible={naming !== null}
      title={naming?.kind === 'rename' ? 'Rename type' : naming?.kind === 'first' ? 'First type' : 'New type'}
      value={naming?.kind === 'rename' ? naming.type.name : ''}
      placeholder={naming?.kind === 'first' ? 'Like Person' : 'Type name'}
      confirm={naming?.kind === 'rename' ? 'Save' : 'Add'}
      onSave={save}
      onClose={() => setNaming(null)}
    />
    <BottomSheet visible={deleting !== null} title={`Delete ${deleting?.name ?? 'type'}?`} onClose={() => setDeleting(null)}>
      <Text className="mb-3 text-[15px] leading-6 text-surface-300">
        {moving === 1 ? '1 row is' : `${moving} rows are`} this type. Move {moving === 1 ? 'it' : 'them'} to:
      </Text>
      {others.map((type) => <Pressable
        key={type.id}
        accessibilityRole="button"
        onPress={() => {
          const target = deleting
          setDeleting(null)
          if (target) void sheets.deleteRowType(sheet.id, target.id, type.id)
        }}
        className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900"
      ><Text className="text-[17px] text-foreground">{type.name}</Text></Pressable>)}
    </BottomSheet>
  </BottomSheet>
}
