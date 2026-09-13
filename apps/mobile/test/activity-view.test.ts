import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVITY_VIEW, activityChips, activityFilters, clearFilters, hasFilters,
  parsePreferences, searchAllTime, storedPreferences, toggleIn, viewIdentity, type ActivityView
} from '../lib/activity-view'

const labels = {
  account: (id: string) => (id === 'acc-check' ? 'Checking' : 'Savings'),
  category: (id: string) => (id === 'cat-food' ? 'Food' : 'Salary')
}

const view = (overrides: Partial<ActivityView> = {}): ActivityView =>
  ({ ...DEFAULT_ACTIVITY_VIEW, ...overrides })

describe('activity view', () => {
  it('starts on this month for a fresh installation', () => {
    expect(DEFAULT_ACTIVITY_VIEW.period).toBe('month')
    const filters = activityFilters(DEFAULT_ACTIVITY_VIEW)
    expect(filters.from).toMatch(/^\d{4}-\d{2}-01$/)
    expect(filters.to).not.toBeNull()
  })

  it('builds filters from the chosen period and the chosen facets', () => {
    const filters = activityFilters(view({
      period: 'all', accountIds: ['acc-check'], categoryIds: ['cat-food'], kinds: ['expense'], search: ' cafe '
    }))
    expect(filters).toMatchObject({
      from: null, to: null, accountIds: ['acc-check'], categoryIds: ['cat-food'], kinds: ['expense'], search: 'cafe'
    })
  })

  it('changes identity when any facet changes, so loaded pages restart', () => {
    const base = view({ period: 'all' })
    expect(viewIdentity(base)).toBe(viewIdentity(view({ period: 'all' })))
    expect(viewIdentity(base)).not.toBe(viewIdentity(view({ period: 'all', search: 'cafe' })))
    expect(viewIdentity(base)).not.toBe(viewIdentity(view({ period: 'all', kinds: ['income'] })))
    expect(viewIdentity(view({ period: 'all', accountIds: ['a', 'b'] })))
      .toBe(viewIdentity(view({ period: 'all', accountIds: ['b', 'a'] })))
  })

  it('offers one removable chip per active filter', () => {
    const current = view({ kinds: ['expense'], accountIds: ['acc-check'], categoryIds: ['cat-food'] })
    const chips = activityChips(current, labels)
    expect(chips.map((chip) => chip.label)).toEqual(['Expenses', 'Checking', 'Food'])
    expect(chips[1].next.accountIds).toEqual([])
    expect(chips[1].next.kinds).toEqual(['expense'])
    expect(hasFilters(clearFilters(current))).toBe(false)
  })

  it('widens an empty result to all time without touching the other facets', () => {
    const widened = searchAllTime(view({ period: 'month', search: 'cafe', kinds: ['expense'] }))
    expect(widened).toMatchObject({ period: 'all', search: 'cafe', kinds: ['expense'] })
    expect(activityFilters(widened).from).toBeNull()
  })

  it('toggles a value in and out of a facet', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('remembers filters but never the search text', () => {
    const saved = storedPreferences(view({
      period: 'year', accountIds: ['acc-check'], kinds: ['expense'], search: 'private note'
    }))
    expect(saved).not.toContain('private note')
    const restored = parsePreferences(saved)
    expect(restored).toMatchObject({ period: 'year', accountIds: ['acc-check'], kinds: ['expense'], search: '' })
  })

  it('falls back to the default view when stored preferences are unusable', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_ACTIVITY_VIEW)
    expect(parsePreferences('not json')).toEqual(DEFAULT_ACTIVITY_VIEW)
    expect(parsePreferences('{"period":"decade","kinds":["nonsense"],"accountIds":[1,2]}'))
      .toMatchObject({ period: 'month', kinds: [], accountIds: [] })
  })
})
