import { describe, expect, it } from 'vitest'
import { planExercises, planNameProblem, startLabel } from '../lib/gym/plans'
import type { GymExerciseView, GymPlanView } from '../lib/repositories/gym'

const plan = (overrides: Partial<GymPlanView> = {}): GymPlanView => ({
  id: 'gp-1', name: 'Push', exerciseOrder: ['bench', 'gone', 'dips'], supersets: [], revision: 1, ...overrides
})

const exercise = (id: string, name: string): GymExerciseView => ({
  id, name, categoryId: 'chest', categoryName: 'Chest', categoryColor: '#3987e5', type: 'weight_reps',
  weightUnit: 'default', notes: '', revision: 1, setCount: 0
})

describe('plans', () => {
  it('asks for a name no other plan uses, ignoring case', () => {
    expect(planNameProblem('  ', [], null)).toBe('Give the plan a name')
    expect(planNameProblem('push', [plan()], null)).toBe('A plan called Push already exists')
    expect(planNameProblem('push', [plan()], 'gp-1')).toBeNull()
    expect(planNameProblem('Pull', [plan()], null)).toBeNull()
  })

  it('lists the exercises that still exist, in plan order', () => {
    const exercises = [exercise('dips', 'Dips'), exercise('bench', 'Bench Press')]
    expect(planExercises(plan(), exercises).map((item) => item.name)).toEqual(['Bench Press', 'Dips'])
  })

  it('names the day a plan would start on', () => {
    expect(startLabel('2026-09-30', '2026-09-30')).toBe('Start today')
    expect(startLabel('2026-09-27', '2026-09-30')).toBe('Start on Sun, Sep 27')
  })
})
