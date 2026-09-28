import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVITY_VIEW, activityChips, activityFilters, clearFilters, filterCount, hasFilters,
  parsePreferences, storedPreferences, toggleIn, viewIdentity, type ActivityView
} from '../lib/activity-view'
import { rangeForPeriod } from '../lib/periods'

const labels = {
  account: (id: string) => (id === 'acc-check' ? 'Checking' : 'Savings'),
  category: (id: string) => (id === 'cat-food' ? 'Food' : 'Salary')
}

const view = (overrides: Partial<ActivityView> = {}): ActivityView =>
  ({ ...DEFAULT_ACTIVITY_VIEW, ...overrides })

const allTime = { from: null, to: null }
const august = rangeForPeriod('month', allTime, '2026-08-14')

describe('activity view', () => {
  it('starts with no filters', () => {
    expect(hasFilters(DEFAULT_ACTIVITY_VIEW)).toBe(false)
    expect(filterCount(DEFAULT_ACTIVITY_VIEW)).toBe(0)
  })

  it('builds filters from the shared period and its own facets', () => {
    const filters = activityFilters(view({
      accountIds: ['acc-check'], categoryIds: ['cat-food'], kinds: ['expense'], search: ' cafe '
    }), august)
    expect(filters).toMatchObject({
      from: '2026-08-01', to: '2026-08-31', accountIds: ['acc-check'], categoryIds: ['cat-food'], kinds: ['expense'], search: 'cafe'
    })
    expect(activityFilters(view(), allTime)).toMatchObject({ from: null, to: null })
  })

  it('changes identity when the period or any facet changes, so loaded pages restart', () => {
    const base = view()
    expect(viewIdentity(base, allTime)).toBe(viewIdentity(view(), allTime))
    expect(viewIdentity(base, allTime)).not.toBe(viewIdentity(base, august))
    expect(viewIdentity(base, allTime)).not.toBe(viewIdentity(view({ search: 'cafe' }), allTime))
    expect(viewIdentity(base, allTime)).not.toBe(viewIdentity(view({ kinds: ['income'] }), allTime))
    expect(viewIdentity(view({ accountIds: ['a', 'b'] }), allTime))
      .toBe(viewIdentity(view({ accountIds: ['b', 'a'] }), allTime))
  })

  it('offers one removable chip per active filter', () => {
    const current = view({ kinds: ['expense'], accountIds: ['acc-check'], categoryIds: ['cat-food'] })
    const chips = activityChips(current, labels)
    expect(chips.map((chip) => chip.label)).toEqual(['Expenses', 'Checking', 'Food'])
    expect(chips[1].next.accountIds).toEqual([])
    expect(chips[1].next.kinds).toEqual(['expense'])
    expect(filterCount(current)).toBe(3)
    expect(hasFilters(clearFilters(current))).toBe(false)
  })

  it('toggles a value in and out of a facet', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('remembers filters but never the search text', () => {
    const saved = storedPreferences(view({ accountIds: ['acc-check'], kinds: ['expense'], search: 'private note' }))
    expect(saved).not.toContain('private note')
    expect(parsePreferences(saved)).toMatchObject({ accountIds: ['acc-check'], kinds: ['expense'], search: '' })
  })

  it('reads preferences saved by older versions and ignores their period', () => {
    const old = '{"period":"year","custom":{"from":null,"to":null},"accountIds":["acc-check"],"categoryIds":[],"kinds":["income"]}'
    expect(parsePreferences(old)).toEqual(view({ accountIds: ['acc-check'], kinds: ['income'] }))
  })

  it('falls back to the default view when stored preferences are unusable', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_ACTIVITY_VIEW)
    expect(parsePreferences('not json')).toEqual(DEFAULT_ACTIVITY_VIEW)
    expect(parsePreferences('{"kinds":["nonsense"],"accountIds":[1,2]}')).toEqual(DEFAULT_ACTIVITY_VIEW)
  })
})
