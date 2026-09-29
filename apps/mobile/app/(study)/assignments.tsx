import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CalendarCheck, TriangleAlert } from 'lucide-react-native'
import { Sheet } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { Checkbox } from '../../components/ui/checkbox'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { AssignmentDetail, AssignmentRow, useCourseColors } from '../../components/study/Assignment'
import { StudyGate } from '../../components/study/StudyGate'
import { useStudy } from '../../lib/study/context'
import {
  courseList, dayHeading, dueWithin, isDone, isOverdue, localDay, overdueCount, studySections, type StudySection,
  type StudyView
} from '../../lib/study/schedule'
import type { StudyItem } from '../../lib/study/store'
import { useBlurText } from '../../lib/blur'

const VIEW_OPTIONS = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }] as const

function updatedLabel(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return localDay(at) === localDay(new Date()) ? time : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function CourseChip({ label, tint, selected, personal = false, onPress }: {
  label: string
  tint?: string
  selected: boolean
  personal?: boolean
  onPress: () => void
}): React.ReactElement {
  const blur = useBlurText()
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    style={{ minHeight: 40 }}
    className={`flex-row items-center rounded-full border px-3.5 ${selected ? 'border-primary bg-primary' : 'border-surface-700 bg-surface-900 active:bg-surface-800'}`}
  >
    {tint && <View className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />}
    <Text
      className={`text-[14px] font-semibold ${selected ? 'text-primary-foreground' : 'text-surface-300'}`}
      style={personal ? blur(selected ? '#0a0a0a' : '#d4d4d4', 5) : undefined}
    >{label}</Text>
  </Pressable>
}

function AssignmentList(): React.ReactElement {
  const study = useStudy()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ course?: string }>()
  const [view, setView] = useState<StudyView>('upcoming')
  const [course, setCourse] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useFocusEffect(useCallback(() => setNow(new Date()), []))
  useEffect(() => setNow(new Date()), [study.items])

  useEffect(() => {
    if (!params.course) return
    setCourse(params.course)
    setView('upcoming')
    router.setParams({ course: undefined })
  }, [params.course, router])

  const tintOf = useCourseColors(study.items)
  const courses = useMemo(() => courseList(study.items), [study.items])
  const { hideOverdue, setHideOverdue } = study
  const sections = useMemo(
    () => studySections(study.items, view, now, { course, hideOverdue }),
    [course, hideOverdue, now, study.items, view])
  const overdue = overdueCount(study.items, now, course)
  const today = localDay(now)
  const thisWeek = dueWithin(study.items, now, 7)
  const waiting = study.items.filter((item) => item.pending).length
  const open = study.items.find((item) => item.id === openId) ?? null
  const setDone = study.setDone
  const toggle = useCallback((id: string, done: boolean) => void setDone(id, done), [setDone])

  const pull = async (): Promise<void> => {
    setPulling(true)
    await study.refresh()
    setPulling(false)
  }

  const heading = (section: StudySection): string => section.day === null ? 'Overdue' : dayHeading(section.day, today)
  const leftIn = (data: StudyItem[]): string => {
    const left = data.filter((item) => !isDone(item)).length
    return left === 0 ? 'All done' : `${left} left`
  }

  return <View className="flex-1 bg-surface-950">
    {study.error && <View className="min-h-11 flex-row items-start gap-2 bg-red-500/10 px-4 py-2">
      <TriangleAlert color="#fca5a5" size={15} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-[14px] leading-5 text-red-300">{study.error.message.replace(/\.$/, '')}. Showing the copy from {study.fetchedAt ? updatedLabel(study.fetchedAt) : 'earlier'}.</Text>
    </View>}
    <View className="px-4 pt-2">
      <SegmentedControl options={VIEW_OPTIONS} value={view} onValueChange={setView} />
    </View>
    {courses.length > 1 && <View className="flex-row flex-wrap gap-2 px-4 pt-2.5">
      <CourseChip label="All" selected={course === null} onPress={() => setCourse(null)} />
      {courses.map((code) => <CourseChip key={code} label={code} tint={tintOf(code)} selected={course === code} personal onPress={() => setCourse(course === code ? null : code)} />)}
    </View>}
    <View className="flex-row px-4 pt-1">
      <Checkbox
        checked={hideOverdue}
        onCheckedChange={setHideOverdue}
        label={overdue > 0 ? `Hide overdue (${overdue})` : 'Hide overdue'}
      />
    </View>
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor="#fafafa" colors={['#0a0a0a']} progressBackgroundColor="#fafafa" />}
      ListHeaderComponent={study.fetchedAt ? <Text accessibilityLiveRegion="polite" className="pt-3 text-[14px] text-surface-500">
        {view === 'upcoming' ? `${thisWeek} due in the next 7 days · ` : ''}Updated {updatedLabel(study.fetchedAt)}{study.refreshing ? ', checking Canvas' : ''}
        {waiting > 0 ? ` · ${waiting} ${waiting === 1 ? 'check mark' : 'check marks'} not synced` : ''}
      </Text> : null}
      ListEmptyComponent={<View className="items-center px-8 py-14">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><CalendarCheck color="#a3a3a3" size={30} /></View>
        <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">{view === 'upcoming' ? 'Nothing due' : 'Nothing earlier'}</Text>
        <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{view === 'upcoming'
          ? course ? `${course} has nothing coming up in Canvas.` : 'Canvas has no upcoming assignments. Pull down to check again.'
          : hideOverdue ? 'Unchecked past assignments are hidden. Clear Hide overdue to see them.' : 'Assignments show up here once their day has passed.'}</Text>
      </View>}
      renderSectionHeader={({ section }) => <View className="flex-row items-end justify-between bg-surface-950 pb-2 pt-5">
        <Text className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: section.day === null ? color.expense : section.day === today ? color.text : color.textMuted }}>
          {heading(section)}
        </Text>
        <Text className="text-[14px] font-semibold text-surface-500">{leftIn(section.data)}</Text>
      </View>}
      renderItem={({ item, index, section }) => <View className={`overflow-hidden border-x border-surface-800 ${index === 0 ? 'rounded-t-2xl' : ''} ${index === section.data.length - 1 ? 'rounded-b-2xl border-b' : ''}`}>
        <AssignmentRow
          item={item}
          tint={tintOf(item.course)}
          overdue={isOverdue(item, now)}
          showDay={section.day === null}
          onToggle={toggle}
          onOpen={setOpenId}
        />
      </View>}
    />
    <Sheet visible={open !== null} title={open?.title ?? ''} onClose={() => setOpenId(null)} dismissOnBackdrop privateTitle>
      {open && <AssignmentDetail item={open} tint={tintOf(open.course)} overdue={isOverdue(open, now)} onToggle={(done) => void setDone(open.id, done)} />}
    </Sheet>
  </View>
}

export default function Assignments(): React.ReactElement {
  return <StudyGate><AssignmentList /></StudyGate>
}
