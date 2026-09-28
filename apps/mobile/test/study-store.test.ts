import { describe, expect, it } from 'vitest'
import type { ApiResult, StudyAssignment, StudyAssignmentList, StudyMark } from '@ego/api-contracts'
import type { StudyApi } from '../lib/api-client'
import { cachedStudy, deliverStudyMarks, markStudyItem, refreshStudy, saveStudyList } from '../lib/study/store'
import { openTestLedger } from './local-db'

const FETCHED = '2026-09-28T12:00:00.000Z'

function assignment(id: string, overrides: Partial<StudyAssignment> = {}): StudyAssignment {
  return {
    id,
    title: `Title ${id}`,
    course: 'CDA4205',
    due: { kind: 'time', at: '2026-10-01T21:00:00.000Z' },
    url: null,
    description: '',
    doneAt: null,
    ...overrides
  }
}

function list(assignments: StudyAssignment[], fetchedAt = FETCHED): StudyAssignmentList {
  return { assignments, fetchedAt }
}

interface FakeStudyApi extends StudyApi {
  marks: Array<{ id: string; done: boolean }>
}

function fakeStudyApi(options: {
  lists?: Array<ApiResult<StudyAssignmentList>>
  mark?: (id: string, done: boolean) => ApiResult<StudyMark>
} = {}): FakeStudyApi {
  const marks: Array<{ id: string; done: boolean }> = []
  const lists = [...(options.lists ?? [])]
  return {
    marks,
    studyAssignments: async () => lists.length > 1 ? lists.shift() as ApiResult<StudyAssignmentList> : lists[0] ?? { ok: true, data: list([]) },
    markStudyAssignment: async (id, done) => {
      marks.push({ id, done })
      return options.mark?.(id, done) ?? { ok: true, data: { id, doneAt: done ? '2026-09-28T12:05:00.000Z' : null } }
    }
  }
}

const offline: ApiResult<never> = { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }

describe('study store', () => {
  it('keeps the list and the time it was fetched', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([
      assignment('a', { due: { kind: 'day', date: '2026-10-02' }, doneAt: '2026-09-27T10:00:00.000Z' }),
      assignment('b')
    ]))
    const cached = await cachedStudy(db)
    expect(cached.fetchedAt).toBe(FETCHED)
    expect(cached.items.map((item) => [item.id, item.due.kind, item.doneAt, item.pending])).toEqual([
      ['a', 'day', '2026-09-27T10:00:00.000Z', false],
      ['b', 'time', null, false]
    ])
  })

  it('drops what Canvas no longer lists', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a'), assignment('b')]))
    await saveStudyList(db, list([assignment('b')]))
    expect((await cachedStudy(db)).items.map((item) => item.id)).toEqual(['b'])
  })

  it('keeps a check mark made offline through a refresh until it is delivered', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a')]))
    await markStudyItem(db, 'a', true, '2026-09-28T12:01:00.000Z')
    await saveStudyList(db, list([assignment('a', { doneAt: null })]))
    const [waiting] = (await cachedStudy(db)).items
    expect(waiting).toMatchObject({ doneAt: '2026-09-28T12:01:00.000Z', pending: true })

    const api = fakeStudyApi()
    expect(await deliverStudyMarks(db, api)).toBeNull()
    expect(api.marks).toEqual([{ id: 'a', done: true }])
    const [delivered] = (await cachedStudy(db)).items
    expect(delivered).toMatchObject({ doneAt: '2026-09-28T12:05:00.000Z', pending: false })
  })

  it('stops delivering when the server is out of reach and keeps every mark waiting', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a'), assignment('b')]))
    await markStudyItem(db, 'a', true, '2026-09-28T12:01:00.000Z')
    await markStudyItem(db, 'b', true, '2026-09-28T12:01:00.000Z')
    const api = fakeStudyApi({ mark: () => offline })
    expect((await deliverStudyMarks(db, api))?.code).toBe('OFFLINE')
    expect(api.marks).toHaveLength(1)
    expect((await cachedStudy(db)).items.every((item) => item.pending)).toBe(true)
  })

  it('leaves a mark waiting when it changed again while its request was out', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a')]))
    await markStudyItem(db, 'a', true, '2026-09-28T12:01:00.000Z')
    let unchecked = false
    const api = fakeStudyApi({
      mark: (id, done) => {
        if (!unchecked) {
          unchecked = true
          void markStudyItem(db, id, false, '2026-09-28T12:02:00.000Z')
        }
        return { ok: true, data: { id, doneAt: done ? '2026-09-28T12:05:00.000Z' : null } }
      }
    })
    await deliverStudyMarks(db, api)
    const [item] = (await cachedStudy(db)).items
    expect(item).toMatchObject({ doneAt: null, pending: true })
    await deliverStudyMarks(db, api)
    expect(api.marks).toEqual([{ id: 'a', done: true }, { id: 'a', done: false }])
    expect((await cachedStudy(db)).items[0]).toMatchObject({ doneAt: null, pending: false })
  })

  it('refreshes by delivering first, then saving the new list', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a')]))
    await markStudyItem(db, 'a', true, '2026-09-28T12:01:00.000Z')
    const api = fakeStudyApi({ lists: [{ ok: true, data: list([assignment('a', { doneAt: '2026-09-28T12:05:00.000Z' }), assignment('c')], '2026-09-28T12:06:00.000Z') }] })
    expect(await refreshStudy(db, api)).toEqual({ ok: true, data: null })
    const cached = await cachedStudy(db)
    expect(cached.fetchedAt).toBe('2026-09-28T12:06:00.000Z')
    expect(cached.items.map((item) => [item.id, item.doneAt !== null, item.pending])).toEqual([['a', true, false], ['c', false, false]])
  })

  it('keeps the saved copy when the refresh fails', async () => {
    const db = await openTestLedger()
    await saveStudyList(db, list([assignment('a')]))
    const result = await refreshStudy(db, fakeStudyApi({ lists: [{ ok: false, error: { code: 'UPSTREAM_ERROR', message: 'Canvas did not answer' } }] }))
    expect(result.ok).toBe(false)
    expect((await cachedStudy(db)).items.map((item) => item.id)).toEqual(['a'])
  })
})
