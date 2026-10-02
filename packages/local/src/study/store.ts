import type { ApiError, ApiResult, StudyAssignment, StudyAssignmentList } from '@ego/api-contracts'
import type { CanvasDue } from '@ego/core'
import type { StudyApi } from '../api-client'
import type { LocalDatabase } from '../database/types'

export interface StudyItem extends StudyAssignment {
  /** Checked or unchecked on this phone and not yet on the server. */
  pending: boolean
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

function dueOf(row: AssignmentRow): CanvasDue | null {
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
    pending: row.done_pending === 1
  }
}

export async function cachedStudy(db: LocalDatabase): Promise<CachedStudy> {
  const [rows, state] = await Promise.all([
    db.all<AssignmentRow>('SELECT * FROM study_assignments'),
    db.all<{ fetched_at: string | null }>('SELECT fetched_at FROM study_state WHERE id = 1')
  ])
  return {
    items: rows.map(toItem).filter((item): item is StudyItem => item !== null),
    fetchedAt: state[0]?.fetched_at ?? null
  }
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
