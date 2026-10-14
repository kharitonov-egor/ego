// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import { HabitsProvider, useHabits } from './context'

const STAMP = '2026-01-01T09:00:00.000Z'

interface EntryInput {
  habitId: string
  date: string
  kind: 'done' | 'slipped'
  loggedAt: string | null
}

const mocks = vi.hoisted(() => {
  const entries: HabitEntryRecord[] = []
  const db = { transaction: async (work: (tx: unknown) => Promise<void>) => work(db) }
  return {
    chime: vi.fn(),
    entries,
    db,
    write: async (work: (database: unknown, now: string) => Promise<void>) => {
      await work(db, '2026-01-01T09:00:00.000Z')
      return true
    }
  }
})

vi.mock('../beep', () => ({ chime: mocks.chime }))

vi.mock('../ledger', () => ({
  useLedger: () => ({ db: mocks.db, ready: true, enabled: true, habitsVersion: 0, write: mocks.write, writing: false })
}))

vi.mock('@ego/local/repositories/habits', () => ({
  localHabits: async () => [],
  localHabitEntries: async () => [...mocks.entries],
  localRevision: async () => 1
}))

vi.mock('@ego/local/sync/commands', () => ({
  newId: () => `entry-${mocks.entries.length + 1}`,
  createHabitEntry: async (_db: unknown, input: EntryInput, now: string, id: string) => {
    mocks.entries.push({ id, ...input, createdAt: now, updatedAt: now, revision: 1 })
  },
  deleteHabitEntry: async (_db: unknown, id: string) => {
    mocks.entries.splice(mocks.entries.findIndex((entry) => entry.id === id), 1)
  },
  createHabit: vi.fn(),
  updateHabit: vi.fn(),
  deleteHabit: vi.fn()
}))

function habit(changes: Partial<HabitRecord>): HabitRecord {
  return {
    id: 'habit-1', name: 'Drink water', icon: '💧', kind: 'build', startDate: '2026-01-01', position: 0,
    target: 1, period: 'day', startedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1, ...changes
  }
}

let current: ReturnType<typeof useHabits> | null = null

function Probe(): null {
  current = useHabits()
  return null
}

function probe(): ReturnType<typeof useHabits> {
  if (!current) throw new Error('Not rendered')
  return current
}

async function mount(): Promise<void> {
  render(<HabitsProvider><Probe /></HabitsProvider>)
  await act(async () => undefined)
}

async function tap(record: HabitRecord): Promise<void> {
  await act(async () => { await probe().tap(record, probe().today) })
}

describe('HabitsProvider', () => {
  beforeEach(() => {
    current = null
    mocks.entries.length = 0
    mocks.chime.mockReset()
  })
  afterEach(cleanup)

  it('chimes when a tap checks a habit off and stays quiet when it unchecks', async () => {
    await mount()
    const water = habit({})
    await tap(water)
    expect(mocks.chime).toHaveBeenCalledTimes(1)
    expect(mocks.entries).toHaveLength(1)
    await tap(water)
    expect(mocks.chime).toHaveBeenCalledTimes(1)
    expect(mocks.entries).toHaveLength(0)
  })

  it('chimes for each count up to the target, then stops', async () => {
    await mount()
    const water = habit({ target: 2 })
    await tap(water)
    await tap(water)
    await tap(water)
    expect(mocks.chime).toHaveBeenCalledTimes(2)
    expect(mocks.entries).toHaveLength(2)
    await act(async () => { await probe().takeBack(water, probe().today) })
    expect(mocks.chime).toHaveBeenCalledTimes(2)
    expect(mocks.entries).toHaveLength(1)
  })
})
