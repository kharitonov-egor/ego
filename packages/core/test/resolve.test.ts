import { describe, expect, it } from 'vitest'
import {
  closeResolveSegments, isResolveRuns, mergeResolveRuns, parseResolveDuration, resolveClock, resolveCount, resolveDurationLabel,
  resolveElapsed, resolveEndsAt, resolveRecord, resolveStats, RESOLVE_RUNS_LIMIT, type ResolveRun
} from '../src/resolve'

const run = (id: string, startedAt: string, seconds: number, cards: number): ResolveRun => ({
  id, boardId: 'board', startedAt, plannedSeconds: Math.max(seconds, 1), seconds, cards
})

describe('resolve mode', () => {
  it('reads the durations a person types', () => {
    expect(parseResolveDuration('90s')).toBe(90)
    expect(parseResolveDuration('10m')).toBe(600)
    expect(parseResolveDuration('1h 30m')).toBe(5400)
    expect(parseResolveDuration('1h30m')).toBe(5400)
    expect(parseResolveDuration('1.5h')).toBe(5400)
    expect(parseResolveDuration('25 min')).toBe(1500)
    expect(parseResolveDuration('2 hours 5 seconds')).toBe(7205)
    expect(parseResolveDuration('45')).toBe(2700)
    expect(parseResolveDuration('1:30')).toBe(90)
    expect(parseResolveDuration('1:30:00')).toBe(5400)
    expect(parseResolveDuration('')).toBeNull()
    expect(parseResolveDuration('0')).toBeNull()
    expect(parseResolveDuration('1:75')).toBeNull()
    expect(parseResolveDuration('soon')).toBeNull()
    expect(parseResolveDuration('10 mangoes')).toBeNull()
    expect(parseResolveDuration('25h')).toBeNull()
  })

  it('writes durations and the clock', () => {
    expect(resolveDurationLabel(1500)).toBe('25m')
    expect(resolveDurationLabel(5400)).toBe('1h 30m')
    expect(resolveDurationLabel(90)).toBe('1m 30s')
    expect(resolveClock(761)).toBe('12:41')
    expect(resolveClock(3723)).toBe('1:02:03')
    expect(resolveClock(0.2)).toBe('0:01')
    expect(resolveClock(-5)).toBe('0:00')
  })

  it('leaves pauses out of the clock and the count', () => {
    const segments = [{ start: 0, end: 60_000 }, { start: 120_000, end: null }]
    expect(resolveElapsed(segments, 150_000)).toBe(90_000)
    expect(resolveEndsAt(segments, 300)).toBe(120_000 + 240_000)
    expect(resolveEndsAt(closeResolveSegments(segments, 130_000), 300)).toBeNull()

    const at = (ms: number): string => new Date(ms).toISOString()
    const cards = [
      { boardId: 'board', doneAt: at(30_000) },
      { boardId: 'board', doneAt: at(90_000) },
      { boardId: 'board', doneAt: at(140_000) },
      { boardId: 'board', doneAt: null },
      { boardId: 'other', doneAt: at(30_000) }
    ]
    expect(resolveCount(cards, 'board', segments, 150_000)).toBe(2)
  })

  it('keeps every run once, newest first, up to the limit', () => {
    const older = run('a', '2026-10-09T10:00:00.000Z', 600, 5)
    const newer = run('b', '2026-10-10T10:00:00.000Z', 600, 7)
    expect(mergeResolveRuns([older], [newer, older])).toEqual([newer, older])
    const many = Array.from({ length: RESOLVE_RUNS_LIMIT + 5 }, (_, at) => run(`r${at}`, new Date(at * 60_000).toISOString(), 60, 1))
    expect(mergeResolveRuns(many)).toHaveLength(RESOLVE_RUNS_LIMIT)
    expect(mergeResolveRuns(many)[0]?.id).toBe(`r${RESOLVE_RUNS_LIMIT + 4}`)
  })

  it('checks the shape the Worker stores', () => {
    expect(isResolveRuns([run('a', '2026-10-10T10:00:00.000Z', 600, 5)])).toBe(true)
    expect(isResolveRuns([{ ...run('a', '2026-10-10T10:00:00.000Z', 600, 5), seconds: 700 }])).toBe(false)
    expect(isResolveRuns([{ ...run('a', 'yesterday', 600, 5) }])).toBe(false)
    expect(isResolveRuns([{ ...run('a b', '2026-10-10T10:00:00.000Z', 600, 5) }])).toBe(false)
    expect(isResolveRuns({})).toBe(false)
  })

  it('takes the best pace only from runs of five minutes or more', () => {
    const quick = run('quick', '2026-10-10T09:00:00.000Z', 20, 1)
    const steady = run('steady', '2026-10-10T10:00:00.000Z', 600, 9)
    const long = run('long', '2026-10-10T11:00:00.000Z', 3600, 22)
    const stats = resolveStats([quick, steady, long])
    expect(stats.best?.id).toBe('steady')
    expect(stats.most?.id).toBe('long')
    expect(stats.recentPace).toBeCloseTo(32 / (4220 / 60))
    expect(stats.recent.map((item) => item.id)).toEqual(['long', 'steady', 'quick'])
  })

  it('says what a finished run beat', () => {
    const steady = run('steady', '2026-10-10T10:00:00.000Z', 600, 9)
    const faster = run('faster', '2026-10-10T11:00:00.000Z', 600, 12)
    expect(resolveRecord(faster, [steady])).toEqual({ bestPace: true, mostCards: true, previousBest: 0.9 })
    expect(resolveRecord(steady, [faster])).toEqual({ bestPace: false, mostCards: false, previousBest: 1.2 })
    expect(resolveRecord(steady, [])).toEqual({ bestPace: true, mostCards: false, previousBest: null })
    expect(resolveRecord(run('short', '2026-10-10T12:00:00.000Z', 60, 5), [steady]).bestPace).toBe(false)
  })
})
