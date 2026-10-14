import { describe, expect, it } from 'vitest'
import type { TaskBoardRecord, TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import { writeRecord } from '../src/database/writes'
import {
  NO_FILTER, cardInput, carryLabels, columnHex, doneList, doneMove, dueBadge, focusListOf, hexWithAlpha, homeBoardId, inboxCardInput,
  inboxList, listCardMoves, marksDone, matchesFilter, placeAt, upcomingSections
} from '../src/tasks/board'
import { parseInline, parseMarkdown, prefixLines, toggleTaskLine, wrapSelection } from '../src/tasks/markdown'
import { cardIdFromNotification, taskNotificationPlan } from '../src/tasks/reminders'
import { localTasks, type TaskData } from '../src/tasks/repository'
import { openTestLedger } from './local-db'

const STAMP = '2026-09-01T00:00:00.000Z'

const board = (overrides: Partial<TaskBoardRecord> = {}): TaskBoardRecord => ({
  id: 'b-1', name: 'Life', icon: '', position: 1024, hideDone: false, moveDone: false, labelStyle: 'names', archivedAt: null,
  createdAt: STAMP, updatedAt: STAMP, revision: 1, ...overrides
})

const list = (overrides: Partial<TaskListRecord> = {}): TaskListRecord => ({
  id: 'l-1', boardId: 'b-1', name: 'To Do', position: 1024, archivedAt: null, kind: 'cards', color: null, icon: '', border: false,
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
  it('names nearby days and flags overdue, today, and soon', () => {
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: '07:00' }), NOW)).toEqual({ label: '7:00 AM', state: 'overdue' })
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: null }), NOW)).toEqual({ label: 'EOD', state: 'today' })
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: '23:59' }), NOW)).toEqual({ label: 'EOD', state: 'today' })
    expect(dueBadge(card({ dueDate: '2026-09-30', dueTime: '17:00' }), NOW)).toEqual({ label: '5:00 PM', state: 'today' })
    expect(dueBadge(card({ dueDate: '2026-10-01', dueTime: '07:00' }), NOW)).toEqual({ label: 'Tomorrow at 7:00 AM', state: 'soon' })
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
      identifier: 'ego-task-k-1', at: new Date(2026, 8, 30, 16, 30), title: 'Pay rent', body: 'Due at 5:30 PM · Life / To Do'
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

describe('inbox', () => {
  const lists = [
    list(),
    list({ id: 'l-inbox', name: 'Inbox', kind: 'inbox', position: 512 }),
    list({ id: 'l-old', boardId: 'b-old', name: 'Inbox', kind: 'inbox' })
  ]
  const boards = [board({ id: 'b-old', position: 0, archivedAt: STAMP }), board()]

  it('finds the Inbox on a live board and opens that board', () => {
    const tasks = data([], { boards, lists })
    expect(inboxList(tasks)?.id).toBe('l-inbox')
    expect(homeBoardId(tasks)).toBe('b-1')
  })

  it('has no home without an Inbox', () => {
    expect(homeBoardId(data([]))).toBeNull()
    expect(inboxCardInput(data([]), { title: 'Call mom', description: '', attachments: [] }, STAMP)).toBeNull()
  })

  it('adds a logged card to the bottom of the Inbox', () => {
    const tasks = data([card({ id: 'k-1', listId: 'l-inbox', position: 4096 })], { boards, lists })
    const input = inboxCardInput(tasks, { title: '  Call mom ', description: 'About Sunday', attachments: [] }, STAMP)
    expect(input).toMatchObject({ boardId: 'b-1', listId: 'l-inbox', title: 'Call mom', description: 'About Sunday', position: 5120 })
    expect(input?.activity).toEqual([{ at: STAMP, kind: 'create', text: 'Added this card to "Inbox"' }])
  })
})

describe('moving done cards to Done', () => {
  const lists = [
    list(),
    list({ id: 'l-old', name: 'Done', position: 1536, archivedAt: STAMP }),
    list({ id: 'l-done', name: 'Done!', position: 2048 }),
    list({ id: 'l-work', name: 'Work', kind: 'work', position: 3072 })
  ]
  const cards = [card(), card({ id: 'k-2', listId: 'l-done', position: 4096, doneAt: STAMP }), card({ id: 'k-3', listId: 'l-work' })]
  const tasks = (moveDone: boolean): TaskData => data(cards, { boards: [board({ moveDone })], lists })
  const checked = (from: TaskCardRecord) => ({ ...cardInput(from), doneAt: STAMP })

  it('finds the first live list named Done', () => {
    expect(doneList(tasks(true), 'b-1')?.id).toBe('l-done')
    expect(doneList(data([]), 'b-1')).toBeNull()
  })

  it('sends a done card to the bottom of Done when the board says so', () => {
    expect(doneMove(tasks(true), checked(cards[0]))).toMatchObject({ listId: 'l-done', position: 5120, doneAt: STAMP })
  })

  it('leaves the card where it is when the setting is off', () => {
    expect(doneMove(tasks(false), checked(cards[0]))).toBeNull()
  })

  it('leaves Work cards, open cards, and cards already in Done alone', () => {
    expect(doneMove(tasks(true), checked(cards[2]))).toBeNull()
    expect(doneMove(tasks(true), cardInput(cards[0]))).toBeNull()
    expect(doneMove(tasks(true), cardInput(cards[1]))).toBeNull()
  })

  it('treats only a check in place as marking done', () => {
    const open = cardInput(cards[0])
    expect(marksDone(open, checked(cards[0]))).toBe(true)
    expect(marksDone(open, { ...checked(cards[0]), listId: 'l-done' })).toBe(false)
    expect(marksDone(checked(cards[0]), { ...checked(cards[0]), title: 'Pay the rent' })).toBe(false)
    expect(marksDone(checked(cards[0]), open)).toBe(false)
  })
})

