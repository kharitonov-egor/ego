import { afterEach, describe, expect, it } from 'vitest'
import { validateAssistantArguments } from '@ego/core'
import {
  assistantSystemPrompt, describeWrite, executeAssistantRead, executeAssistantWrite, type ToolContext
} from '../src/assistant-tools'
import { readTaskRows } from '../src/reads'
import { toTaskCardRecord } from '../src/rows'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TODAY = '2026-09-12'
let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

async function context(): Promise<ToolContext> {
  ledger = await seedLedger()
  const db = ledger.db
  await exec(db, `INSERT INTO task_boards (id, name, icon, position, hide_done, created_at, updated_at, revision)
    VALUES ('b-life', 'Life', '🏠', 1024, 0, ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO task_lists (id, board_id, name, position, created_at, updated_at, revision)
    VALUES ('l-todo', 'b-life', 'To Do', 1024, ?, ?, 1), ('l-done', 'b-life', 'Done', 2048, ?, ?, 1)`, [NOW, NOW, NOW, NOW])
  await exec(db, `INSERT INTO task_labels (id, board_id, name, color, position, created_at, updated_at, revision)
    VALUES ('x-home', 'b-life', 'Home', 'green', 1024, ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO task_cards (id, board_id, list_id, title, description, position, due_date, created_at, updated_at, revision)
    VALUES ('k-rent', 'b-life', 'l-todo', 'Pay rent', '**Before** the 15th', 1024, '2026-09-14', ?, ?, 1)`, [NOW, NOW])
  return {
    env: { DB: db },
    device: { deviceId: 'device-a', name: 'Phone', datasetId: 'ego' },
    now: NOW,
    today: TODAY,
    timeZone: 'America/New_York',
    units: 'imperial'
  }
}

async function card(ctx: ToolContext, id: string) {
  const rows = await readTaskRows(ctx.env.DB)
  const row = rows.cards.find((item) => item.id === id)
  return row ? toTaskCardRecord(row) : null
}

