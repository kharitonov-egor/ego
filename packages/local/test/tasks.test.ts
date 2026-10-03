import { describe, expect, it } from 'vitest'
import type { TaskBoardRecord, TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import {
  NO_FILTER, carryLabels, dueBadge, matchesFilter, placeAt, upcomingSections
} from '../src/tasks/board'
import { parseInline, parseMarkdown, prefixLines, toggleTaskLine, wrapSelection } from '../src/tasks/markdown'
import { cardIdFromNotification, taskNotificationPlan } from '../src/tasks/reminders'
import type { TaskData } from '../src/tasks/repository'

const STAMP = '2026-09-01T00:00:00.000Z'

const board = (overrides: Partial<TaskBoardRecord> = {}): TaskBoardRecord => ({
  id: 'b-1', name: 'Life', icon: '', position: 1024, hideDone: false, archivedAt: null,
  createdAt: STAMP, updatedAt: STAMP, revision: 1, ...overrides
})

const list = (overrides: Partial<TaskListRecord> = {}): TaskListRecord => ({
  id: 'l-1', boardId: 'b-1', name: 'To Do', position: 1024, archivedAt: null,
  createdAt: STAMP, updatedAt: STAMP, revision: 1, ...overrides
})

const card = (overrides: Partial<TaskCardRecord> = {}): TaskCardRecord => ({
  id: 'k-1', boardId: 'b-1', listId: 'l-1', title: 'Pay rent', description: '', position: 1024, labelIds: [],
  priority: 'none', dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [],
  attachments: [], activity: [], createdAt: STAMP, updatedAt: STAMP, revision: 1, ...overrides
})

const data = (cards: TaskCardRecord[], overrides: Partial<TaskData> = {}): TaskData => ({
  boards: [board()], lists: [list()], labels: [], cards, uploads: new Map(), ...overrides
})

/** Wednesday, 30 September 2026, 8 AM on the phone's clock. */
const NOW = new Date(2026, 8, 30, 8, 0, 0)

describe('markdown', () => {
  it('reads inline styles and links', () => {
    expect(parseInline('**Pay** the _rent_ by ~~Friday~~ `now` [here](https://x.com)')).toEqual([
      { text: 'Pay', bold: true, italic: false, strike: false, code: false, link: null },
      { text: ' the ', bold: false, italic: false, strike: false, code: false, link: null },
      { text: 'rent', bold: false, italic: true, strike: false, code: false, link: null },
      { text: ' by ', bold: false, italic: false, strike: false, code: false, link: null },
      { text: 'Friday', bold: false, italic: false, strike: true, code: false, link: null },
      { text: ' ', bold: false, italic: false, strike: false, code: false, link: null },
      { text: 'now', bold: false, italic: false, strike: false, code: true, link: null },
      { text: ' ', bold: false, italic: false, strike: false, code: false, link: null },
      { text: 'here', bold: false, italic: false, strike: false, code: false, link: 'https://x.com' }
    ])
  })

  it('links a bare address without its closing punctuation', () => {
    const spans = parseInline('See https://ego.dev/docs.')
    expect(spans.map((span) => [span.text, span.link])).toEqual([['See ', null], ['https://ego.dev/docs', 'https://ego.dev/docs'], ['.', null]])
  })

  it('leaves underscores inside words alone', () => {
    expect(parseInline('snake_case_name')).toHaveLength(1)
  })

  it('reads blocks, lists, and checkboxes with their source lines', () => {
    const blocks = parseMarkdown('# Move\nFirst line\nsecond line\n\n- [ ] Book van\n  - [x] Call\n1. One\n> quoted\n---\n```\ncode\n```')
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'item', 'item', 'item', 'quote', 'rule', 'code'])
    expect(blocks[1]).toMatchObject({ spans: [{ text: 'First line\nsecond line' }] })
    expect(blocks[2]).toMatchObject({ checked: false, depth: 0, line: 4 })
    expect(blocks[3]).toMatchObject({ checked: true, depth: 1, line: 5 })
    expect(blocks[4]).toMatchObject({ ordered: true, number: 1 })
    expect(blocks[7]).toEqual({ type: 'code', text: 'code' })
  })

  it('ticks a checkbox in the source', () => {
    expect(toggleTaskLine('a\n- [ ] Book van', 1)).toBe('a\n- [x] Book van')
    expect(toggleTaskLine('- [x] Book van', 0)).toBe('- [ ] Book van')
    expect(toggleTaskLine('plain', 0)).toBe('plain')
  })

  it('wraps and unwraps a selection, and prefixes lines', () => {
    const bold = wrapSelection('pay rent', { start: 4, end: 8 }, '**')
    expect(bold).toEqual({ text: 'pay **rent**', selection: { start: 6, end: 10 } })
    expect(wrapSelection(bold.text, bold.selection, '**').text).toBe('pay rent')
    const listed = prefixLines('one\ntwo', { start: 0, end: 7 }, () => '- ')
    expect(listed.text).toBe('- one\n- two')
    expect(prefixLines(listed.text, { start: 0, end: listed.text.length }, () => '- ').text).toBe('one\ntwo')
    expect(prefixLines('a\nb', { start: 0, end: 3 }, (index) => `${index + 1}. `).text).toBe('1. a\n2. b')
  })
})

