import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArchiveRestore, Circle, CircleCheck, Trash2 } from 'lucide-react-native'
import type { TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import { ConfirmDialog } from '../../../components/money/Common'
import { color } from '../../../components/money/tokens'
import { CardFace, TasksError, TasksGate } from '../../../components/tasks/ui'
import { SegmentedControl } from '../../../components/ui/segmented-control'
import { Blurred } from '../../../lib/blur'
import { boardLabels } from '@ego/local/tasks/board'
import { useTasks } from '../../../lib/tasks/context'

type Target = { kind: 'card'; card: TaskCardRecord } | { kind: 'list'; list: TaskListRecord }

/** An imported board can archive thousands of cards, so they come a page at a time. */
const PAGE = 50

function shortDate(at: string): string {
  const day = new Date(at)
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

function Archived({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const [view, setView] = useState<'cards' | 'lists'>('cards')
  const [deleting, setDeleting] = useState<Target | null>(null)
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const data = tasks.data
  if (!data) return <View />
  const liveLists = new Set(data.lists.filter((list) => list.boardId === boardId && list.archivedAt === null).map((list) => list.id))
  const query = search.trim().toLowerCase()
  const archived = data.cards
    .filter((card) => card.boardId === boardId && card.archivedAt !== null && liveLists.has(card.listId))
  const cards = archived
    .filter((card) => !query || card.title.toLowerCase().includes(query) || card.description.toLowerCase().includes(query))
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const listName = new Map(data.lists.map((list) => [list.id, list.name]))
  const lists = data.lists
    .filter((list) => list.boardId === boardId && list.archivedAt !== null)
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const labels = boardLabels(data, boardId)

  return <View className="flex-1 bg-surface-950">
    <TasksError />
    <View className="px-4 pb-2">
      <SegmentedControl
        options={[{ value: 'cards', label: `Cards (${archived.length})` }, { value: 'lists', label: `Lists (${lists.length})` }]}
        value={view}
        onValueChange={setView}
      />
      {view === 'cards' && archived.length > 0 && <TextInput
        value={search}
        onChangeText={(text) => {
          setSearch(text)
          setShown(PAGE)
        }}
        placeholder="Search archived cards"
        placeholderTextColor="#737373"
        accessibilityLabel="Search archived cards"
        returnKeyType="search"
        className="mt-3 min-h-11 rounded-xl border border-surface-800 bg-surface-900 px-4 text-[16px] text-foreground"
      />}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
      {view === 'cards' && archived.length === 0 && <Text className="text-[15px] text-muted-foreground">No archived cards. Cards in an archived list come back with the list.</Text>}
      {view === 'cards' && archived.length > 0 && cards.length === 0 && <Text className="text-[15px] text-muted-foreground">No archived card matches.</Text>}
      {view === 'lists' && lists.length === 0 && <Text className="text-[15px] text-muted-foreground">No archived lists.</Text>}
      {view === 'cards' && cards.slice(0, shown).map((card) => <View key={card.id}>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/tasks/card/[id]', params: { id: card.id } })}>
          <CardFace card={card} labels={labels} now={tasks.now} />
        </Pressable>
        <View className="mt-1.5 flex-row items-center">
          {card.doneAt
            ? <CircleCheck color="#0a0a0a" fill={color.positive} size={16} />
            : <Circle color={color.textFaint} size={16} />}
          <Text className={`ml-1.5 text-[14px] ${card.doneAt ? 'font-semibold text-positive' : 'text-surface-400'}`}>{card.doneAt ? 'Done' : 'Not done'}</Text>
          <Blurred tint="#a3a3a3"><Text numberOfLines={1} className="ml-1.5 flex-1 text-[14px] text-surface-400">
            · {listName.get(card.listId) ?? 'A list'} · archived {shortDate(card.archivedAt ?? card.updatedAt)}
          </Text></Blurred>
        </View>
        <View className="flex-row justify-end gap-4">
          <Pressable accessibilityRole="button" onPress={() => void tasks.updateCard(card.id, (input) => ({ ...input, archivedAt: null }))} className="min-h-11 flex-row items-center">
            <ArchiveRestore color={color.textSecondary} size={17} />
            <Text className="ml-1.5 text-[15px] font-semibold text-surface-200">Send to board</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setDeleting({ kind: 'card', card })} className="min-h-11 flex-row items-center">
            <Trash2 color={color.destructive} size={17} />
            <Text className="ml-1.5 text-[15px] font-semibold text-destructive">Delete</Text>
          </Pressable>
        </View>
      </View>)}
      {view === 'cards' && cards.length > shown && <Pressable
        accessibilityRole="button"
        onPress={() => setShown((count) => count + PAGE)}
        className="min-h-12 items-center justify-center rounded-xl bg-surface-900 active:bg-surface-800"
      >
        <Text className="text-[15px] font-semibold text-surface-200">Show {Math.min(PAGE, cards.length - shown)} more of {cards.length - shown}</Text>
      </Pressable>}
      {view === 'lists' && lists.map((list) => {
        const count = data.cards.filter((card) => card.listId === list.id && card.archivedAt === null).length
        return <View key={list.id} className="flex-row items-center rounded-2xl bg-surface-900 px-4 py-3">
          <View className="flex-1">
            <Blurred tint="#fafafa"><Text numberOfLines={1} className="text-[17px] font-semibold text-surface-100">{list.name}</Text></Blurred>
            <Text className="text-[14px] text-surface-500">{count === 1 ? '1 card' : `${count} cards`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Send ${list.name} back to the board`} onPress={() => void tasks.updateList(list.id, { archivedAt: null })} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
            <ArchiveRestore color={color.textSecondary} size={19} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${list.name}`} onPress={() => setDeleting({ kind: 'list', list })} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
            <Trash2 color={color.destructive} size={19} />
          </Pressable>
        </View>
      })}
    </ScrollView>
    <ConfirmDialog
      visible={deleting !== null}
      title={deleting?.kind === 'list' ? 'Delete this list?' : 'Delete this card?'}
      detail={deleting?.kind === 'list' ? 'Its cards go with it, on every device. This cannot be undone.' : 'It is gone for good, on every device.'}
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting?.kind === 'list') void tasks.deleteList(deleting.list.id)
        if (deleting?.kind === 'card') void tasks.deleteCard(deleting.card.id)
        setDeleting(null)
      }}
    />
  </View>
}

export default function ArchiveScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TasksGate><Archived boardId={id} /></TasksGate>
}
