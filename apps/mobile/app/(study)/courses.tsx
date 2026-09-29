import React, { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BookOpen } from 'lucide-react-native'
import { color, tabular } from '../../components/money/tokens'
import { useCourseColors } from '../../components/study/Assignment'
import { StudyGate, StudyMessage } from '../../components/study/StudyGate'
import { useStudy } from '../../lib/study/context'
import { courseSummaries, dueDay, shortDay, type CourseSummary } from '../../lib/study/schedule'
import { BlurSpan, Blurred } from '../../lib/blur'

function CourseCard({ summary, tint, showOverdue, onPress }: {
  summary: CourseSummary
  tint: string
  showOverdue: boolean
  onPress: () => void
}): React.ReactElement {
  const next = summary.next
  const overdue = showOverdue && summary.overdue > 0
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${summary.course}, ${summary.left} left${overdue ? `, ${summary.overdue} overdue` : ''}`}
    accessibilityHint="Shows this course's assignments"
    onPress={onPress}
    className="w-full rounded-3xl border border-border bg-card p-4 active:bg-surface-900"
  >
    <View className="flex-row items-center">
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: tint }}>
        <BookOpen color="#ffffff" size={19} />
      </View>
      <Blurred tint="#f5f5f5"><Text numberOfLines={1} className="ml-3 flex-1 text-[19px] font-bold text-surface-100">{summary.course}</Text></Blurred>
      <View className="items-end">
        <Text className="text-[22px] font-bold text-surface-50" style={tabular}>{summary.left}</Text>
        <Text className="text-[14px] text-surface-400">left</Text>
      </View>
    </View>
    <View className="mt-3 border-t border-surface-800 pt-3">
      {next
        ? <Text numberOfLines={1} className="text-[15px] text-surface-300">Next: <Text className="font-semibold text-surface-100"><BlurSpan tint="#f5f5f5">{next.title}</BlurSpan></Text> · {shortDay(dueDay(next))}</Text>
        : <Text className="text-[15px] text-surface-400">Nothing coming up</Text>}
      {overdue && <Text className="mt-1 text-[14px] font-semibold" style={{ color: color.expense }}>{summary.overdue} overdue</Text>}
    </View>
  </Pressable>
}

function CourseList(): React.ReactElement {
  const study = useStudy()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [now, setNow] = useState(() => new Date())
  useFocusEffect(useCallback(() => setNow(new Date()), []))
  const tintOf = useCourseColors(study.items)
  const summaries = useMemo(() => courseSummaries(study.items, now), [now, study.items])
  if (summaries.length === 0) {
    return <StudyMessage title="No courses yet" detail="Courses appear once Canvas lists an assignment for them." />
  }
  const left = summaries.reduce((sum, summary) => sum + summary.left, 0)
  return <ScrollView className="flex-1 bg-surface-950" contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom, gap: 12 }}>
    <View className="pb-1">
      <Text className="text-[20px] font-semibold text-surface-100">{summaries.length} {summaries.length === 1 ? 'course' : 'courses'}</Text>
      <Text className="mt-0.5 text-[14px] text-surface-400">{left} assignments left this term · Tap a course for its list</Text>
    </View>
    {summaries.map((summary) => <CourseCard
      key={summary.course}
      summary={summary}
      tint={tintOf(summary.course)}
      showOverdue={!study.hideOverdue}
      onPress={() => router.push({ pathname: '/(study)/assignments', params: { course: summary.course } })}
    />)}
  </ScrollView>
}

export default function Courses(): React.ReactElement {
  return <StudyGate><CourseList /></StudyGate>
}
