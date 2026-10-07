import { describe, expect, it } from 'vitest'
import type { DocketSummary } from '@ego/api-contracts'
import { groupByRepository, pageHref, stamp, versionLabel } from './dockets'

function docket(id: string, repository: string | null): DocketSummary {
  return {
    id, title: id, description: '', public: false, repository, latestVersion: 1, versionCount: 1,
    createdAt: '2026-10-06T19:02:00.000Z', updatedAt: '2026-10-06T19:02:00.000Z', url: `https://ego.kharitonovegor.com/docket/${id}`
  }
}

describe('docket list helpers', () => {
  it('groups by repository in the order of each group\'s newest docket', () => {
    const groups = groupByRepository([docket('a', 'me/ego'), docket('b', null), docket('c', 'me/ego'), docket('d', 'me/site')])
    expect(groups.map((group) => [group.repository, group.dockets.map((entry) => entry.id)])).toEqual([
      ['me/ego', ['a', 'c']], [null, ['b']], ['me/site', ['d']]
    ])
  })

  it('stamps local time to the minute', () => {
    expect(stamp(new Date(2026, 9, 6, 15, 2).toISOString())).toBe('2026-10-06 15:02')
    expect(stamp('not a date')).toBe('not a date')
  })

  it('keeps a browser on its own origin and gives the desktop the full link', () => {
    expect(pageHref('https://ego.kharitonovegor.com/docket/k3x9qa7m2p/v/2', true)).toBe('/docket/k3x9qa7m2p/v/2')
    expect(pageHref('https://ego.kharitonovegor.com/docket/k3x9qa7m2p', false)).toBe('https://ego.kharitonovegor.com/docket/k3x9qa7m2p')
    expect(versionLabel(1)).toBe('1 version')
    expect(versionLabel(3)).toBe('3 versions')
  })
})
