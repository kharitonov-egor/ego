import { describe, expect, it } from 'vitest'
import { goalProgress, isTaskGoalInput, nextGoalMilestone, type TaskGoalInput } from '../src/goals'

const goal = (overrides: Partial<TaskGoalInput> = {}): TaskGoalInput => ({
  title: 'Build a calmer financial life', why: 'Make room for choices later.', horizon: 'year', targetDate: '2026-12-31',
  status: 'active', position: 1024, reviewDate: '2026-10-02', milestones: [
    { id: 'm-1', title: 'Set a monthly baseline', dueDate: null, doneAt: '2026-09-01T00:00:00.000Z' },
    { id: 'm-2', title: 'Build the emergency fund', dueDate: '2026-12-01', doneAt: null }
  ], boardIds: ['b-1'], cardIds: ['k-1'], archivedAt: null, ...overrides
})

describe('task goals', () => {
  it('validates a goal with explicit links and milestones', () => {
    expect(isTaskGoalInput(goal())).toBe(true)
    expect(isTaskGoalInput(goal({ boardIds: ['b-1', 'b-1'] }))).toBe(false)
    expect(isTaskGoalInput(goal({ targetDate: 'tomorrow' }))).toBe(false)
  })

  it('reports checkpoint progress without pretending cards are progress', () => {
    expect(goalProgress(goal())).toEqual({ done: 1, total: 2 })
    expect(nextGoalMilestone(goal())?.id).toBe('m-2')
  })
})