describe('moving every card in a list', () => {
  const label = (id: string, boardId: string) => ({ id, boardId, name: 'Home', color: 'green' as const, position: 1, createdAt: STAMP, updatedAt: STAMP, revision: 1 })
  const tasks = data([
    card({ id: 'a', listId: 'l-backlog', position: 2048, labelIds: ['x-home'] }),
    card({ id: 'b', listId: 'l-backlog', position: 1024 }),
    card({ id: 'old', listId: 'l-backlog', position: 512, archivedAt: STAMP }),
    card({ id: 't', position: 1024 }),
    card({ id: 'u', position: 3072 })
  ], {
    boards: [board(), board({ id: 'b-2', name: 'Work' })],
    lists: [list(), list({ id: 'l-backlog', name: 'Backlog', position: 2048 }), list({ id: 'l-later', boardId: 'b-2', name: 'Later' })],
    labels: [label('x-home', 'b-1'), label('y-home', 'b-2')]
  })

  it('keeps their order above or below the cards already there', () => {
    const bottom = listCardMoves(tasks, 'l-backlog', 'l-1', 'bottom', STAMP)
    expect(bottom.map(({ card, input }) => [card.id, input.listId, input.position])).toEqual([['b', 'l-1', 4096], ['a', 'l-1', 5120]])
    expect(listCardMoves(tasks, 'l-backlog', 'l-1', 'top', STAMP).map(({ input }) => input.position)).toEqual([-1024, 0])
  })

  it('logs each move and carries labels to another board', () => {
    const [first, second] = listCardMoves(tasks, 'l-backlog', 'l-later', 'top', STAMP)
    expect(first.input).toMatchObject({ boardId: 'b-2', listId: 'l-later', position: 1024 })
    expect(second.input).toMatchObject({ boardId: 'b-2', listId: 'l-later', position: 2048, labelIds: ['y-home'] })
    expect(second.input.activity).toContainEqual({ at: STAMP, kind: 'move', text: 'Moved this card from "Life" to "Work"' })
    expect(listCardMoves(tasks, 'l-backlog', 'l-1', 'top', STAMP)[0].input.activity)
      .toContainEqual({ at: STAMP, kind: 'move', text: 'Moved this card from "Backlog" to "To Do"' })
  })

  it('moves nothing into the same list or one that is gone', () => {
    expect(listCardMoves(tasks, 'l-backlog', 'l-backlog', 'top', STAMP)).toEqual([])
    expect(listCardMoves(tasks, 'l-backlog', 'l-gone', 'top', STAMP)).toEqual([])
  })
})

describe('column looks and focus mode', () => {
  const labelHex = { green: '#4f9d69', yellow: '#c4a13a', orange: '#cc7a3d', red: '#c95757', purple: '#8b6fc4', blue: '#4f82c9', sky: '#3f9fb3', pink: '#c0619a' }

  it('draws a label color the way labels look and a hex as it is', () => {
    expect(columnHex(null, labelHex)).toBeNull()
    expect(columnHex('sky', labelHex)).toBe('#3f9fb3')
    expect(columnHex('#006747', labelHex)).toBe('#006747')
    expect(hexWithAlpha('#006747', 0.24)).toBe('rgba(0, 103, 71, 0.24)')
  })

  it('opens focus mode on the list asked for, else the Inbox, else the first list', () => {
    const lists = [list({ id: 'backlog' }), list({ id: 'inbox', kind: 'inbox' }), list({ id: 'later' })]
    expect(focusListOf(lists, 'later')?.id).toBe('later')
    expect(focusListOf(lists, 'gone')?.id).toBe('inbox')
    expect(focusListOf(lists, null)?.id).toBe('inbox')
    expect(focusListOf([list({ id: 'only' })], null)?.id).toBe('only')
    expect(focusListOf([], null)).toBeNull()
  })
})

describe('a board from before label styles', () => {
  it('stores a pulled board without a style as names', async () => {
    const db = await openTestLedger()
    const legacy: Record<string, unknown> = { ...board({ id: 'b-old' }) }
    delete legacy.labelStyle
    const record: unknown = legacy
    await writeRecord(db, { entity: 'taskBoard', record: record as TaskBoardRecord })
    expect((await localTasks(db)).boards.find((item) => item.id === 'b-old')?.labelStyle).toBe('names')
    await db.close()
  })
})
