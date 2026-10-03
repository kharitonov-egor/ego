import React, { useLayoutEffect, useMemo } from 'react'
import { Pressable, SectionList, Text, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { CalendarCheck, Circle, CircleCheck } from 'lucide-react-native'
import type { TaskCardRecord } from '@ego/api-contracts'
import { DueChip, PriorityIcon, TasksError, TasksGate, TasksHeaderRight, TasksMessage } from '../../../components/tasks/ui'
import { Blurred } from '../../../lib/blur'
import { UPCOMING_TITLES, dueBadge, upcomingSections } from '@ego/local/tasks/board'
import { useTasks } from '../../../lib/tasks/context'

function Row({ card }: { card: TaskCardRecord }): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const board = tasks.data?.boards.find((item) => item.id === card.boardId)
  const list = tasks.data?.lists.find((item) => item.id === card.listId)
  const due = dueBadge(card, tasks.now)
  const done = card.doneAt !== null
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Opens the card"
    onPress={() => router.push({ pathname: '/tasks/card/[id]', params: { id: card.id } })}
    className="min-h-[68px] flex-row items-center border-t border-surface-800 bg-card py-2 pr-4 active:bg-surface-900"
  >
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? 'Mark as not done' : 'Mark as done'}
      onPress={() => void tasks.updateCard(card.id, (input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
      className="h-14 w-14 items-center justify-center"
    >{done ? <CircleCheck color="#0a0a0a" fill="#fafafa" size={22} /> : <Circle color="#525252" size={22} />}</Pressable>
    <View className="flex-1">
      <Blurred tint={done ? '#737373' : '#f5f5f5'}><Text numberOfLines={2} className={`text-[16px] font-semibold ${done ? 'text-surface-500' : 'text-surface-100'}`}>{card.title}</Text></Blurred>
      <Blurred tint="#a3a3a3"><Text numberOfLines={1} className="mt-0.5 text-[13px] text-surface-400">{[board?.icon, board?.name].filter(Boolean).join(' ')}{list ? ` · ${list.name}` : ''}</Text></Blurred>
    </View>
    <View className="ml-3 items-end gap-1.5">
      {due && <DueChip due={due} />}
      <PriorityIcon priority={card.priority} />
    </View>
  </Pressable>
}

function Upcoming(): React.ReactElement {
  const tasks = useTasks()
  const sections = useMemo(() => tasks.data ? upcomingSections(tasks.data, tasks.now) : [], [tasks.data, tasks.now])
  if (sections.length === 0) {
    return <TasksMessage Icon={CalendarCheck} title="Nothing due" detail="Cards with a due date show here from every board, soonest first, until they are done." />
  }
  return <View className="flex-1 bg-surface-950">
    <TasksError />
    <SectionList
      sections={sections}
      keyExtractor={(card) => card.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => <View className="flex-row items-baseline px-4 pb-2 pt-5">
        <Text className={`flex-1 text-[15px] font-semibold uppercase tracking-wide ${section.key === 'overdue' ? 'text-red-400' : 'text-surface-400'}`}>{UPCOMING_TITLES[section.key]}</Text>
        <Text className="text-[14px] text-surface-500">{section.data.length}</Text>
      </View>}
      renderItem={({ item }) => <Row card={item} />}
      renderSectionFooter={() => <View className="border-t border-surface-800" />}
      contentContainerStyle={{ paddingBottom: 32 }}
    />
  </View>
}

export default function UpcomingScreen(): React.ReactElement {
  const navigation = useNavigation()
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => <TasksHeaderRight /> })
  }, [navigation])
  return <TasksGate><Upcoming /></TasksGate>
}
