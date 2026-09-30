import { describe, expect, it } from 'vitest'
import { isOperationRequest, isSyncOperation, type SyncOperation } from '../src'

const transactionInput = {
  kind: 'expense' as const, accountId: 'acc-1', destinationAccountId: null, categoryId: 'cat-1',
  amountCents: 4220, date: '2026-09-12', notes: 'Groceries'
}

const operation = (overrides: Partial<SyncOperation> = {}): unknown => ({
  operationId: 'op-1', entityId: 'tx-1', expectedRevision: null, createdAt: '2026-09-12T10:00:00.000Z',
  command: { entity: 'transaction', type: 'create', payload: transactionInput },
  ...overrides
})

describe('sync operations', () => {
  it('accepts a create without an expected revision', () => {
    expect(isSyncOperation(operation())).toBe(true)
  })

  it('requires an expected revision for updates and deletes', () => {
    expect(isSyncOperation(operation({
      command: { entity: 'transaction', type: 'update', payload: transactionInput }
    }))).toBe(false)
    expect(isSyncOperation(operation({
      expectedRevision: 3, command: { entity: 'transaction', type: 'update', payload: transactionInput }
    }))).toBe(true)
    expect(isSyncOperation(operation({ command: { entity: 'transaction', type: 'delete' } }))).toBe(false)
  })

  it('refuses a create that carries an expected revision', () => {
    expect(isSyncOperation(operation({ expectedRevision: 1 }))).toBe(false)
  })

  it('validates the payload against the domain rules', () => {
    expect(isSyncOperation(operation({
      command: { entity: 'transaction', type: 'create', payload: { ...transactionInput, amountCents: 0 } }
    }))).toBe(false)
    expect(isSyncOperation(operation({
      command: { entity: 'transaction', type: 'create', payload: { ...transactionInput, kind: 'transfer' } }
    }))).toBe(false)
  })

  it('requires a month as the budget entity ID', () => {
    const budget = { month: '2026-09', plannedIncomeCents: 100, allocations: [] }
    expect(isSyncOperation(operation({
      entityId: '2026-09', command: { entity: 'budget', type: 'save', payload: budget }
    }))).toBe(true)
    expect(isSyncOperation(operation({
      entityId: 'budget-1', command: { entity: 'budget', type: 'save', payload: budget }
    }))).toBe(false)
  })

  it('requires a date as the mood entity ID and a mood from 1 to 5', () => {
    const mood = { date: '2026-09-28', mood: 4, note: 'Long walk' }
    const save = (entityId: string, payload: unknown): unknown => ({
      ...(operation() as object), entityId, command: { entity: 'mood', type: 'save', payload }
    })
    expect(isSyncOperation(save('2026-09-28', mood))).toBe(true)
    expect(isSyncOperation({ ...(save('2026-09-28', mood) as object), expectedRevision: 2 })).toBe(true)
    expect(isSyncOperation(save('mood-1', mood))).toBe(false)
    expect(isSyncOperation(save('2026-09-28', { ...mood, mood: 6 }))).toBe(false)
    expect(isSyncOperation(save('2026-09-28', { ...mood, mood: 2.5 }))).toBe(false)
    expect(isSyncOperation(save('2026-09-28', { ...mood, note: 'x'.repeat(2001) }))).toBe(false)
    expect(isSyncOperation(operation({
      entityId: '2026-09-28', command: { entity: 'mood', type: 'delete' }
    }))).toBe(false)
    expect(isSyncOperation(operation({
      entityId: '2026-09-28', expectedRevision: 1, command: { entity: 'mood', type: 'delete' }
    }))).toBe(true)
  })

  it('bounds the batch size', () => {
    expect(isOperationRequest({ operations: [] })).toBe(false)
    expect(isOperationRequest({ operations: Array.from({ length: 26 }, () => operation()) })).toBe(false)
    expect(isOperationRequest({ operations: [operation()] })).toBe(true)
  })
})

