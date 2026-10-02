import React, { useLayoutEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { Archive, Bell, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react-native'
import type { TaskBoardRecord } from '@ego/api-contracts'
import { HeaderIcon } from '../../../components/gym/ui'
import { BottomSheet, ConfirmDialog } from '../../../components/money/Common'
import { color } from '../../../components/money/tokens'
import { ReorderList } from '../../../components/tasks/ReorderList'
import { BoardSheet, TaskNotificationsSheet } from '../../../components/tasks/sheets'
import { BoardIcon, TasksError, TasksGate, TasksHeaderRight } from '../../../components/tasks/ui'
import { Button } from '../../../components/ui/button'
import { Text as UiText } from '../../../components/ui/text'
import { Blurred } from '../../../lib/blur'
import { boardSummary, liveBoards } from '@ego/local/tasks/board'
import { useTasks } from '../../../lib/tasks/context'

function summaryText(open: number, dueSoon: number, overdue: number): string {
  const parts = [open === 1 ? '1 open card' : `${open} open cards`]
  if (overdue > 0) parts.push(`${overdue} overdue`)
  if (dueSoon > 0) parts.push(`${dueSoon} due soon`)
  return parts.join(' · ')
}

function BoardRow({ board, lifted }: { board: TaskBoardRecord; lifted: boolean }): React.ReactElement {
  const { data, now } = useTasks()
  const summary = data ? boardSummary(data, board.id, now) : { open: 0, dueSoon: 0, overdue: 0 }
  return <View className={`min-h-[76px] flex-row items-center rounded-3xl border-2 px-4 py-3 ${lifted ? 'border-white bg-surface-900' : 'border-white bg-black'}`}>
    <BoardIcon icon={board.icon} size={44} />
    <View className="ml-3 flex-1">
      <Blurred tint="#fafafa"><Text numberOfLines={1} className="text-[18px] font-semibold text-white">{board.name}</Text></Blurred>
      <Text className={`mt-0.5 text-[14px] ${summary.overdue > 0 ? 'text-red-400' : 'text-surface-400'}`}>
        {summaryText(summary.open, summary.dueSoon, summary.overdue)}
      </Text>
    </View>
    <ChevronRight color="#737373" size={20} />
  </View>
}

function ArchivedBoards({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const tasks = useTasks()
  const [deleting, setDeleting] = useState<TaskBoardRecord | null>(null)
  const archived = (tasks.data?.boards ?? []).filter((board) => board.archivedAt !== null)
  return <BottomSheet visible={visible} title="Archived boards" onClose={onClose}>
    {archived.length === 0 && <Text className="text-[15px] text-muted-foreground">No archived boards.</Text>}
    {archived.map((board) => <View key={board.id} className="min-h-16 flex-row items-center border-b border-surface-900">
      <BoardIcon icon={board.icon} size={36} />
      <Blurred tint="#fafafa"><Text numberOfLines={1} className="ml-3 flex-1 text-[17px] text-foreground">{board.name}</Text></Blurred>
      <Pressable accessibilityRole="button" accessibilityLabel={`Restore ${board.name}`} onPress={() => void tasks.updateBoard(board.id, { archivedAt: null })} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
        <RotateCcw color={color.textSecondary} size={19} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${board.name}`} onPress={() => setDeleting(board)} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
        <Trash2 color={color.destructive} size={19} />
      </Pressable>
    </View>)}
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this board?"
      detail="Its lists, cards, and labels go with it, on every device. This cannot be undone."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting) void tasks.deleteBoard(deleting.id)
        setDeleting(null)
      }}
    />
  </BottomSheet>
}

function Boards(): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const navigation = useNavigation()
  const [creating, setCreating] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [archive, setArchive] = useState(false)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TasksHeaderRight>
        <HeaderIcon label="Notifications" onPress={() => setNotifications(true)}><Bell color="#fafafa" size={21} /></HeaderIcon>
        <HeaderIcon label="New board" onPress={() => setCreating(true)}><Plus color="#fafafa" size={24} /></HeaderIcon>
      </TasksHeaderRight>
    })
  }, [navigation])

  const data = tasks.data
  const boards = data ? liveBoards(data) : []
  const archivedCount = (data?.boards ?? []).filter((board) => board.archivedAt !== null).length
  const open = (board: TaskBoardRecord): void => router.push({ pathname: '/tasks/board/[id]', params: { id: board.id } })

  return <View className="flex-1 bg-surface-950">
    <TasksError />
    {boards.length === 0
      ? <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-[20px] font-semibold text-surface-100">No boards yet</Text>
        <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">
          A board holds lists, and lists hold cards. New boards start with To Do, Doing, and Done.
        </Text>
        <Button className="mt-5" onPress={() => setCreating(true)}><Plus color="#0a0a0a" size={18} /><UiText>Create a board</UiText></Button>
        {archivedCount > 0 && <Button variant="ghost" className="mt-2" onPress={() => setArchive(true)}><UiText>Archived boards</UiText></Button>}
      </View>
      : <ReorderList
        items={boards}
        label={(board) => board.name}
        onPress={open}
        onMove={(id, index) => void tasks.moveBoard(id, index)}
        renderItem={(board, lifted) => <BoardRow board={board} lifted={lifted} />}
        footer={<View className="mt-4 gap-3">
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} className="min-h-14 flex-row items-center justify-center rounded-3xl border border-dashed border-surface-600 active:bg-surface-900">
            <Plus color={color.textMuted} size={20} />
            <Text className="ml-2 text-[16px] font-semibold text-surface-300">New board</Text>
          </Pressable>
          {archivedCount > 0 && <Pressable accessibilityRole="button" onPress={() => setArchive(true)} className="min-h-12 flex-row items-center justify-center active:opacity-70">
            <Archive color={color.textFaint} size={17} />
            <Text className="ml-2 text-[15px] text-surface-500">{archivedCount === 1 ? '1 archived board' : `${archivedCount} archived boards`}</Text>
          </Pressable>}
        </View>}
      />}
    <BoardSheet
      visible={creating}
      title="New board"
      name=""
      icon="📋"
      confirm="Create"
      onClose={() => setCreating(false)}
      onSave={(name, icon) => {
        setCreating(false)
        void tasks.createBoard(name, icon).then((id) => { if (id) router.push({ pathname: '/tasks/board/[id]', params: { id } }) })
      }}
    />
    <TaskNotificationsSheet visible={notifications} onClose={() => setNotifications(false)} />
    <ArchivedBoards visible={archive} onClose={() => setArchive(false)} />
  </View>
}

export default function BoardsScreen(): React.ReactElement {
  return <TasksGate><Boards /></TasksGate>
}
