import React, { memo, useMemo } from 'react'
import { Linking, Pressable, Text, View } from 'react-native'
import { Check, ExternalLink } from 'lucide-react-native'
import type { StudyItem } from '../../lib/study/store'
import { courseColors, courseList, dueClock, dueSentence, isDone, shortDay, dueDay } from '../../lib/study/schedule'
import { COLORS } from '../money/Common'
import { ROW_MIN_HEIGHT, color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

const NO_COURSE = '#525252'

export function useCourseColors(items: StudyItem[]): (course: string | null) => string {
  const courses = useMemo(() => courseList(items), [items])
  return useMemo(() => {
    const colors = courseColors(courses, COLORS)
    return (course: string | null) => (course ? colors.get(course) : undefined) ?? NO_COURSE
  }, [courses])
}

export function DoneToggle({ done, tint, title, onToggle }: {
  done: boolean
  tint: string
  title: string
  onToggle: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: done }}
    accessibilityLabel={title}
    accessibilityHint={done ? 'Marks it as not done' : 'Marks it as done'}
    onPress={onToggle}
    hitSlop={4}
    className="h-14 w-14 items-center justify-center"
  >
    <View
      className="h-7 w-7 items-center justify-center rounded-full border-2"
      style={done ? { backgroundColor: tint, borderColor: tint } : { borderColor: tint }}
    >{done && <Check color="#ffffff" size={16} strokeWidth={3} />}</View>
  </Pressable>
}

/** Inside a day the right column is the time. In the overdue group it is the day, since that group spans several. */
export const AssignmentRow = memo(function AssignmentRow({ item, tint, overdue, showDay, onToggle, onOpen }: {
  item: StudyItem
  tint: string
  overdue: boolean
  showDay: boolean
  onToggle: (id: string, done: boolean) => void
  onOpen: (id: string) => void
}): React.ReactElement {
  const done = isDone(item)
  const when = showDay ? shortDay(dueDay(item)) : dueClock(item)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${item.title}${item.course ? `, ${item.course}` : ''}, ${dueSentence(item)}${done ? ', done' : overdue ? ', overdue' : ''}`}
    accessibilityHint="Opens the details"
    onPress={() => onOpen(item.id)}
    android_ripple={{ color: 'rgba(255, 255, 255, 0.08)' }}
    style={{ minHeight: ROW_MIN_HEIGHT + 8 }}
    className="flex-row items-center border-t border-surface-800 bg-card py-1.5 pr-4"
  >
    <DoneToggle done={done} tint={tint} title={item.title} onToggle={() => onToggle(item.id, !done)} />
    <View className="flex-1">
      <Text numberOfLines={2} className={`text-[17px] font-semibold ${done ? 'text-surface-500 line-through' : 'text-surface-100'}`}>{item.title}</Text>
      {item.course && <View className="mt-0.5 flex-row items-center">
        <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />
        <Text numberOfLines={1} className="text-[14px] text-surface-400">{item.course}</Text>
      </View>}
    </View>
    <Text
      className="ml-3 text-[15px] font-semibold"
      style={{ ...tabular, color: overdue ? color.expense : done ? color.textFaint : color.textSecondary }}
    >{when}</Text>
  </Pressable>
})

export function AssignmentDetail({ item, tint, overdue, onToggle }: {
  item: StudyItem
  tint: string
  overdue: boolean
  onToggle: (done: boolean) => void
}): React.ReactElement {
  const done = isDone(item)
  return <View>
    <View className="flex-row flex-wrap items-center gap-2">
      {item.course && <View className="flex-row items-center rounded-full bg-surface-900 px-3 py-1.5">
        <View className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />
        <Text className="text-[14px] font-semibold text-surface-200">{item.course}</Text>
      </View>}
      {overdue && <View className="rounded-full bg-red-500/15 px-3 py-1.5"><Text className="text-[14px] font-semibold text-red-300">Overdue</Text></View>}
      {done && <View className="rounded-full bg-positive/15 px-3 py-1.5"><Text className="text-[14px] font-semibold text-positive">Done</Text></View>}
    </View>
    <Text className="mt-3 text-[17px] font-semibold text-surface-100" style={tabular}>{dueSentence(item)}</Text>
    {item.pending && <Text className="mt-1 text-[14px] text-surface-400">Saved on this phone. The server gets it on the next sync.</Text>}
    {item.description.length > 0 && <Text selectable className="mt-4 text-[16px] leading-6 text-surface-300">{item.description}</Text>}
    <Button size="lg" onPress={() => onToggle(!done)} className="mt-6"><UiText>{done ? 'Mark as not done' : 'Mark as done'}</UiText></Button>
    {item.url && <Button variant="outline" size="lg" onPress={() => void Linking.openURL(item.url ?? '')} className="mt-3">
      <ExternalLink color="#fafafa" size={18} />
      <UiText>Open in Canvas</UiText>
    </Button>}
  </View>
}
