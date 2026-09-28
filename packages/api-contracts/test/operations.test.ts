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

  it('checks exercise and category payloads', () => {
    expect(isSyncOperation(operation({
      entityId: 'ge-x-1', command: { entity: 'gymExercise', type: 'create', payload: { name: 'Корова', categoryId: 'gc-triceps', type: 'weight_reps', weightUnit: 'default', notes: '' } }
    }))).toBe(true)
    expect(isSyncOperation(operation({
      entityId: 'gc-x-1', command: { entity: 'gymCategory', type: 'create', payload: { name: '', color: '#3987e5' } }
    }))).toBe(false)
  })
})