describe('gym operations', () => {
  const set = {
    exerciseId: 'ge-barbell-squat', date: '2026-09-27', position: 0, weight: 25, weightUnit: 'lbs',
    reps: 12, distance: null, distanceUnit: null, durationSeconds: null, comment: ''
  }
  const workout = { date: '2026-09-27', exerciseOrder: ['ge-barbell-squat'], supersets: [], notes: '' }

  it('accepts set creates, updates, and deletes with the usual revision rules', () => {
    expect(isSyncOperation(operation({ entityId: 'gs-1', command: { entity: 'gymSet', type: 'create', payload: set } }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: 'gs-1', command: { entity: 'gymSet', type: 'update', payload: set } }))).toBe(false)
    expect(isSyncOperation(operation({ entityId: 'gs-1', expectedRevision: 2, command: { entity: 'gymSet', type: 'delete' } }))).toBe(true)
    expect(isSyncOperation(operation({
      entityId: 'gs-1', command: { entity: 'gymSet', type: 'create', payload: { ...set, reps: -1 } }
    }))).toBe(false)
  })

  it('keys a workout by its date, with or without a revision', () => {
    const save = { entity: 'gymWorkout', type: 'save', payload: workout } as const
    expect(isSyncOperation(operation({ entityId: '2026-09-27', command: save }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: '2026-09-27', expectedRevision: 4, command: save }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: '2026-09-28', command: save }))).toBe(false)
    expect(isSyncOperation(operation({ entityId: 'workout', command: save }))).toBe(false)
  })

  it('accepts plan creates, updates, and deletes with the usual revision rules', () => {
    const plan = { name: 'Push', exerciseOrder: ['ge-bench', 'ge-dips'], supersets: [['ge-bench', 'ge-dips']] }
    expect(isSyncOperation(operation({ entityId: 'gp-1', command: { entity: 'gymPlan', type: 'create', payload: plan } }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: 'gp-1', expectedRevision: 3, command: { entity: 'gymPlan', type: 'update', payload: plan } }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: 'gp-1', command: { entity: 'gymPlan', type: 'update', payload: plan } }))).toBe(false)
    expect(isSyncOperation(operation({ entityId: 'gp-1', expectedRevision: 3, command: { entity: 'gymPlan', type: 'delete' } }))).toBe(true)
    expect(isSyncOperation(operation({
      entityId: 'gp-1', command: { entity: 'gymPlan', type: 'create', payload: { ...plan, name: '' } }
    }))).toBe(false)
  })

  it('checks exercise and category payloads', () => {
    expect(isSyncOperation(operation({
      entityId: 'ge-x-1', command: { entity: 'gymExercise', type: 'create', payload: { name: 'Корова', categoryId: 'gc-triceps', type: 'weight_reps', weightUnit: 'default', notes: '' } }
    }))).toBe(true)
    expect(isSyncOperation(operation({
      entityId: 'gc-x-1', command: { entity: 'gymCategory', type: 'create', payload: { name: '', color: '#3987e5' } }
    }))).toBe(false)
  })
})

describe('habit operations', () => {
  const habit = { name: 'Read', icon: '📚', kind: 'build', startDate: '2026-09-28', position: 0 }
  const entry = { habitId: 'hb-1', date: '2026-09-28', kind: 'done' }
  const create = (entity: 'habit' | 'habitEntry', payload: unknown): unknown => ({
    ...(operation() as object), entityId: 'hb-1', command: { entity, type: 'create', payload }
  })

  it('accepts a habit with a name, one emoji, and a start date', () => {
    expect(isSyncOperation(create('habit', habit))).toBe(true)
    expect(isSyncOperation(create('habit', { ...habit, kind: 'break', icon: '👨‍👩‍👧‍👦' }))).toBe(true)
    expect(isSyncOperation(create('habit', { ...habit, name: '   ' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, name: 'x'.repeat(61) }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, icon: '' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, kind: 'maybe' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, startDate: '2026-02-30' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, position: 1.5 }))).toBe(false)
  })

  it('takes an optional target, period, and quit moment within their limits', () => {
    expect(isSyncOperation(create('habit', { ...habit, target: 4, period: 'day' }))).toBe(true)
    expect(isSyncOperation(create('habit', { ...habit, target: 3, period: 'week' }))).toBe(true)
    expect(isSyncOperation(create('habit', { ...habit, target: 7, period: 'week' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, target: 11 }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, target: 0 }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, period: 'month' }))).toBe(false)
    expect(isSyncOperation(create('habit', { ...habit, kind: 'break', startedAt: '2026-09-28T21:30:00.000Z' }))).toBe(true)
    expect(isSyncOperation(create('habit', { ...habit, startedAt: 'yesterday' }))).toBe(false)
    expect(isSyncOperation(create('habitEntry', { ...entry, kind: 'slipped', loggedAt: '2026-09-28T21:30:00.000Z' }))).toBe(true)
    expect(isSyncOperation(create('habitEntry', { ...entry, loggedAt: 12 }))).toBe(false)
  })

  it('accepts done, resisted, and slipped entries and nothing else', () => {
    expect(isSyncOperation(create('habitEntry', entry))).toBe(true)
    expect(isSyncOperation(create('habitEntry', { ...entry, kind: 'slipped' }))).toBe(true)
    expect(isSyncOperation(create('habitEntry', { ...entry, kind: 'skipped' }))).toBe(false)
    expect(isSyncOperation(create('habitEntry', { ...entry, habitId: '' }))).toBe(false)
  })

  it('needs a revision to update or delete', () => {
    expect(isSyncOperation(operation({ entityId: 'hb-1', command: { entity: 'habit', type: 'delete' } }))).toBe(false)
    expect(isSyncOperation(operation({ entityId: 'hb-1', expectedRevision: 1, command: { entity: 'habit', type: 'delete' } }))).toBe(true)
    expect(isSyncOperation(operation({ entityId: 'he-1', expectedRevision: 1, command: { entity: 'habitEntry', type: 'delete' } }))).toBe(true)
  })
})
