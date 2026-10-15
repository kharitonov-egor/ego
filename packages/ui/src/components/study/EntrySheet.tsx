import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { StudyEntryRecord } from '@ego/api-contracts'
import {
  STUDY_COURSE_LIMIT, STUDY_ENTRY_KINDS, STUDY_ENTRY_KIND_LABELS, STUDY_NOTES_LIMIT, STUDY_TITLE_LIMIT,
  type StudyEntryInput, type StudyEntryKind
} from '@ego/core'
import { formatIso, isoToday, shiftIso } from '@ego/local/dates'
import { studyDraft, studyEntryFromDraft, type StudyEntryDraft } from '@ego/local/study/draft'
import { courseKey } from '@ego/local/study/schedule'
import { cn } from '../../lib/utils'
import { CalendarDialog } from '../DatePicker'
import { Heading, MERIDIEMS, Option, TIME_PRESETS, draftOf, presetLabel, timeOf, type ClockDraft } from '../tasks/sheets'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { Switch } from '../ui/switch'

const KIND_OPTIONS = STUDY_ENTRY_KINDS.map((kind) => ({ value: kind, label: STUDY_ENTRY_KIND_LABELS[kind] }))
const PLACEHOLDERS: Record<StudyEntryKind, string> = {
  assignment: 'Problem set 4',
  exam: 'Midterm 2',
  deadline: 'Last day to withdraw'
}

/** Adds an assignment, exam, or deadline beside Canvas's, or edits one added before. */
export function StudyEntrySheet({ visible, entry, course = '', courses, onSave, onClose }: {
  visible: boolean
  /** Null adds a new one. */
  entry: StudyEntryRecord | null
  /** The course a new one starts in. */
  course?: string
  courses: readonly string[]
  onSave: (input: StudyEntryInput) => Promise<boolean>
  onClose: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<StudyEntryDraft>(() => studyDraft(entry, isoToday(), course))
  const [timed, setTimed] = useState(draft.time !== null)
  const [clock, setClock] = useState<ClockDraft>(() => draftOf(draft.time))
  const [calendar, setCalendar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!visible) return
    const next = studyDraft(entry, isoToday(), course)
    setDraft(next)
    setTimed(next.time !== null)
    setClock(draftOf(next.time))
    setSaving(false)
    setFailed(false)
  }, [course, entry, visible])

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
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void save()
  }

  return <Sheet
    visible={visible}
    title={entry ? `Edit ${STUDY_ENTRY_KIND_LABELS[draft.kind].toLowerCase()}` : 'Add to Study'}
    onClose={onClose}
    footer={<>
      {failed && <p className="mb-3 text-[14px] text-destructive">This computer could not save that. Try again.</p>}
      <Button size="lg" className="w-full" disabled={!input || saving} onClick={() => void save()}>{entry ? 'Save' : 'Add'}</Button>
    </>}
  >
    <SegmentedControl options={KIND_OPTIONS} value={draft.kind} onValueChange={(kind) => patch({ kind })} />
    <Heading>Title</Heading>
    <input
      value={draft.title}
      onChange={(event) => patch({ title: event.target.value })}
      onKeyDown={submitOnEnter}
      aria-label="Title"
      placeholder={PLACEHOLDERS[draft.kind]}
      maxLength={STUDY_TITLE_LIMIT}
      autoFocus
      className={inputClass}
    />
    <Heading>Course</Heading>
    <input
      value={draft.course}
      onChange={(event) => patch({ course: event.target.value })}
      onKeyDown={submitOnEnter}
      aria-label="Course"
      placeholder="None"
      maxLength={STUDY_COURSE_LIMIT}
      autoComplete="off"
      spellCheck={false}
      className={inputClass}
    />
    {courses.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {courses.map((course) => {
        const selected = courseKey(course) === typedKey
        return <Option key={course} label={course} selected={selected} onPress={() => patch({ course: selected ? '' : course })} />
      })}
    </div>}
    <Heading>{draft.kind === 'exam' ? 'Day' : 'Due'}</Heading>
    <div className="flex flex-wrap gap-2">
      {days.map((day) => <Option key={day.label} label={day.label} selected={draft.date === day.date} onPress={() => patch({ date: day.date })} />)}
      <Option label={picked ? formatIso(draft.date) : 'Pick a day'} selected={picked} onPress={() => setCalendar(true)}>
        <CalendarDays color={picked ? '#0a0a0a' : '#fafafa'} size={17} />
      </Option>
    </div>
    <div className="mt-5 flex items-center">
      <span className="flex-1">
        <span className="block text-[17px] font-medium text-foreground">At a time</span>
        {!timed && <span className="block text-[14px] text-muted-foreground">{draft.kind === 'exam' ? 'Off, it takes the whole day' : 'Off, it is due at 11:59 PM'}</span>}
      </span>
      <Switch label="At a time" checked={timed} onCheckedChange={setTimed} />
    </div>
    {timed && <>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={clock.hour}
          onChange={(event) => setClock({ ...clock, hour: digits(event.target.value) })}
          onFocus={(event) => event.target.select()}
          onKeyDown={submitOnEnter}
          aria-label="Hour"
          inputMode="numeric"
          maxLength={2}
          className={cn(inputClass, 'w-16 text-center tabular')}
        />
        <span className="text-[20px] font-bold text-foreground">:</span>
        <input
          value={clock.minute}
          onChange={(event) => setClock({ ...clock, minute: digits(event.target.value) })}
          onFocus={(event) => event.target.select()}
          onKeyDown={submitOnEnter}
          aria-label="Minute"
          inputMode="numeric"
          maxLength={2}
          className={cn(inputClass, 'w-16 text-center tabular')}
        />
        <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {TIME_PRESETS.map((preset) => <Option key={preset} label={presetLabel(preset)} selected={time === preset} onPress={() => setClock(draftOf(preset))} />)}
      </div>
      {time === null && <p className="mt-2 text-[14px] text-destructive">Enter a time like 5:30.</p>}
    </>}
    <Heading>Notes</Heading>
    <textarea
      value={draft.notes}
      onChange={(event) => patch({ notes: event.target.value })}
      aria-label="Notes"
      placeholder="Room, topics, what to bring"
      rows={3}
      maxLength={STUDY_NOTES_LIMIT}
      className={cn(inputClass, 'resize-y text-[15px] leading-6')}
    />
    <CalendarDialog visible={calendar} value={draft.date} onCancel={() => setCalendar(false)} onConfirm={(iso) => {
      patch({ date: iso })
      setCalendar(false)
    }} />
  </Sheet>
}
