import type { CanvasDue } from './canvas-calendar'
import { isDateString } from './money'

export type StudyEntryKind = 'assignment' | 'exam' | 'deadline'

export const STUDY_ENTRY_KINDS: readonly StudyEntryKind[] = ['assignment', 'exam', 'deadline']
export const STUDY_ENTRY_KIND_LABELS: Record<StudyEntryKind, string> = {
  assignment: 'Assignment',
  exam: 'Exam',
  deadline: 'Deadline'
}

export const STUDY_TITLE_LIMIT = 200
export const STUDY_COURSE_LIMIT = 120
export const STUDY_NOTES_LIMIT = 4000

/**
 * An assignment, exam, or deadline added in Ego beside the ones Canvas lists. It is ours, so its
 * done mark lives on the record instead of in the server's Canvas check marks.
 */
export interface StudyEntryInput {
  kind: StudyEntryKind
  title: string
  course: string | null
  due: CanvasDue
  notes: string
  doneAt: string | null
}

export interface StudyEntry extends StudyEntryInput {
  id: string
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/** An instant must name its zone. One without would read as the device's clock there and UTC on the Worker. */
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

export function isStudyDue(value: unknown): value is CanvasDue {
  if (!isRecord(value)) return false
  if (value.kind === 'time') return isTimestamp(value.at)
  return value.kind === 'day' && typeof value.date === 'string' && isDateString(value.date)
}

export function isStudyEntryInput(value: unknown): value is StudyEntryInput {
  return isRecord(value) &&
    (STUDY_ENTRY_KINDS as readonly unknown[]).includes(value.kind) &&
    isText(value.title, 1, STUDY_TITLE_LIMIT) &&
    (value.course === null || isText(value.course, 1, STUDY_COURSE_LIMIT)) &&
    isStudyDue(value.due) &&
    isText(value.notes, 0, STUDY_NOTES_LIMIT) &&
    (value.doneAt === null || isTimestamp(value.doneAt))
}

/** Course codes compared without spaces or case, so "cop 4530" matches Canvas's "COP4530". */
export function studyCourseKey(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

/** A typed course that matches a known one takes its spelling, so both land under the same course. */
export function matchStudyCourse(typed: string, courses: readonly string[]): string | null {
  const trimmed = typed.trim()
  if (trimmed.length === 0) return null
  const key = studyCourseKey(trimmed)
  return courses.find((course) => studyCourseKey(course) === key) ?? trimmed
}

export function cleanStudyEntry(input: StudyEntryInput): StudyEntryInput {
  return {
    kind: input.kind,
    title: input.title.trim(),
    course: input.course?.trim() || null,
    due: input.due.kind === 'time' ? { kind: 'time', at: new Date(input.due.at).toISOString() } : { kind: 'day', date: input.due.date },
    notes: input.notes.trim(),
    doneAt: input.doneAt
  }
}
