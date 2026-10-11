import { describe, expect, it } from 'vitest'
import type { DocketSummary } from '@ego/api-contracts'
import { docketDate, groupByRepository, isDocketOrder, sortDockets } from '../src/dockets'

function docket(id: string, repository: string | null, createdAt = '2026-10-06T19:02:00.000Z', updatedAt = createdAt): DocketSummary {
  return {
    id, title: id, description: '', public: false, repository, latestVersion: 1, versionCount: 1,
    createdAt, updatedAt, url: `https://ego.kharitonovegor.com/docket/${id}`
  }
}

describe('docket order', () => {
  const list = [
    docket('a', 'me/ego', '2026-10-01T10:00:00.000Z', '2026-10-09T10:00:00.000Z'),
    docket('b', null, '2026-10-03T10:00:00.000Z'),
    docket('c', 'me/site', '2026-10-02T10:00:00.000Z', '2026-10-04T10:00:00.000Z')
  ]
  const ids = (dockets: DocketSummary[]): string[] => dockets.map((entry) => entry.id)

  it('sorts by first upload either way, or by the latest version', () => {
    expect(ids(sortDockets(list, 'newest'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortDockets(list, 'oldest'))).toEqual(['a', 'c', 'b'])
    expect(ids(sortDockets(list, 'updated'))).toEqual(['a', 'c', 'b'])
    expect(ids(list)).toEqual(['a', 'b', 'c'])
  })

  it('shows the date the order sorts by', () => {
    expect(docketDate(list[0], 'newest')).toBe('2026-10-01T10:00:00.000Z')
    expect(docketDate(list[0], 'updated')).toBe('2026-10-09T10:00:00.000Z')
    expect(docketDate(list[0], 'project')).toBe('2026-10-09T10:00:00.000Z')
  })

  it('accepts only known orders from storage', () => {
    expect(isDocketOrder('oldest')).toBe(true)
    expect(isDocketOrder('repository')).toBe(false)
    expect(isDocketOrder(null)).toBe(false)
  })

  it('groups by repository in the order of each group\'s first docket', () => {
    const groups = groupByRepository([docket('a', 'me/ego'), docket('b', null), docket('c', 'me/ego'), docket('d', 'me/site')])
    expect(groups.map((group) => [group.repository, ids(group.dockets)])).toEqual([
      ['me/ego', ['a', 'c']], [null, ['b']], ['me/site', ['d']]
    ])
  })
})
