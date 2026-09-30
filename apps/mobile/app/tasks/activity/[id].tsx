import React, { useMemo } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityRow, type ActivityEntry } from '../../../components/tasks/ActivityList'
import { TasksGate } from '../../../components/tasks/ui'
import { useTasks } from '../../../lib/tasks/context'

/** Every card's log on one board, newest first, the way Trello's board menu shows it. */
function BoardActivity({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const entries = useMemo<ActivityEntry[]>(() => (tasks.data?.cards ?? [])
    .filter((card) => card.boardId === boardId)
    .flatMap((card) => card.activity.map((entry) => ({ ...entry, cardTitle: card.title, cardId: card.id })))
    .sort((left, right) => right.at.localeCompare(left.at)), [boardId, tasks.data])
  if (entries.length === 0) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[16px] leading-6 text-surface-400">Nothing has happened on this board yet.</Text>
    </View>
  }
  return <FlatList
    className="flex-1 bg-surface-950"
    data={entries}
    keyExtractor={(entry, index) => `${entry.cardId ?? ''}-${entry.at}-${index}`}
    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
    renderItem={({ item }) => <ActivityRow entry={item} now={tasks.now} onOpenCard={(id) => router.push({ pathname: '/tasks/card/[id]', params: { id } })} />}
  />
}

export default function ActivityScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TasksGate><BoardActivity boardId={id} /></TasksGate>
}
