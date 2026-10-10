import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Circle, CircleCheck, Clock, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react-native'
import {
  courseKey, courseList, dayHeading, dueClock, dueDay, dueWithin, isDone, isOverdue, localDay, overdueCount, shortDay,
  studySections, type StudySection, type StudyView
} from '@ego/local/study/schedule'
import type { StudyItem } from '@ego/local/study/store'
import { BottomSheet } from '../money/Common'
import { color, tabular } from '../money/tokens'
import { AssignmentDetail, useCourseColors } from '../study/Assignment'
import { Blurred } from '../../lib/blur'
import { useStudy } from '../../lib/study/context'

export const USF_GREEN = '#006747'

export interface UsfFilter {
  course: string | null
  view: StudyView
}

export const NO_USF_FILTER: UsfFilter = { course: null, view: 'upcoming' }

/** A card of your own joins a course when one of its labels is named after the course code. */
export function inCourse(labelNames: readonly string[], course: string): boolean {
  const key = courseKey(course)
  return labelNames.some((name) => courseKey(name) === key)
}

function updatedLabel(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return localDay(at) === localDay(new Date()) ? time : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

export function UsfRefresh(): React.ReactElement {
  const study = useStudy()
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Check Canvas"
    disabled={study.refreshing}
    onPress={() => void study.refresh()}
    hitSlop={6}
    className="h-11 w-9 items-center justify-center"
  >
    {study.refreshing ? <ActivityIndicator color="#ffffff" size="small" /> : <RefreshCw color="#ffffff" size={17} />}
  </Pressable>
}

function Pill({ label, selected, tint, onPress }: {
  label: string
  selected: boolean
  tint?: string
  onPress: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    className={`h-8 flex-row items-center rounded-full border px-3 ${selected ? 'border-white bg-white' : 'border-surface-700 active:bg-surface-800'}`}
  >
    {tint && <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />}
    <Blurred active={tint !== undefined} tint={selected ? '#0a0a0a' : '#d4d4d4'}>
      <Text className={`text-[13px] font-semibold ${selected ? 'text-black' : 'text-surface-300'}`}>{label}</Text>
    </Blurred>
  </Pressable>
}

/** Course chips, Upcoming or Past, and Hide overdue, between the header and the cards. */
export function UsfControls({ filter, onChange, now }: {
  filter: UsfFilter
  onChange: (filter: UsfFilter) => void
  now: Date
}): React.ReactElement {
  const study = useStudy()
  const tintOf = useCourseColors(study.items)
  const courses = useMemo(() => courseList(study.items), [study.items])
  const overdue = overdueCount(study.items, now, filter.course)
  const thisWeek = dueWithin(study.items, now, 7)
  const waiting = study.items.filter((item) => item.pending).length
  return <View className="px-2 pb-1 pt-2">
    {courses.length > 0 && <View className="flex-row flex-wrap gap-1.5">
      <Pill label="All" selected={filter.course === null} onPress={() => onChange({ ...filter, course: null })} />
      {courses.map((course) => <Pill
        key={course}
        label={course}
        tint={tintOf(course)}
        selected={filter.course === course}
        onPress={() => onChange({ ...filter, course: filter.course === course ? null : course })}
      />)}
    </View>}
    <View className="mt-1.5 flex-row flex-wrap gap-1.5">
      <Pill label="Upcoming" selected={filter.view === 'upcoming'} onPress={() => onChange({ ...filter, view: 'upcoming' })} />
      <Pill label="Past" selected={filter.view === 'past'} onPress={() => onChange({ ...filter, view: 'past' })} />
      <Pill label={overdue > 0 ? `Hide overdue (${overdue})` : 'Hide overdue'} selected={study.hideOverdue} onPress={() => study.setHideOverdue(!study.hideOverdue)} />
    </View>
    {study.fetchedAt && <Text className="mt-1.5 px-0.5 text-[12px] leading-4 text-surface-500">
      {thisWeek} due this week · Updated {updatedLabel(study.fetchedAt)}{study.refreshing ? ', checking Canvas' : ''}
      {waiting > 0 ? ` · ${waiting} not synced` : ''}
    </Text>}
    {study.error && study.fetchedAt && <View className="mt-1 flex-row items-start px-0.5">
      <TriangleAlert color="#fca5a5" size={12} style={{ marginTop: 2, marginRight: 4 }} />
      <Text className="flex-1 text-[12px] leading-4 text-red-300">{study.error.message.replace(/\.$/, '')}. Showing the saved copy.</Text>
    </View>}
  </View>
}

function AssignmentCard({ item, tint, now, showDay, onToggle, onOpen }: {
  item: StudyItem
  tint: string
  now: Date
  showDay: boolean
  onToggle: (id: string, done: boolean) => void
  onOpen: (id: string) => void
}): React.ReactElement {
  const done = isDone(item)
  const overdue = isOverdue(item, now)
  const when = showDay ? `${shortDay(dueDay(item))}, ${dueClock(item)}` : dueClock(item)
  const tone = overdue ? color.expense : done ? color.textFaint : color.textMuted
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${item.title}${item.course ? `, ${item.course}` : ''}, due ${when}${done ? ', done' : overdue ? ', overdue' : ''}`}
    accessibilityHint="Opens the details"
    onPress={() => onOpen(item.id)}
    className="rounded-xl border border-surface-800 bg-card px-3 py-2.5 active:opacity-80"
  >
    {item.course && <View className="mb-1.5 flex-row">
      <View className="flex-row items-center rounded-full bg-surface-800 px-2 py-0.5">
        <View className="mr-[5px] h-[7px] w-[7px] rounded-full" style={{ backgroundColor: tint }} />
        <Blurred tint="#e5e5e5"><Text numberOfLines={1} className="text-[12px] font-semibold text-surface-200">{item.course}</Text></Blurred>
      </View>
    </View>}
    <View className="flex-row items-start">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? 'Mark as not done' : 'Mark as done'}
        onPress={() => onToggle(item.id, !done)}
        hitSlop={10}
        className="mr-2 mt-0.5"
      >{done ? <CircleCheck color="#0a0a0a" fill={tint} size={18} /> : <Circle color={tint} size={18} />}</Pressable>
      <Blurred tint={done ? '#737373' : '#f5f5f5'}>
        <Text className={`flex-1 text-[15px] leading-5 ${done ? 'text-surface-500 line-through' : 'text-surface-100'}`}>{item.title}</Text>
      </Blurred>
    </View>
    <View className="mt-2 flex-row items-center">
      <Clock color={tone} size={13} />
      <Text className="ml-1 text-[12px] font-semibold" style={{ ...tabular, color: tone }}>{when}</Text>
      {item.pending && <CloudUpload color={tone} size={13} style={{ marginLeft: 6 }} accessibilityLabel="Not synced yet" />}
    </View>
  </Pressable>
}

function ColumnNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View className="items-center px-3 py-4">{children}</View>
}

/** The Canvas assignments, after the column's own cards, grouped by day the way Study groups them. */
export function UsfAssignments({ filter, now }: { filter: UsfFilter; now: Date }): React.ReactElement {
  const study = useStudy()
  const tintOf = useCourseColors(study.items)
  const [openId, setOpenId] = useState<string | null>(null)
  const { hideOverdue, setDone } = study
  const sections = useMemo(
    () => studySections(study.items, filter.view, now, { course: filter.course, hideOverdue }),
    [filter.course, filter.view, hideOverdue, now, study.items])
  const toggle = useCallback((id: string, done: boolean) => void setDone(id, done), [setDone])
  const open = study.items.find((item) => item.id === openId) ?? null
  const today = localDay(now)
  const heading = (section: StudySection): string => section.day === null ? 'Overdue' : dayHeading(section.day, today)

  let body: React.ReactNode
  if (!study.loaded || (study.fetchedAt === null && (study.refreshing || !study.error))) {
    body = <ColumnNote>
      <ActivityIndicator color="#fafafa" />
      <Text className="mt-2 text-[13px] text-surface-400">Reading your Canvas calendar</Text>
    </ColumnNote>
  } else if (study.fetchedAt === null && study.error) {
    body = <ColumnNote>
      <Text className="text-center text-[13px] leading-5 text-surface-400">{study.error.code === 'NOT_CONFIGURED'
        ? 'Canvas is not connected. Put the Calendar Feed link in the Worker secret CANVAS_CALENDAR_URL.'
        : study.error.code === 'OFFLINE' ? 'Canvas needs a connection for the first download.' : study.error.message}</Text>
      <Pressable accessibilityRole="button" onPress={() => void study.refresh()} className="mt-3 rounded-lg bg-surface-800 px-4 py-2 active:opacity-80">
        <Text className="text-[14px] font-semibold text-white">Try again</Text>
      </Pressable>
    </ColumnNote>
  } else if (sections.length === 0) {
    body = <ColumnNote>
      <Text className="text-center text-[13px] text-surface-400">{filter.view === 'upcoming'
        ? filter.course ? `${filter.course} has nothing coming up in Canvas.` : 'Nothing due in Canvas.'
        : 'Nothing earlier.'}</Text>
    </ColumnNote>
  } else {
    body = sections.map((section) => <React.Fragment key={section.key}>
      <Text
        className="px-1 pt-1 text-[13px] font-semibold"
        style={{ color: section.day === null ? color.expense : section.day === today ? color.text : color.textMuted }}
      >{heading(section)}</Text>
      {section.data.map((item) => <AssignmentCard
        key={item.id}
        item={item}
        tint={tintOf(item.course)}
        now={now}
        showDay={section.day === null}
        onToggle={toggle}
        onOpen={setOpenId}
      />)}
    </React.Fragment>)
  }

  return <>
    {body}
    <BottomSheet visible={open !== null} title={open?.title ?? ''} onClose={() => setOpenId(null)} dismissOnBackdrop privateTitle>
      {open && <AssignmentDetail item={open} tint={tintOf(open.course)} overdue={isOverdue(open, now)} onToggle={(done) => void setDone(open.id, done)} />}
    </BottomSheet>
  </>
}
