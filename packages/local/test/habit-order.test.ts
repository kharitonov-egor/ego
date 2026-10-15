import { describe, expect, it } from 'vitest'
import type { HabitRecord } from '@ego/api-contracts'
import { moveHabit, shownIndexToAll } from '../src/habits/order'

const AT = '2026-09-01T12:00:00.000Z'

const habit = (id: string, position: number, overrides: Partial<HabitRecord> = {}): HabitRecord => ({
  id, name: id, icon: '✅', kind: 'build', startDate: '2026-09-01', position, target: 1, period: 'day',
  startedAt: null, createdAt: AT, updatedAt: AT, revision: 1, ...overrides
})

const ids = (habits: readonly HabitRecord[]): string[] => habits.map((item) => item.id)

describe('moveHabit', () => {
  const teeth = habit('teeth', 0)
  const smoke = habit('smoke', 0, { kind: 'break' })
  const sunscreen = habit('sunscreen', 1)
  const water = habit('water', 2)
  const all = [teeth, smoke, sunscreen, water]

  it('moves a habit among its own kind and renumbers only the ones that changed', () => {
    const moved = moveHabit(all, 'water', 0)
    expect(ids((moved?.habits ?? []).filter((item) => item.kind === 'build'))).toEqual(['water', 'teeth', 'sunscreen'])
    expect(moved?.changed.map((item) => [item.id, item.position])).toEqual([['water', 0], ['teeth', 1], ['sunscreen', 2]])
    expect(moved?.habits.find((item) => item.id === 'smoke')?.position).toBe(0)
  })

  it('moves down to the last place', () => {
    const moved = moveHabit(all, 'teeth', 2)
    expect(ids((moved?.habits ?? []).filter((item) => item.kind === 'build'))).toEqual(['sunscreen', 'water', 'teeth'])
  })

  it('puts habits that shared a position in order', () => {
    const left = habit('left', 0, { createdAt: '2026-09-01T00:00:00.000Z' })
    const right = habit('right', 0, { createdAt: '2026-09-02T00:00:00.000Z' })
    const third = habit('third', 1)
    const moved = moveHabit([left, right, third], 'third', 1)
    expect(ids(moved?.habits ?? [])).toEqual(['left', 'third', 'right'])
    expect(moved?.changed.map((item) => [item.id, item.position])).toEqual([['right', 2]])
  })

  it('leaves a habit that stays put, or a move off either end', () => {
    expect(moveHabit(all, 'teeth', 0)).toBeNull()
    expect(moveHabit(all, 'teeth', -1)).toBeNull()
    expect(moveHabit(all, 'teeth', 3)).toBeNull()
    expect(moveHabit(all, 'missing', 0)).toBeNull()
  })
})

describe('shownIndexToAll', () => {
  const a = habit('a', 0)
  const later = habit('later', 1, { startDate: '2026-12-01' })
  const b = habit('b', 2)
  const c = habit('c', 3)
  const all = [a, later, b, c]
  const shown = [a, b, c]

  it('lands right before the shown habit it was dropped above', () => {
    expect(shownIndexToAll(all, shown, 'c', 1)).toBe(2)
    expect(shownIndexToAll(all, shown, 'c', 0)).toBe(0)
  })

  it('lands right after the last shown habit when dropped at the end', () => {
    expect(shownIndexToAll(all, shown, 'a', 2)).toBe(3)
  })

  it('matches the shown index when every habit is shown', () => {
    expect(shownIndexToAll(shown, shown, 'a', 1)).toBe(1)
    expect(shownIndexToAll(shown, shown, 'c', 0)).toBe(0)
  })
})
