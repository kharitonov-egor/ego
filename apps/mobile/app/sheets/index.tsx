import React, { useLayoutEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { Archive, ChevronRight, Plus, RotateCcw, Trash2, Users } from 'lucide-react-native'
import type { SheetRecord } from '@ego/api-contracts'
import { HeaderIcon } from '../../components/gym/ui'
import { BottomSheet, ConfirmDialog } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { SheetIcon, SheetsError, SheetsGate, SheetsHeaderRight } from '../../components/sheets/ui'
import { ReorderList } from '../../components/tasks/ReorderList'
import { BoardSheet } from '../../components/tasks/sheets'
import { Button } from '../../components/ui/button'
import { Text as UiText } from '../../components/ui/text'
import { useSheets } from '../../lib/sheets/context'
import { sheetSummary } from '../../lib/sheets/view'

function SheetRow({ sheet, lifted }: { sheet: SheetRecord; lifted: boolean }): React.ReactElement {
  const { data } = useSheets()
  return <View className={`min-h-[76px] flex-row items-center rounded-3xl px-4 py-3 ${lifted ? 'bg-surface-900' : 'bg-black'}`}>
    <SheetIcon icon={sheet.icon} size={44} />
    <View className="ml-3 flex-1">
      <Text numberOfLines={1} className="text-[18px] font-semibold text-white">{sheet.name}</Text>
      <Text className="mt-0.5 text-[14px] text-surface-400">{sheetSummary(sheet, data?.rows ?? [])}</Text>
    </View>
    <ChevronRight color="#737373" size={20} />
  </View>
}

function ArchivedSheets({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [deleting, setDeleting] = useState<SheetRecord | null>(null)
  const archived = (sheets.data?.sheets ?? []).filter((sheet) => sheet.archivedAt !== null)
  return <BottomSheet visible={visible} title="Archived sheets" onClose={onClose}>
    {archived.length === 0 && <Text className="text-[15px] text-muted-foreground">No archived sheets.</Text>}
    {archived.map((sheet) => <View key={sheet.id} className="min-h-16 flex-row items-center border-b border-surface-900">
      <SheetIcon icon={sheet.icon} size={36} />
      <Text numberOfLines={1} className="ml-3 flex-1 text-[17px] text-foreground">{sheet.name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Restore ${sheet.name}`} onPress={() => void sheets.updateSheet(sheet.id, (input) => ({ ...input, archivedAt: null }))} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
        <RotateCcw color={color.textSecondary} size={19} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${sheet.name}`} onPress={() => setDeleting(sheet)} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
        <Trash2 color={color.destructive} size={19} />
      </Pressable>
    </View>)}
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this sheet?"
      detail="Its rows go with it, on every device. This cannot be undone."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting) void sheets.deleteSheet(deleting.id)
        setDeleting(null)
      }}
    />
  </BottomSheet>
}

function Sheets(): React.ReactElement {
  const sheets = useSheets()
  const router = useRouter()
  const navigation = useNavigation()
  const [creating, setCreating] = useState(false)
  const [archive, setArchive] = useState(false)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <SheetsHeaderRight>
        <HeaderIcon label="New sheet" onPress={() => setCreating(true)}><Plus color="#fafafa" size={24} /></HeaderIcon>
      </SheetsHeaderRight>
    })
  }, [navigation])

  const all = sheets.data?.sheets ?? []
  const live = all.filter((sheet) => sheet.archivedAt === null).sort((a, b) => a.position - b.position)
  const archivedCount = all.length - live.length
  const open = (id: string): void => router.push({ pathname: '/sheets/[id]', params: { id } })
  const start = (template: 'blank' | 'connections', name?: string, icon?: string): void => {
    void sheets.createSheet(template, name, icon).then((id) => { if (id) open(id) })
  }

  return <View className="flex-1 bg-surface-950">
    <SheetsError />
    {live.length === 0
      ? <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-[20px] font-semibold text-surface-100">No sheets yet</Text>
        <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">
          A sheet is a table you shape yourself: add columns of text, numbers, dates, dropdowns, or tags.
        </Text>
        <Button className="mt-5 self-stretch" size="lg" onPress={() => start('connections')}>
          <Users color="#0a0a0a" size={18} /><UiText>Start Connections</UiText>
        </Button>
        <Text className="mt-2 text-center text-[14px] text-surface-500">A Name column, with Person and Company as row types.</Text>
        <Button className="mt-4 self-stretch" variant="outline" size="lg" onPress={() => setCreating(true)}>
          <Plus color="#fafafa" size={18} /><UiText>Blank sheet</UiText>
        </Button>
        {archivedCount > 0 && <Button variant="ghost" className="mt-2" onPress={() => setArchive(true)}><UiText>Archived sheets</UiText></Button>}
      </View>
      : <ReorderList
        items={live}
        label={(sheet) => sheet.name}
        onPress={(sheet) => open(sheet.id)}
        onMove={(id, index) => void sheets.moveSheet(id, index)}
        renderItem={(sheet, lifted) => <SheetRow sheet={sheet} lifted={lifted} />}
        footer={<View className="mt-4 gap-3">
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} className="min-h-14 flex-row items-center justify-center rounded-3xl border border-dashed border-surface-600 active:bg-surface-900">
            <Plus color={color.textMuted} size={20} />
            <Text className="ml-2 text-[16px] font-semibold text-surface-300">New sheet</Text>
          </Pressable>
          {archivedCount > 0 && <Pressable accessibilityRole="button" onPress={() => setArchive(true)} className="min-h-12 flex-row items-center justify-center active:opacity-70">
            <Archive color={color.textFaint} size={17} />
            <Text className="ml-2 text-[15px] text-surface-500">{archivedCount === 1 ? '1 archived sheet' : `${archivedCount} archived sheets`}</Text>
          </Pressable>}
        </View>}
      />}
    <BoardSheet
      visible={creating}
      title="New sheet"
      name=""
      icon="📄"
      confirm="Create"
      placeholder="Sheet name"
      onClose={() => setCreating(false)}
      onSave={(name, icon) => {
        setCreating(false)
        start('blank', name, icon)
      }}
    />
    <ArchivedSheets visible={archive} onClose={() => setArchive(false)} />
  </View>
}

export default function SheetsScreen(): React.ReactElement {
  return <SheetsGate><Sheets /></SheetsGate>
}
