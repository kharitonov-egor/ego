import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskBoardRecord, TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import type { TaskData } from '@ego/local/tasks/repository'
import { taskNotificationPlan, type PlannedNotification } from '@ego/local/tasks/reminders'
import type { NotifyInput } from '../../platform/local'
import { LONGEST_TIMER_MS, createReminderScheduler, notificationRoute } from './scheduler'

const STAMP = '2026-10-01T09:00:00.000Z'

function planned(identifier: string, at: number): PlannedNotification {
  return { identifier, at: new Date(at), title: identifier, body: 'Due soon' }
}

function card(id: string, dueDate: string, dueTime: string | null, reminderMinutes: 0 | 10 | 60 | null): TaskCardRecord {
  return {
    id, boardId: 'board', listId: 'list', title: `Card ${id}`, description: '', position: 1024, labelIds: [], priority: 'none',
    dueDate, dueTime, reminderMinutes, doneAt: null, archivedAt: null, checklists: [], attachments: [], activity: [],
    createdAt: STAMP, updatedAt: STAMP, revision: 1
  }
}

describe('notificationRoute', () => {
  it('opens the card a reminder is about, and Upcoming for the digest', () => {
    expect(notificationRoute('ego-task-card-1')).toBe('/tasks/card/card-1')
    expect(notificationRoute('ego-task-digest-2026-10-02')).toBe('/tasks/upcoming')
    expect(notificationRoute('something-else')).toBeUndefined()
  })
})

describe('createReminderScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T08:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('shows each planned notification at its time with the route to open', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const now = Date.now()
    scheduler.replace([planned('ego-task-a', now + 60000), planned('ego-task-digest-2026-10-02', now + 120000)], now)
    vi.advanceTimersByTime(59999)
    expect(notify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(notify).toHaveBeenLastCalledWith({ title: 'ego-task-a', body: 'Due soon', route: '/tasks/card/a' })
    vi.advanceTimersByTime(60000)
    expect(notify).toHaveBeenLastCalledWith({ title: 'ego-task-digest-2026-10-02', body: 'Due soon', route: '/tasks/upcoming' })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('cancels the old plan when a new one replaces it', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const now = Date.now()
    scheduler.replace([planned('ego-task-a', now + 60000)], now)
    scheduler.replace([planned('ego-task-b', now + 90000)], now)
    vi.advanceTimersByTime(120000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ route: '/tasks/card/b' }))
    scheduler.replace([planned('ego-task-c', Date.now() + 1000)], Date.now())
    scheduler.cancel()
    vi.advanceTimersByTime(5000)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('skips times already gone and times past the longest timer, which a later replan reaches', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const now = Date.now()
    scheduler.replace([planned('ego-task-old', now - 1000), planned('ego-task-far', now + LONGEST_TIMER_MS + 1)], now)
    vi.advanceTimersByTime(LONGEST_TIMER_MS + 10)
    expect(notify).not.toHaveBeenCalled()
  })

  it('shows a reminder that came due while the computer slept, once, when the plan is replaced', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const start = Date.now()
    const reminder = planned('ego-task-a', start + 60 * 60000)
    scheduler.replace([reminder], start)
    expect(scheduler.plannedAt()).toBe(start)
    vi.setSystemTime(start + 3 * 60 * 60000)
    scheduler.replace([reminder, planned('ego-task-b', Date.now() + 60000)], Date.now())
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ route: '/tasks/card/a' }))
    scheduler.replace([reminder], Date.now())
    vi.advanceTimersByTime(120000)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not show again what already showed, what the new plan dropped, or what was never waited on', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const start = Date.now()
    const shownOnTime = planned('ego-task-a', start + 60000)
    const doneSince = planned('ego-task-b', start + 120000)
    scheduler.replace([shownOnTime, doneSince], start)
    vi.advanceTimersByTime(60000)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.setSystemTime(start + 10 * 60000)
    scheduler.replace([shownOnTime, planned('ego-task-new', start + 5 * 60000)], Date.now())
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('shows only the latest of several missed digests', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const start = Date.now()
    const day = 24 * 60 * 60000
    const digests = [planned('ego-task-digest-1', start + 60000), planned('ego-task-digest-2', start + day + 60000)]
    scheduler.replace(digests, start)
    vi.setSystemTime(start + 2 * day)
    scheduler.replace(digests, Date.now())
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'ego-task-digest-2' }))
  })

  it('starts fresh after cancel', () => {
    const notify = vi.fn<(input: NotifyInput) => void>()
    const scheduler = createReminderScheduler(notify)
    const start = Date.now()
    const reminder = planned('ego-task-a', start + 60000)
    scheduler.replace([reminder], start)
    scheduler.cancel()
    expect(scheduler.plannedAt()).toBeNull()
    vi.setSystemTime(start + 120000)
    scheduler.replace([reminder], Date.now())
    expect(notify).not.toHaveBeenCalled()
  })

  describe('with the plan the phone uses', () => {
    const board: TaskBoardRecord = { id: 'board', name: 'Home', icon: '', position: 1024, hideDone: false, moveDone: false, archivedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1 }
    const list: TaskListRecord = { id: 'list', boardId: 'board', name: 'To Do', position: 1024, archivedAt: null, kind: 'cards', color: null, icon: '', border: false, createdAt: STAMP, updatedAt: STAMP, revision: 1 }
    const open = card('due', '2026-10-02', '09:00', 10)
    const data: TaskData = { boards: [board], lists: [list], labels: [], cards: [open], uploads: new Map() }

    it('rings ten minutes before a card is due and opens it', () => {
      const notify = vi.fn<(input: NotifyInput) => void>()
      createReminderScheduler(notify).replace(taskNotificationPlan(data, new Date(), { digest: false }), Date.now())
      vi.advanceTimersByTime(49 * 60 * 1000)
      expect(notify).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60 * 1000)
      expect(notify).toHaveBeenCalledWith({ title: 'Card due', body: 'Due at 9:00 AM · Home / To Do', route: '/tasks/card/due' })
    })

    it('catches up after sleep with a plan made from the last plan time', () => {
      const notify = vi.fn<(input: NotifyInput) => void>()
      const scheduler = createReminderScheduler(notify)
      scheduler.replace(taskNotificationPlan(data, new Date(), { digest: false }), Date.now())
      vi.setSystemTime(new Date('2026-10-02T11:00:00'))
      const since = new Date(scheduler.plannedAt() ?? Date.now())
      scheduler.replace(taskNotificationPlan(data, since, { digest: false }), Date.now())
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Card due', route: '/tasks/card/due' }))
      const done: TaskData = { ...data, cards: [{ ...open, doneAt: new Date().toISOString() }] }
      scheduler.replace(taskNotificationPlan(done, new Date(scheduler.plannedAt() ?? Date.now()), { digest: false }), Date.now())
      expect(notify).toHaveBeenCalledTimes(1)
    })

    it('stays quiet once the card is done', () => {
      const notify = vi.fn<(input: NotifyInput) => void>()
      const scheduler = createReminderScheduler(notify)
      scheduler.replace(taskNotificationPlan(data, new Date(), { digest: false }), Date.now())
      const done: TaskData = { ...data, cards: [{ ...open, doneAt: new Date().toISOString() }] }
      scheduler.replace(taskNotificationPlan(done, new Date(), { digest: false }), Date.now())
      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
      expect(notify).not.toHaveBeenCalled()
    })
  })
})
