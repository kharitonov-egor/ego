import { describe, expect, it } from 'vitest'
import {
  addMonths, bucketSizeFor, canStepForward, chartBuckets, comparisonSpan, formatSpan, isCurrentPeriod, isHorizontalSwipe,
  parseSavedPeriod, periodSpan, periodTitle, rangeForPeriod, relativePeriodName, stepAnchor, swipeStep
} from '../src/periods'

const TODAY = '2026-09-27'
const none = { from: null, to: null }

describe('period spans', () => {
  it('covers whole calendar periods around the anchor', () => {
    expect(periodSpan('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(periodSpan('week', TODAY)).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(periodSpan('month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(periodSpan('year', TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('starts weeks on Monday, even when the anchor is a Sunday in another month', () => {
    expect(periodSpan('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
  })

  it('knows February in a leap year', () => {
    expect(periodSpan('month', '2028-02-10').to).toBe('2028-02-29')
  })

  it('leaves all time open and passes a custom range through', () => {
    expect(rangeForPeriod('all', none, TODAY)).toEqual(none)
    expect(rangeForPeriod('custom', { from: '2026-01-05', to: null }, TODAY)).toEqual({ from: '2026-01-05', to: null })
  })
})

describe('stepping', () => {
  it('keeps the day of the month where it exists', () => {
    expect(stepAnchor('month', TODAY, -1, TODAY)).toBe('2026-08-27')
    expect(stepAnchor('month', '2026-03-31', -1, TODAY)).toBe('2026-02-28')
    expect(stepAnchor('year', '2028-02-29', -1, TODAY)).toBe('2027-02-28')
    expect(stepAnchor('week', TODAY, -1, TODAY)).toBe('2026-09-20')
    expect(stepAnchor('today', '2026-03-01', -1, TODAY)).toBe('2026-02-28')
  })

  it('snaps to today when a step lands in the current period', () => {
    expect(stepAnchor('month', '2026-08-31', 1, TODAY)).toBe(TODAY)
    expect(stepAnchor('year', '2025-12-31', 1, TODAY)).toBe(TODAY)
  })

  it('stops at the current period', () => {
    expect(canStepForward('month', TODAY, TODAY)).toBe(false)
    expect(canStepForward('month', '2026-08-15', TODAY)).toBe(true)
    expect(canStepForward('today', '2026-09-26', TODAY)).toBe(true)
    expect(isCurrentPeriod('week', '2026-09-21', TODAY)).toBe(true)
  })
})

describe('titles', () => {
  it('names the exact period', () => {
    expect(periodTitle('month', TODAY, none)).toBe('September 2026')
    expect(periodTitle('year', TODAY, none)).toBe('2026')
    expect(periodTitle('today', TODAY, none)).toBe('Sun, Sep 27, 2026')
    expect(periodTitle('week', TODAY, none)).toBe('Sep 21 – 27, 2026')
    expect(periodTitle('all', TODAY, none)).toBe('All time')
  })

  it('formats spans that cross a month or a year', () => {
    expect(formatSpan('2026-08-31', '2026-09-06')).toBe('Aug 31 – Sep 6, 2026')
    expect(formatSpan('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(formatSpan('2026-08-31', '2026-09-06', 2026)).toBe('Aug 31 – Sep 6')
    expect(formatSpan('2025-08-31', '2025-09-06', 2026)).toBe('Aug 31 – Sep 6, 2025')
    expect(periodTitle('custom', TODAY, { from: '2026-08-31', to: '2026-09-06' })).toBe('Aug 31 – Sep 6, 2026')
  })

  it('adds a relative name for the current and the previous period only', () => {
    expect(relativePeriodName('month', TODAY, TODAY)).toBe('This month')
    expect(relativePeriodName('month', '2026-08-02', TODAY)).toBe('Last month')
    expect(relativePeriodName('month', '2026-07-02', TODAY)).toBeNull()
    expect(relativePeriodName('today', '2026-09-26', TODAY)).toBe('Yesterday')
    expect(relativePeriodName('year', '2025-06-01', TODAY)).toBe('Last year')
  })
})

describe('comparison', () => {
  it('compares a running period with the same stretch of the previous one', () => {
    expect(comparisonSpan('month', TODAY, TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-27', label: 'Aug 1 – 27' })
    expect(comparisonSpan('year', TODAY, TODAY)).toEqual({ from: '2025-01-01', to: '2025-09-27', label: 'Jan 1 – Sep 27, 2025' })
    expect(comparisonSpan('week', TODAY, TODAY)).toMatchObject({ from: '2026-09-14', to: '2026-09-20', label: 'Sep 14 – 20' })
  })

  it('clamps to the end of a shorter previous month', () => {
    expect(comparisonSpan('month', '2026-03-31', '2026-03-31')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('compares a finished period with the whole previous one', () => {
    expect(comparisonSpan('month', '2026-08-10', TODAY)).toEqual({ from: '2026-07-01', to: '2026-07-31', label: 'July' })
    expect(comparisonSpan('month', '2026-01-10', TODAY).label).toBe('December 2025')
    expect(comparisonSpan('today', TODAY, TODAY).label).toBe('Sat, Sep 26')
    expect(comparisonSpan('year', '2025-03-01', TODAY).label).toBe('2024')
  })
})

describe('chart buckets', () => {
  it('uses one bar per day for a month, labelled weekly', () => {
    const buckets = chartBuckets(periodSpan('month', TODAY))
    expect(buckets).toHaveLength(30)
    expect(buckets.filter((bucket) => bucket.tick).map((bucket) => bucket.tick)).toEqual(['Sep 1', '8', '15', '22', '29'])
    expect(buckets[13]).toMatchObject({ key: '2026-09-14', title: 'Mon, Sep 14', drill: { period: 'today', anchor: '2026-09-14' } })
  })

  it('labels each day of a week with its weekday', () => {
    expect(chartBuckets(periodSpan('week', TODAY)).map((bucket) => bucket.tick)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('uses months for a year and years for a long history', () => {
    const year = chartBuckets(periodSpan('year', TODAY))
    expect(year).toHaveLength(12)
    expect(year[8]).toMatchObject({ key: '2026-09', tick: 'S', title: 'September 2026', drill: { period: 'month', anchor: '2026-09-01' } })
    expect(bucketSizeFor({ from: '2019-03-01', to: TODAY })).toBe('year')
    const history = chartBuckets({ from: '2019-03-01', to: TODAY })
    expect(history.map((bucket) => bucket.key)).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'])
    expect(history.filter((bucket) => bucket.tick).length).toBeLessThanOrEqual(6)
  })

  it('marks only January when months run past a year', () => {
    const buckets = chartBuckets({ from: '2025-03-10', to: TODAY })
    expect(buckets[0].key).toBe('2025-03')
    expect(buckets.filter((bucket) => bucket.tick).map((bucket) => bucket.tick)).toEqual(['2026'])
  })
})

describe('swipes', () => {
  it('goes back in time on a left swipe and forward on a right swipe', () => {
    expect(swipeStep(-80, -0.2)).toBe(-1)
    expect(swipeStep(80, 0.2)).toBe(1)
  })

  it('counts a short fast flick but ignores a short slow drag', () => {
    expect(swipeStep(-30, -0.8)).toBe(-1)
    expect(swipeStep(30, 0.8)).toBe(1)
    expect(swipeStep(-30, -0.1)).toBe(0)
    expect(swipeStep(10, 2)).toBe(0)
  })

  it('leaves slanted vertical scrolls alone', () => {
    expect(isHorizontalSwipe(40, 10)).toBe(true)
    expect(isHorizontalSwipe(40, 30)).toBe(false)
    expect(isHorizontalSwipe(10, 0)).toBe(false)
  })
})

describe('the saved period', () => {
  it('restores the kind of period and a custom range', () => {
    expect(parseSavedPeriod('{"period":"week","custom":{"from":null,"to":null}}')).toEqual({ period: 'week', custom: { from: null, to: null } })
    expect(parseSavedPeriod('{"period":"custom","custom":{"from":"2026-01-01","to":"2026-03-31"}}'))
      .toEqual({ period: 'custom', custom: { from: '2026-01-01', to: '2026-03-31' } })
  })

  it('opens on the default when the saved value is unusable', () => {
    expect(parseSavedPeriod(null)).toBeNull()
    expect(parseSavedPeriod('nope')).toBeNull()
    expect(parseSavedPeriod('{"period":"decade"}')).toBeNull()
    expect(parseSavedPeriod('{"period":"custom","custom":{"from":"yesterday"}}')).toEqual({ period: 'custom', custom: { from: null, to: null } })
  })

  it('adds months without spilling into the next one', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-09-14', 1)).toBe('2026-10-14')
  })
})
