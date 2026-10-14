import type { StudyEntryRecord } from '@ego/api-contracts'
import { STUDY_COURSE_LIMIT, isStudyEntryInput, type StudyEntryInput, type StudyEntryKind } from '@ego/core'
import { parseIso } from '../dates'
import { courseFor, localDay } from './schedule'

/** What the editor holds. `time` is 24-hour HH:MM on this device's clock, or null for the whole day. */
export interface StudyEntryDraft {
  kind: StudyEntryKind
  title: string
  course: string
  date: string
  time: string | null
  notes: string
}

function clockOf(instant: Date): string {
  return `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`
}

export function studyDraft(entry: StudyEntryRecord | null, today: string): StudyEntryDraft {
  if (!entry) return { kind: 'assignment', title: '', course: '', date: today, time: null, notes: '' }
  const due = entry.due
  const at = due.kind === 'time' ? new Date(due.at) : null
  return {
    kind: entry.kind,
    title: entry.title,
    course: entry.course ?? '',
    date: at ? localDay(at) : due.kind === 'day' ? due.date : today,
    time: at ? clockOf(at) : null,
    notes: entry.notes
  }
}

/** Null until the draft has a title and a real day and time. A known course keeps its spelling. */
export function studyEntryFromDraft(
  draft: StudyEntryDraft, courses: readonly string[], doneAt: string | null
): StudyEntryInput | null {
  const course = courseFor(draft.course.slice(0, STUDY_COURSE_LIMIT), courses)
  let due: StudyEntryInput['due'] = { kind: 'day', date: draft.date }
  if (draft.time !== null) {
    const [hours, minutes] = draft.time.split(':').map(Number)
    const day = parseIso(draft.date)
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
    if (Number.isNaN(at.getTime())) return null
    due = { kind: 'time', at: at.toISOString() }
  }
  const input: StudyEntryInput = { kind: draft.kind, title: draft.title.trim(), course, due, notes: draft.notes.trim(), doneAt }
  return isStudyEntryInput(input) ? input : null
}
