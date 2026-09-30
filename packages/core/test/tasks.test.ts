import { describe, expect, it } from 'vitest'
import {
  TASK_ACTIVITY_LIMIT, appendTaskActivity, checklistProgress, isTaskCardInput, positionBetween, positionsTooClose,
  taskActivityFor, taskDueAt, taskDueLabel, taskMediaIds, taskReminderAt, withTaskActivity,
  type TaskAttachment, type TaskCardInput, type TaskNames
} from '../src/tasks'

const card = (overrides: Partial<TaskCardInput> = {}): TaskCardInput => ({
  boardId: 'b-1', listId: 'l-1', title: 'Pay rent', description: '', position: 1024, labelIds: [], priority: 'none',
  dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [], attachments: [],
  activity: [], ...overrides
})

const file = (overrides: Partial<TaskAttachment> = {}): TaskAttachment => ({
  id: 'a-1', mediaId: 'm-1', kind: 'file', mimeType: 'application/pdf', fileName: 'lease.pdf', size: 2000,
  width: null, height: null, durationSeconds: null, previewId: null, addedAt: '2026-09-30T12:00:00.000Z', ...overrides
})

const names: TaskNames = {
  list: (id) => ({ 'l-1': 'To Do', 'l-2': 'Doing' }[id] ?? null),
  label: (id) => ({ 'x-1': 'Home' }[id] ?? null),
  board: (id) => ({ 'b-1': 'Life', 'b-2': 'Work' }[id] ?? null)
}

const AT = '2026-09-30T12:00:00.000Z'

describe('card validation', () => {
  it('accepts a plain card and a full one', () => {
    expect(isTaskCardInput(card())).toBe(true)
    expect(isTaskCardInput(card({
      labelIds: ['x-1'], priority: 'urgent', dueDate: '2026-10-03', dueTime: '17:30', reminderMinutes: 60,
      checklists: [{ id: 'c-1', title: 'Steps', items: [{ id: 'i-1', text: 'Sign', doneAt: null }] }],
      attachments: [file()], activity: [{ at: AT, kind: 'create', text: 'Added this card to "To Do"' }]
    }))).toBe(true)
  })

  it('refuses a time or a reminder without a date', () => {
    expect(isTaskCardInput(card({ dueTime: '17:30' }))).toBe(false)
    expect(isTaskCardInput(card({ reminderMinutes: 60 }))).toBe(false)
  })

  it('refuses a blank title, a bad time, and repeated labels', () => {
    expect(isTaskCardInput(card({ title: '  ' }))).toBe(false)
    expect(isTaskCardInput(card({ dueDate: '2026-10-03', dueTime: '24:00' }))).toBe(false)
    expect(isTaskCardInput(card({ labelIds: ['x-1', 'x-1'] }))).toBe(false)
  })

  it('refuses a reminder that is not one of the choices', () => {
    expect(isTaskCardInput({ ...card({ dueDate: '2026-10-03' }), reminderMinutes: 30 })).toBe(false)
  })
})

describe('positions', () => {
  it('fits between neighbours and past either end', () => {
    expect(positionBetween(null, null)).toBe(1024)
    expect(positionBetween(1024, null)).toBe(2048)
    expect(positionBetween(null, 1024)).toBe(0)
    expect(positionBetween(1024, 2048)).toBe(1536)
  })

  it('notices when a gap has run out', () => {
    expect(positionsTooClose(1, 1 + 1e-7)).toBe(true)
    expect(positionsTooClose(1, 2)).toBe(false)
    expect(positionsTooClose(null, 2)).toBe(false)
  })
})

