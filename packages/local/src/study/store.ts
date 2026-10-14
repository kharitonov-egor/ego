import type { ApiError, ApiResult, StudyAssignment, StudyAssignmentList, StudyEntryRecord } from '@ego/api-contracts'
import type { CanvasDue, StudyEntryInput, StudyEntryKind } from '@ego/core'
import type { StudyApi } from '../api-client'
import type { LocalDatabase } from '../database/types'
import { createStudyEntry, deleteStudyEntry, updateStudyEntry } from '../sync/commands'

export interface StudyItem extends StudyAssignment {
  /** Checked or unchecked on this phone and not yet on the server. */
  pending: boolean
  /** Canvas lists only assignments. Exams and deadlines come from entries added in Ego. */
  kind: StudyEntryKind
  /** The record behind an item added in Ego, which can be edited and deleted. Null for a Canvas item. */
  entry: StudyEntryRecord | null
}

export interface CachedStudy {
  items: StudyItem[]
  fetchedAt: string | null
}

interface AssignmentRow {
  id: string
  title: string
  course: string | null
  due_at: string | null
  due_date: string | null
  url: string | null
  description: string
  done_at: string | null
  done_pending: number
}

interface MarkRow {
  id: string
  done_at: string | null
}

interface EntryRow {
  id: string
  kind: StudyEntryKind
  title: string
  course: string | null
  due_at: string | null
  due_date: string | null
  notes: string
  done_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

function dueOf(row: Pick<AssignmentRow, 'due_at' | 'due_date'>): CanvasDue | null {
  if (row.due_at) return { kind: 'time', at: row.due_at }
  if (row.due_date) return { kind: 'day', date: row.due_date }
  return null
}

function toItem(row: AssignmentRow): StudyItem | null {
  const due = dueOf(row)
  if (!due) return null
  return {
    id: row.id,
    title: row.title,
    course: row.course,
    due,
    url: row.url,
    description: row.description,
    doneAt: row.done_at,
    pending: row.done_pending === 1,
    kind: 'assignment',
    entry: null
  }
}

function toEntry(row: EntryRow): StudyEntryRecord | null {
  const due = dueOf(row)
  if (!due) return null
  return {
    id: row.id, kind: row.kind, title: row.title, course: row.course, due, notes: row.notes, doneAt: row.done_at,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }
}

function entryItem(entry: StudyEntryRecord, pending: boolean): StudyItem {
  return {
    id: entry.id, title: entry.title, course: entry.course, due: entry.due, url: null, description: entry.notes,
    doneAt: entry.doneAt, pending, kind: entry.kind, entry
  }
}

/** Canvas's saved copy with the entries added in Ego. An entry still in the outbox reads as not yet synced. */
export async function cachedStudy(db: LocalDatabase): Promise<CachedStudy> {
  const [rows, entries, waiting, state] = await Promise.all([
    db.all<AssignmentRow>('SELECT * FROM study_assignments'),
    db.all<EntryRow>('SELECT * FROM study_entries WHERE deleted_at IS NULL'),
    db.all<{ entity_id: string }>("SELECT DISTINCT entity_id FROM outbox WHERE entity = 'studyEntry' AND status IN ('pending', 'held')"),
    db.all<{ fetched_at: string | null }>('SELECT fetched_at FROM study_state WHERE id = 1')
  ])
  const unsent = new Set(waiting.map((row) => row.entity_id))
  const own = entries.map(toEntry).filter((entry): entry is StudyEntryRecord => entry !== null)
  return {
    items: [
      ...rows.map(toItem).filter((item): item is StudyItem => item !== null),
      ...own.map((entry) => entryItem(entry, unsent.has(entry.id)))
    ],
    fetchedAt: state[0]?.fetched_at ?? null
  }
}

async function liveEntry(db: LocalDatabase, id: string): Promise<StudyEntryRecord | null> {
  const rows = await db.all<EntryRow>('SELECT * FROM study_entries WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ? toEntry(rows[0]) : null
}

export function studyEntryInput(entry: StudyEntryRecord): StudyEntryInput {
  return { kind: entry.kind, title: entry.title, course: entry.course, due: entry.due, notes: entry.notes, doneAt: entry.doneAt }
}

/** The caller picks the ID once, so a retried add finds the first one instead of making a second. */
export async function addStudyEntry(db: LocalDatabase, id: string, input: StudyEntryInput, now: string): Promise<void> {
  if (await liveEntry(db, id)) return
  await createStudyEntry(db, input, now, id)
}

/**
 * Each write reads the entry as stored, so a second tap before the screen re-reads still follows
 * the first one instead of colliding with it. An edit keeps the stored check mark, which another
 * device may have changed while the editor was open.
 */
export async function editStudyEntry(db: LocalDatabase, id: string, input: StudyEntryInput, now: string): Promise<void> {
  const current = await liveEntry(db, id)
  if (!current) throw new Error('That study item was deleted')
  await updateStudyEntry(db, id, current.revision, { ...input, doneAt: current.doneAt }, now)
}

export async function markStudyEntry(db: LocalDatabase, id: string, done: boolean, now: string): Promise<void> {
  const current = await liveEntry(db, id)
  if (!current || (current.doneAt !== null) === done) return
  await updateStudyEntry(db, id, current.revision, { ...studyEntryInput(current), doneAt: done ? now : null }, now)
}

export async function removeStudyEntry(db: LocalDatabase, id: string, now: string): Promise<void> {
  const current = await liveEntry(db, id)
  if (current) await deleteStudyEntry(db, id, current.revision, now)
}

/** Replaces the copy with what Canvas has now. A check mark still on its way keeps the phone's value. */
export async function saveStudyList(db: LocalDatabase, list: StudyAssignmentList): Promise<void> {
  await db.transaction(async (tx) => {
    const waiting = await tx.all<MarkRow>('SELECT id, done_at FROM study_assignments WHERE done_pending = 1')
    const local = new Map(waiting.map((row) => [row.id, row.done_at]))
    await tx.run('DELETE FROM study_assignments')
    for (const item of list.assignments) {
      const pending = local.has(item.id)
      await tx.run(`INSERT INTO study_assignments
        (id, title, course, due_at, due_date, url, description, done_at, done_pending)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        item.id,
        item.title,
        item.course,
        item.due.kind === 'time' ? item.due.at : null,
        item.due.kind === 'day' ? item.due.date : null,
        item.url,
        item.description,
        pending ? local.get(item.id) ?? null : item.doneAt,
        pending ? 1 : 0
      ])
    }
    await tx.run(`INSERT INTO study_state (id, fetched_at) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at`, [list.fetchedAt])
  })
}

export async function markStudyItem(db: LocalDatabase, id: string, done: boolean, now: string): Promise<void> {
  await db.run('UPDATE study_assignments SET done_at = ?, done_pending = 1 WHERE id = ?', [done ? now : null, id])
}

/**
 * Sends each waiting check mark. Offline, signed out, or a server fault would fail the same way for
 * the rest, so the first one stops the run. A mark changed again while its request was out stays
 * waiting and goes on the next run.
 */
export async function deliverStudyMarks(db: LocalDatabase, api: StudyApi): Promise<ApiError | null> {
  const waiting = await db.all<MarkRow>('SELECT id, done_at FROM study_assignments WHERE done_pending = 1')
  for (const row of waiting) {
    const done = row.done_at !== null
    const result = await api.markStudyAssignment(row.id, done)
    if (!result.ok && result.error.code !== 'INVALID_REQUEST') return result.error
    await db.run(`UPDATE study_assignments SET done_pending = 0, done_at = ?
      WHERE id = ? AND done_pending = 1 AND (done_at IS NULL) = ?`,
    [result.ok ? result.data.doneAt : row.done_at, row.id, done ? 0 : 1])
  }
  return null
}

export async function refreshStudy(db: LocalDatabase, api: StudyApi): Promise<ApiResult<null>> {
  const blocked = await deliverStudyMarks(db, api)
  if (blocked) return { ok: false, error: blocked }
  const result = await api.studyAssignments()
  if (!result.ok) return result
  await saveStudyList(db, result.data)
  return { ok: true, data: null }
}