describe('placing a moved card', () => {
  const siblings = [{ id: 'a', position: 1024 }, { id: 'b', position: 2048 }]

  it('fits between neighbours without touching them', () => {
    expect(placeAt(siblings, 1, 'x')).toEqual({ position: 1536, renumber: null })
    expect(placeAt(siblings, 0, 'x').position).toBe(0)
    expect(placeAt(siblings, 9, 'x').position).toBe(3072)
  })

  it('spaces the whole list out again when the gap has run out', () => {
    const tight = [{ id: 'a', position: 1 }, { id: 'b', position: 1 + 1e-7 }]
    expect(placeAt(tight, 1, 'x')).toEqual({
      position: 2048,
      renumber: [{ id: 'a', position: 1024 }, { id: 'x', position: 2048 }, { id: 'b', position: 3072 }]
    })
  })

  it('keeps a label on another board only when one matches by name and color', () => {
    const from = [{ id: 'x-1', boardId: 'b-1', name: 'Home', color: 'green' as const, position: 1, createdAt: STAMP, updatedAt: STAMP, revision: 1 }]
    const to = [
      { id: 'y-1', boardId: 'b-2', name: 'Home', color: 'green' as const, position: 1, createdAt: STAMP, updatedAt: STAMP, revision: 1 },
      { id: 'y-2', boardId: 'b-2', name: 'Home', color: 'red' as const, position: 2, createdAt: STAMP, updatedAt: STAMP, revision: 1 }
    ]
    expect(carryLabels(['x-1', 'gone'], from, to)).toEqual(['y-1'])
  })
})

describe('due dates on a card', () => {
  it('names nearby days and flags overdue and soon', () => {
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: '07:00' }), NOW)).toEqual({ label: 'Today at 7:00 AM', state: 'overdue' })
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: null }), NOW)).toEqual({ label: 'Today', state: 'soon' })
    expect(dueBadge(card({ dueDate: '2026-10-01', dueTime: '17:00' }), NOW)).toEqual({ label: 'Tomorrow at 5:00 PM', state: 'later' })
    expect(dueBadge(card({ dueDate: '2026-10-09' }), NOW)).toEqual({ label: 'Oct 9', state: 'later' })
    expect(dueBadge(card({ dueDate: '2026-09-20', doneAt: STAMP }), NOW)?.state).toBe('done')
  })

  it('filters by text, label, priority, and due', () => {
    const rent = card({ title: 'Pay rent', labelIds: ['x-1'], priority: 'high', dueDate: '2026-09-29' })
    expect(matchesFilter(rent, { ...NO_FILTER, text: 'RENT' }, NOW)).toBe(true)
    expect(matchesFilter(rent, { ...NO_FILTER, labelIds: ['x-2'] }, NOW)).toBe(false)
    expect(matchesFilter(rent, { ...NO_FILTER, priorities: ['high', 'urgent'] }, NOW)).toBe(true)
    expect(matchesFilter(rent, { ...NO_FILTER, due: ['overdue'] }, NOW)).toBe(true)
    expect(matchesFilter(rent, { ...NO_FILTER, due: ['none'] }, NOW)).toBe(false)
  })

  it('groups open cards from live boards for Upcoming', () => {
    const sections = upcomingSections(data([
      card({ id: 'late', dueDate: '2026-09-28' }),
      card({ id: 'today', dueDate: '2026-09-30', dueTime: '18:00' }),
      card({ id: 'tomorrow', dueDate: '2026-10-01' }),
      card({ id: 'week', dueDate: '2026-10-05' }),
      card({ id: 'later', dueDate: '2026-11-01' }),
      card({ id: 'done', dueDate: '2026-09-30', doneAt: STAMP }),
      card({ id: 'archived', dueDate: '2026-09-30', archivedAt: STAMP }),
      card({ id: 'hidden', listId: 'l-2', dueDate: '2026-09-30' })
    ], { lists: [list(), list({ id: 'l-2', archivedAt: STAMP })] }), NOW)
    expect(sections.map((section) => [section.key, section.data.map((item) => item.id)])).toEqual([
      ['overdue', ['late']], ['today', ['today']], ['tomorrow', ['tomorrow']], ['week', ['week']], ['later', ['later']]
    ])
  })
})

describe('task notifications', () => {
  it('plans a reminder per open card with a future reminder time', () => {
    const plan = taskNotificationPlan(data([
      card({ id: 'k-1', title: 'Pay rent', dueDate: '2026-09-30', dueTime: '17:30', reminderMinutes: 60 }),
      card({ id: 'k-2', dueDate: '2026-09-30', dueTime: '08:30', reminderMinutes: 60 }),
      card({ id: 'k-3', dueDate: '2026-10-01', dueTime: '09:00', reminderMinutes: 60, doneAt: STAMP }),
      card({ id: 'k-4', dueDate: '2026-10-01', dueTime: null, reminderMinutes: null })
    ]), NOW, { digest: false })
    expect(plan).toEqual([{
      identifier: 'ego-task-k-1', at: new Date(2026, 8, 30, 16, 30), title: 'Pay rent', body: 'Due today at 5:30 PM · Life / To Do'
    }])
    expect(cardIdFromNotification(plan[0].identifier)).toBe('k-1')
  })

  it('sends one morning digest per day instead of each date-only reminder', () => {
    const plan = taskNotificationPlan(data([
      card({ id: 'k-1', title: 'Pay rent', dueDate: '2026-10-01', reminderMinutes: 0 }),
      card({ id: 'k-2', title: 'Call mom', dueDate: '2026-10-01', dueTime: '18:00', reminderMinutes: 10 }),
      card({ id: 'k-3', title: 'Dentist', dueDate: '2026-09-30', dueTime: '07:00', reminderMinutes: null })
    ]), NOW, { digest: true })
    expect(plan.map((item) => item.identifier)).toEqual(['ego-task-digest-2026-10-01', 'ego-task-k-2'])
    expect(plan[0]).toMatchObject({ title: '2 cards due today', body: 'Call mom (6:00 PM), Pay rent', at: new Date(2026, 9, 1, 9) })
    expect(cardIdFromNotification(plan[0].identifier)).toBeNull()
  })
})
