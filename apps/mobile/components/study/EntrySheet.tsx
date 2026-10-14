import React, { useEffect, useState } from 'react'
import { Switch, Text, TextInput, View } from 'react-native'
import { CalendarDays } from 'lucide-react-native'
import type { StudyEntryRecord } from '@ego/api-contracts'
import {
  STUDY_COURSE_LIMIT, STUDY_ENTRY_KINDS, STUDY_ENTRY_KIND_LABELS, STUDY_NOTES_LIMIT, STUDY_TITLE_LIMIT,
  type StudyEntryInput, type StudyEntryKind
} from '@ego/core'
import { formatIso, isoToday, shiftIso } from '@ego/local/dates'
import { studyDraft, studyEntryFromDraft, type StudyEntryDraft } from '@ego/local/study/draft'
import { courseKey } from '@ego/local/study/schedule'
import { Sheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { Heading, MERIDIEMS, Option, TIME_PRESETS, draftOf, presetLabel, timeOf, type ClockDraft } from '../tasks/sheets'
import { Button } from '../ui/button'
import { SegmentedControl } from '../ui/segmented-control'
import { Text as UiText } from '../ui/text'

const KIND_OPTIONS = STUDY_ENTRY_KINDS.map((kind) => ({ value: kind, label: STUDY_ENTRY_KIND_LABELS[kind] }))
const PLACEHOLDERS: Record<StudyEntryKind, string> = {
  assignment: 'Problem set 4',
  exam: 'Midterm 2',
  deadline: 'Last day to withdraw'
}

/** Adds an assignment, exam, or deadline beside Canvas's, or edits one added before. */
export function StudyEntrySheet({ visible, entry, courses, onSave, onClose }: {
  visible: boolean
  /** Null adds a new one. */
  entry: StudyEntryRecord | null
  courses: readonly string[]
  onSave: (input: StudyEntryInput) => Promise<boolean>
  onClose: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<StudyEntryDraft>(() => studyDraft(entry, isoToday()))
  const [timed, setTimed] = useState(draft.time !== null)
  const [clock, setClock] = useState<ClockDraft>(() => draftOf(draft.time))
  const [calendar, setCalendar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!visible) return
    const next = studyDraft(entry, isoToday())
    setDraft(next)
    setTimed(next.time !== null)
    setClock(draftOf(next.time))
    setSaving(false)
    setFailed(false)
  }, [entry, visible])

  const today = isoToday()
  const time = timed ? timeOf(clock) : null
  const input = timed && time === null ? null : studyEntryFromDraft({ ...draft, time }, courses, entry?.doneAt ?? null)
  const days = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: shiftIso(today, 1) },
    { label: 'Next week', date: shiftIso(today, 7) }
  ]
  const picked = !days.some((day) => day.date === draft.date)
  const typedKey = courseKey(draft.course)
  const patch = (change: Partial<StudyEntryDraft>): void => setDraft((current) => ({ ...current, ...change }))
  const digits = (text: string): string => text.replace(/\D/g, '')

  const save = async (): Promise<void> => {
    if (!input || saving) return
    setSaving(true)
    setFailed(false)
    const saved = await onSave(input)
    setSaving(false)
    if (saved) onClose()
    else setFailed(true)
  }

  return <Sheet visible={visible} title={entry ? `Edit ${STUDY_ENTRY_KIND_LABELS[draft.kind].toLowerCase()}` : 'Add to Study'} onClose={onClose}>
    <SegmentedControl options={KIND_OPTIONS} value={draft.kind} onValueChange={(kind) => patch({ kind })} />
    <Heading>Title</Heading>
    <TextInput
      value={draft.title}
      onChangeText={(title) => patch({ title })}
      accessibilityLabel="Title"
      placeholder={PLACEHOLDERS[draft.kind]}
      placeholderTextColor="#737373"
      maxLength={STUDY_TITLE_LIMIT}
      autoFocus={entry === null}
      returnKeyType="done"
      className={inputClass}
    />
    <Heading>Course</Heading>
    <TextInput
      value={draft.course}
      onChangeText={(course) => patch({ course })}
      accessibilityLabel="Course"
      placeholder="None"
      placeholderTextColor="#737373"
      maxLength={STUDY_COURSE_LIMIT}
      autoCapitalize="characters"
      autoCorrect={false}
      className={inputClass}
    />
    {courses.length > 0 && <View className="mt-2 flex-row flex-wrap gap-2">
      {courses.map((course) => {
        const selected = courseKey(course) === typedKey
        return <Option key={course} label={course} selected={selected} onPress={() => patch({ course: selected ? '' : course })} />
      })}
    </View>}
    <Heading>{draft.kind === 'exam' ? 'Day' : 'Due'}</Heading>
    <View className="flex-row flex-wrap gap-2">
      {days.map((day) => <Option key={day.label} label={day.label} selected={draft.date === day.date} onPress={() => patch({ date: day.date })} />)}
      <Option label={picked ? formatIso(draft.date) : 'Pick a day'} selected={picked} onPress={() => setCalendar(true)}>
        <CalendarDays color={picked ? '#0a0a0a' : '#fafafa'} size={17} />
      </Option>
    </View>
    <View className="mt-5 flex-row items-center">
      <View className="flex-1">
        <Text className="text-[17px] font-medium text-foreground">At a time</Text>
        {!timed && <Text className="text-[14px] text-muted-foreground">{draft.kind === 'exam' ? 'Off, it takes the whole day' : 'Off, it is due at 11:59 PM'}</Text>}
      </View>
      <Switch
        accessibilityLabel="At a time"
        value={timed}
        onValueChange={setTimed}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={timed ? '#0a0a0a' : '#d4d4d4'}
        ios_backgroundColor="#404040"
      />
    </View>
    {timed && <>
      <View className="mt-3 flex-row items-center gap-2">
        <TextInput
          value={clock.hour}
          onChangeText={(hour) => setClock({ ...clock, hour: digits(hour) })}
          accessibilityLabel="Hour"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <Text className="text-[20px] font-bold text-foreground">:</Text>
        <TextInput
          value={clock.minute}
          onChangeText={(minute) => setClock({ ...clock, minute: digits(minute) })}
          accessibilityLabel="Minute"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {TIME_PRESETS.map((preset) => <Option key={preset} label={presetLabel(preset)} selected={time === preset} onPress={() => setClock(draftOf(preset))} />)}
      </View>
      {time === null && <Text className="mt-2 text-[14px] text-destructive">Enter a time like 5:30.</Text>}
    </>}
    <Heading>Notes</Heading>
    <TextInput
      value={draft.notes}
      onChangeText={(notes) => patch({ notes })}
      accessibilityLabel="Notes"
      placeholder="Room, topics, what to bring"
      placeholderTextColor="#737373"
      multiline
      maxLength={STUDY_NOTES_LIMIT}
      className={`${inputClass} min-h-[96px]`}
      style={{ textAlignVertical: 'top' }}
    />
    {failed && <Text className="mt-4 text-[14px] text-destructive">This phone could not save that. Try again.</Text>}
    <Button size="lg" className="mt-6" disabled={!input || saving} onPress={() => void save()}><UiText>{entry ? 'Save' : 'Add'}</UiText></Button>
    <CalendarDialog visible={calendar} value={draft.date} onCancel={() => setCalendar(false)} onConfirm={(iso) => {
      patch({ date: iso })
      setCalendar(false)
    }} />
  </Sheet>
}