describe('Tasks in the AI chat', () => {
  it('names the boards, lists, and labels in the system prompt', async () => {
    const ctx = await context()
    const prompt = await assistantSystemPrompt(ctx)
    expect(prompt).toContain('"id":"b-life","name":"Life","lists":[{"id":"l-todo","name":"To Do"},{"id":"l-done","name":"Done"}]')
    expect(prompt).toContain('"labels":[{"id":"x-home","name":"Home","color":"green"}]')
  })

  it('reads open cards due in a range', async () => {
    const ctx = await context()
    const args = { boardId: null, includeDone: null, dueFrom: '2026-09-12', dueTo: '2026-09-20', query: null }
    expect(validateAssistantArguments('read_tasks', args).ok).toBe(true)
    const outcome = await executeAssistantRead(ctx, { name: 'read_tasks', args, callId: 'call-1' })
    expect(outcome.data).toEqual({
      cards: [{
        id: 'k-rent', title: 'Pay rent', board: 'Life', list: 'To Do', labels: [], priority: null, due: '2026-09-14',
        done: false, checklist: null, attachments: 0, description: 'Before the 15th'
      }],
      total: 1,
      truncated: false
    })
    expect(outcome.trail).toBe('Read 1 card')
  })

  it('describes a new card, then adds it with a due time, a label, and a checklist', async () => {
    const ctx = await context()
    const args = {
      listId: 'l-todo', title: 'Call the landlord', description: null, dueDate: '2026-09-13', dueTime: '17:30',
      priority: 'high', labelIds: ['x-home', 'x-missing'], checklist: ['Find the number', 'Ask about the heater']
    }
    expect(validateAssistantArguments('add_task_card', args).ok).toBe(true)
    expect(await describeWrite(ctx, 'add_task_card', args)).toEqual({
      title: 'Add a card', lines: ['"Call the landlord" in To Do', 'Due Sep 13 at 5:30 PM']
    })
    const outcome = await executeAssistantWrite(ctx, { name: 'add_task_card', args, callId: 'call-2' })
    const id = (outcome.data as { id: string }).id
    const added = await card(ctx, id)
    expect(added).toMatchObject({
      listId: 'l-todo', title: 'Call the landlord', priority: 'high', dueDate: '2026-09-13', dueTime: '17:30',
      reminderMinutes: 60, labelIds: ['x-home'], position: 2048
    })
    expect(added?.checklists[0].items.map((item) => item.text)).toEqual(['Find the number', 'Ask about the heater'])
    expect(added?.activity.map((entry) => entry.text)).toEqual(['Added this card to "To Do"'])
    expect(outcome.trail).toBe('Added "Call the landlord" to To Do')
  })

  it('describes a change to a card, then marks it done and moves it', async () => {
    const ctx = await context()
    const args = {
      cardId: 'k-rent', done: true, listId: 'l-done', title: null, dueDate: null, dueTime: null, clearDue: null,
      priority: null, archived: null
    }
    expect(validateAssistantArguments('update_task_card', args).ok).toBe(true)
    expect(await describeWrite(ctx, 'update_task_card', args)).toEqual({
      title: 'Change a card', lines: ['"Pay rent"', 'Mark done', 'Move to Done']
    })
    const outcome = await executeAssistantWrite(ctx, { name: 'update_task_card', args, callId: 'call-3' })
    expect(await card(ctx, 'k-rent')).toMatchObject({ listId: 'l-done', doneAt: NOW, revision: 2 })
    expect((outcome.data as { changes: string[] }).changes).toEqual(['Moved this card from "To Do" to "Done"', 'Marked this card as done'])
  })

  it('moves a card it marks done to the bottom of Done when the board says so', async () => {
    const ctx = await context()
    await exec(ctx.env.DB, `INSERT INTO task_cards (id, board_id, list_id, title, description, position, done_at, created_at, updated_at, revision)
      VALUES ('k-old', 'b-life', 'l-done', 'Old', '', 4096, ?, ?, ?, 1)`, [NOW, NOW, NOW])
    const args = {
      cardId: 'k-rent', done: true, listId: null, title: null, dueDate: null, dueTime: null, clearDue: null, priority: null, archived: null
    }
    await executeAssistantWrite(ctx, { name: 'update_task_card', args, callId: 'call-6' })
    expect(await card(ctx, 'k-rent')).toMatchObject({ listId: 'l-todo', doneAt: NOW })
    await exec(ctx.env.DB, "UPDATE task_boards SET move_done = 1 WHERE id = 'b-life'")
    await executeAssistantWrite(ctx, { name: 'update_task_card', args: { ...args, done: false }, callId: 'call-7' })
    await executeAssistantWrite(ctx, { name: 'update_task_card', args, callId: 'call-8' })
    expect(await card(ctx, 'k-rent')).toMatchObject({ listId: 'l-done', position: 5120, doneAt: NOW })
  })

  it('refuses a list on another board and reports a change that changes nothing', async () => {
    const ctx = await context()
    await exec(ctx.env.DB, `INSERT INTO task_boards (id, name, icon, position, hide_done, created_at, updated_at, revision)
      VALUES ('b-work', 'Work', '', 2048, 0, ?, ?, 1)`, [NOW, NOW])
    await exec(ctx.env.DB, `INSERT INTO task_lists (id, board_id, name, position, created_at, updated_at, revision)
      VALUES ('l-work', 'b-work', 'Inbox', 1024, ?, ?, 1)`, [NOW, NOW])
    const base = { cardId: 'k-rent', done: null, listId: null, title: null, dueDate: null, dueTime: null, clearDue: null, priority: null, archived: null }
    await expect(executeAssistantWrite(ctx, { name: 'update_task_card', args: { ...base, listId: 'l-work' }, callId: 'call-4' }))
      .rejects.toThrow('A card can only move to a list on its own board')
    const unchanged = await executeAssistantWrite(ctx, { name: 'update_task_card', args: { ...base, title: 'Pay rent' }, callId: 'call-5' })
    expect(unchanged.trail).toBe('"Pay rent" was already that way')
  })
})
