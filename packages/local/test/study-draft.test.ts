import { describe, expect, it } from 'vitest'
import type { StudyEntryRecord } from '@ego/api-contracts'
import { studyDraft, studyEntryFromDraft } from '../src/study/draft'

const entry = (overrides: Partial<StudyEntryRecord> = {}): StudyEntryRecord => ({
  id: 's-1', kind: 'exam', title: 'Midterm', course: 'COP4530', due: { kind: 'time', at: new Date(2026, 9, 20, 14, 30).toISOString() },
  notes: 'Room 101', doneAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', revision: 2,
  ...overrides
})

describe('study entry drafts', () => {
  it('starts a new entry today with no time', () => {
    expect(studyDraft(null, '2026-10-14')).toEqual({ kind: 'assignment', title: '', course: '', date: '2026-10-14', time: null, notes: '' })
  })

  it('starts a new entry in the course given, and an edit keeps its own course', () => {
    expect(studyDraft(null, '2026-10-14', 'CDA4205L').course).toBe('CDA4205L')
    expect(studyDraft(entry(), '2026-10-14', 'CDA4205L').course).toBe('COP4530')
  })

  it('opens a timed entry on this device\'s clock and saves it back unchanged', () => {
    const draft = studyDraft(entry(), '2026-10-14')
    expect(draft).toMatchObject({ date: '2026-10-20', time: '14:30', course: 'COP4530' })
    expect(studyEntryFromDraft(draft, ['COP4530'], null)).toEqual({
      kind: 'exam', title: 'Midterm', course: 'COP4530', due: entry().due, notes: 'Room 101', doneAt: null
    })
  })

  it('keeps a whole-day entry as a day, and matches a typed course', () => {
    const draft = { ...studyDraft(entry({ due: { kind: 'day', date: '2026-10-21' } }), '2026-10-14'), course: 'cop 4530 ' }
    expect(draft.time).toBeNull()
    expect(studyEntryFromDraft(draft, ['COP4530'], '2026-10-14T12:00:00.000Z')).toMatchObject({
      due: { kind: 'day', date: '2026-10-21' }, course: 'COP4530', doneAt: '2026-10-14T12:00:00.000Z'
    })
  })

  it('is null without a title', () => {
    expect(studyEntryFromDraft({ ...studyDraft(null, '2026-10-14'), title: '   ' }, [], null)).toBeNull()
  })
})