describe('due dates and reminders', () => {
  it('puts a date-only card at the end of its day', () => {
    const due = taskDueAt('2026-10-03', null)
    expect([due.getDate(), due.getHours(), due.getMinutes()]).toEqual([3, 23, 59])
  })

  it('reminds before a timed card and on the morning for a date-only one', () => {
    const timed = taskReminderAt({ dueDate: '2026-10-03', dueTime: '17:30', reminderMinutes: 60 })
    expect([timed?.getDate(), timed?.getHours(), timed?.getMinutes()]).toEqual([3, 16, 30])
    const morning = taskReminderAt({ dueDate: '2026-10-03', dueTime: null, reminderMinutes: 0 })
    expect([morning?.getDate(), morning?.getHours()]).toEqual([3, 9])
    const dayBefore = taskReminderAt({ dueDate: '2026-10-01', dueTime: null, reminderMinutes: 1440 })
    expect([dayBefore?.getMonth(), dayBefore?.getDate(), dayBefore?.getHours()]).toEqual([8, 30, 9])
    expect(taskReminderAt({ dueDate: '2026-10-03', dueTime: null, reminderMinutes: null })).toBeNull()
  })

  it('labels a due date in words', () => {
    expect(taskDueLabel('2026-10-03', '17:30', 2026)).toBe('Oct 3 at 5:30 PM')
    expect(taskDueLabel('2027-01-09', null, 2026)).toBe('Jan 9, 2027')
    expect(taskDueLabel('2026-10-03', '00:05')).toBe('Oct 3 at 12:05 AM')
  })
})

describe('activity', () => {
  it('logs a new card and a move between lists', () => {
    expect(taskActivityFor(null, card(), names, AT).map((entry) => entry.text)).toEqual(['Added this card to "To Do"'])
    expect(taskActivityFor(card(), card({ listId: 'l-2' }), names, AT).map((entry) => entry.text))
      .toEqual(['Moved this card from "To Do" to "Doing"'])
  })

  it('logs done, due, labels, checklists, and files', () => {
    const before = card({ checklists: [{ id: 'c-1', title: 'Steps', items: [{ id: 'i-1', text: 'Sign', doneAt: null }] }] })
    const after = card({
      doneAt: AT, dueDate: '2026-10-03', dueTime: null, reminderMinutes: 0, labelIds: ['x-1'], priority: 'high',
      checklists: [{ id: 'c-1', title: 'Steps', items: [{ id: 'i-1', text: 'Sign', doneAt: AT }] }],
      attachments: [file()]
    })
    expect(taskActivityFor(before, after, names, AT).map((entry) => entry.text)).toEqual([
      'Marked this card as done',
      'Set the due date to Oct 3',
      'Set the priority to High',
      'Added the label "Home"',
      'Completed "Sign" on "Steps"',
      'Attached "lease.pdf"'
    ])
  })

  it('logs a board move once instead of a list move', () => {
    const texts = taskActivityFor(card(), card({ boardId: 'b-2', listId: 'l-9', labelIds: [] }), names, AT).map((entry) => entry.text)
    expect(texts).toEqual(['Moved this card from "Life" to "Work"'])
  })

  it('adds nothing for an edit that changes only the position', () => {
    const before = card()
    expect(withTaskActivity(before, card({ position: 5 }), names, AT).activity).toEqual([])
  })

  it('keeps only the newest entries', () => {
    const full = Array.from({ length: TASK_ACTIVITY_LIMIT }, (_, index) => ({ at: AT, kind: 'rename' as const, text: `Entry ${index}` }))
    const next = appendTaskActivity(full, [{ at: AT, kind: 'done', text: 'Last' }])
    expect(next).toHaveLength(TASK_ACTIVITY_LIMIT)
    expect(next[0].text).toBe('Entry 1')
    expect(next[next.length - 1].text).toBe('Last')
  })
})

describe('checklists and files', () => {
  it('counts items across checklists', () => {
    expect(checklistProgress([
      { id: 'c-1', title: 'A', items: [{ id: 'i-1', text: 'x', doneAt: AT }, { id: 'i-2', text: 'y', doneAt: null }] },
      { id: 'c-2', title: 'B', items: [{ id: 'i-3', text: 'z', doneAt: AT }] }
    ])).toEqual({ done: 2, total: 3 })
  })

  it('lists every file and preview a card needs', () => {
    expect(taskMediaIds({ attachments: [file(), file({ id: 'a-2', mediaId: 'm-2', kind: 'photo', previewId: 'p-2' })] }))
      .toEqual(['m-1', 'm-2', 'p-2'])
  })
})
