import { afterEach, describe, expect, it } from 'vitest'
import { taskCardInput, type TaskCardInput } from '@ego/core'
import type { SyncCommand } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { applyOperation } from '../src/commands'
import { query } from '../src/reads'
import { handle } from '../src/router'
import { toTaskCardRecord, type TaskCardRow } from '../src/rows'
import { TRELLO_WORK_LISTS, mergeCard, syncTrelloWork, syncTrelloWorkAfterWrites, trelloDue, type Base } from '../src/trello-work'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const { selected: SELECTED, progress: PROGRESS, done: DONE } = TRELLO_WORK_LISTS
const ZONE = 'America/New_York'
const TOKEN = 'device-token-that-is-long-enough-0123456789'

interface FakeCard {
  id: string
  name: string
  desc: string
  due: string | null
  idList: string
  pos: number
}

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | null
}

/** Just enough of Trello's REST API: two list reads, card updates, and new cards. */
function fakeTrello(cards: FakeCard[]) {
  const calls: Call[] = []
  let next = 1
  const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(url)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    calls.push({ method, path: pathname, body })
    const listRead = /^\/1\/lists\/(\w+)\/cards$/.exec(pathname)
    if (method === 'GET' && listRead) return reply(cards.filter((card) => card.idList === listRead[1]))
    const cardWrite = /^\/1\/cards\/(\w+)$/.exec(pathname)
    if (method === 'PUT' && cardWrite && body) {
      const card = cards.find((item) => item.id === cardWrite[1])
      if (!card) return reply({ message: 'not found' }, 404)
      if (typeof body.name === 'string') card.name = body.name
      if (typeof body.desc === 'string') card.desc = body.desc
      if ('due' in body) card.due = typeof body.due === 'string' ? body.due : null
      if (typeof body.idList === 'string') {
        card.idList = body.idList
        card.pos = Math.min(0, ...cards.map((item) => item.pos)) - 1
      }
      return reply(card)
    }
    if (method === 'POST' && pathname === '/1/cards' && body) {
      const card: FakeCard = {
        id: `new${String(next++).padStart(21, '0')}`, name: String(body.name), desc: String(body.desc ?? ''),
        due: typeof body.due === 'string' ? body.due : null, idList: String(body.idList), pos: 0
      }
      cards.push(card)
      return reply(card)
    }
    return reply({ message: 'unexpected' }, 400)
  }
  return { cards, calls, fetch, writes: () => calls.filter((call) => call.method !== 'GET') }
}

let server: Ledger | null = null

afterEach(() => {
  server?.close()
  server = null
})

async function apply(db: D1Database, entityId: string, expectedRevision: number | null, command: SyncCommand): Promise<void> {
  const result = await applyOperation(db, { operationId: crypto.randomUUID(), entityId, expectedRevision, createdAt: NOW, command }, NOW)
  if (!result.ok) throw new Error(result.error.message)
}

async function setup(withWorkList = true): Promise<Env> {
  server = await seedLedger()
  const db = server.db
  await apply(db, 'gtd', null, { entity: 'taskBoard', type: 'create', payload: { name: 'GTD', icon: '', position: 1024, hideDone: false, archivedAt: null } })
  await apply(db, 'inbox', null, { entity: 'taskList', type: 'create', payload: { boardId: 'gtd', name: 'Inbox', position: 1024, archivedAt: null, kind: 'inbox' } })
  if (withWorkList) {
    await apply(db, 'work', null, { entity: 'taskList', type: 'create', payload: { boardId: 'gtd', name: 'Work', position: 2048, archivedAt: null, kind: 'work' } })
  }
  return { DB: db, TRELLO_WORK_API_KEY: 'key', TRELLO_WORK_TOKEN: 'token' }
}

function sync(env: Env, trello: ReturnType<typeof fakeTrello>) {
  return syncTrelloWork(env, { fetch: trello.fetch, now: () => NOW, timeZone: ZONE })
}

async function cards(db: D1Database): Promise<Array<TaskCardInput & { id: string; revision: number }>> {
  const rows = await query<TaskCardRow>(db, 'SELECT * FROM task_cards WHERE deleted_at IS NULL ORDER BY position')
  return rows.map((row) => ({ ...taskCardInput(toTaskCardRecord(row)), id: row.id, revision: row.revision }))
}

async function card(db: D1Database, id: string): Promise<TaskCardInput & { id: string; revision: number }> {
  const found = (await cards(db)).find((item) => item.id === id)
  if (!found) throw new Error(`No card ${id}`)
  return found
}

/** A device's edit, through the same operation path a phone uses. */
async function edit(db: D1Database, id: string, change: (input: TaskCardInput) => TaskCardInput): Promise<void> {
  const current = await card(db, id)
  await apply(db, id, current.revision, { entity: 'taskCard', type: 'update', payload: change(taskCardInput(current)) })
}

async function labelId(db: D1Database, name: string): Promise<string> {
  const rows = await query<{ id: string }>(db, 'SELECT id FROM task_labels WHERE name = ? AND deleted_at IS NULL', [name])
  if (!rows[0]) throw new Error(`No label ${name}`)
  return rows[0].id
}

function trelloCard(id: string, idList: string, pos: number, overrides: Partial<FakeCard> = {}): FakeCard {
  return { id, name: `Card ${id}`, desc: '', due: null, idList, pos, ...overrides }
}

describe('the Work list and the work Trello board', () => {
  it('pulls both lists in, In Progress on top, each card tagged with its list', async () => {
    const env = await setup()
    const trello = fakeTrello([
      trelloCard('s1', SELECTED, 100), trelloCard('s2', SELECTED, 200),
      trelloCard('p1', PROGRESS, 100), trelloCard('p2', PROGRESS, 200),
      trelloCard('t1', '6ab56c84c5f60f68a6fb7bfa', 100)
    ])
    const result = await sync(env, trello)
    expect(result).toEqual({ ok: true, data: { changed: true, problem: null } })
    const work = (await cards(env.DB)).filter((item) => item.listId === 'work')
    expect(work.map((item) => item.id)).toEqual(['trello-p1', 'trello-p2', 'trello-s1', 'trello-s2'])
    const progress = await labelId(env.DB, 'In progress')
    const selected = await labelId(env.DB, 'Selected')
    expect(work[0]).toMatchObject({ title: 'Card p1', labelIds: [progress], boardId: 'gtd' })
    expect(work[2]).toMatchObject({ labelIds: [selected] })
    expect(work[0].activity.map((entry) => entry.text)).toEqual(['Added this card to "Work"'])
    expect(trello.writes()).toEqual([])

    const again = await sync(env, trello)
    expect(again).toEqual({ ok: true, data: { changed: false, problem: null } })
    expect(trello.writes()).toEqual([])
  })

  it('does nothing without a Work list', async () => {
    const env = await setup(false)
    const trello = fakeTrello([trelloCard('s1', SELECTED, 100)])
    expect(await sync(env, trello)).toEqual({ ok: true, data: { changed: false, problem: null } })
    expect(trello.calls).toEqual([])
  })

  it('sends Ego edits to Trello and Trello edits to Ego, and Trello wins a field both changed', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100, { desc: 'old' }), trelloCard('b', SELECTED, 200)])
    await sync(env, trello)

    await edit(env.DB, 'trello-a', (input) => ({ ...input, title: 'Renamed in Ego' }))
    trello.cards[0].desc = 'changed in Trello'
    await edit(env.DB, 'trello-b', (input) => ({ ...input, title: 'Ego name' }))
    trello.cards[1].name = 'Trello name'

    expect(await sync(env, trello)).toEqual({ ok: true, data: { changed: true, problem: null } })
    expect(trello.writes()).toEqual([{ method: 'PUT', path: '/1/cards/a', body: { name: 'Renamed in Ego' } }])
    expect(await card(env.DB, 'trello-a')).toMatchObject({ title: 'Renamed in Ego', description: 'changed in Trello' })
    expect(await card(env.DB, 'trello-b')).toMatchObject({ title: 'Trello name' })

    const before = trello.writes().length
    expect(await sync(env, trello)).toEqual({ ok: true, data: { changed: false, problem: null } })
    expect(trello.writes()).toHaveLength(before)
  })

  it('moves the Trello card when the label changes, and to Done! when the card is done, then archives it', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100), trelloCard('b', SELECTED, 200)])
    await sync(env, trello)
    const progress = await labelId(env.DB, 'In progress')

    await edit(env.DB, 'trello-a', (input) => ({ ...input, labelIds: [progress] }))
    await edit(env.DB, 'trello-b', (input) => ({ ...input, doneAt: NOW }))
    await sync(env, trello)
    expect(trello.writes()).toEqual([
      { method: 'PUT', path: '/1/cards/a', body: { idList: PROGRESS, pos: 'top' } },
      { method: 'PUT', path: '/1/cards/b', body: { idList: DONE, pos: 'top' } }
    ])
    expect((await card(env.DB, 'trello-b')).archivedAt).toBeNull()

    await sync(env, trello)
    expect(await card(env.DB, 'trello-b')).toMatchObject({ archivedAt: NOW, doneAt: NOW })
    expect((await card(env.DB, 'trello-a')).archivedAt).toBeNull()
  })

  it('archives a card that leaves the lists and brings it back, retagged, when it returns', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100)])
    await sync(env, trello)

    trello.cards[0].idList = '6ab56c84c5f60f68a6fb7bfa'
    await sync(env, trello)
    const gone = await card(env.DB, 'trello-a')
    expect(gone.archivedAt).toBe(NOW)
    expect(gone.activity.at(-1)?.text).toBe('Archived this card')

    trello.cards[0].idList = PROGRESS
    trello.cards[0].name = 'Back again'
    await sync(env, trello)
    expect(await card(env.DB, 'trello-a')).toMatchObject({
      archivedAt: null, title: 'Back again', labelIds: [await labelId(env.DB, 'In progress')]
    })
    expect(trello.writes()).toEqual([])
  })

  it('leaves a card deleted in Ego deleted while it stays in the lists', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100)])
    await sync(env, trello)
    const current = await card(env.DB, 'trello-a')
    await apply(env.DB, 'trello-a', current.revision, { entity: 'taskCard', type: 'delete' })

    expect(await sync(env, trello)).toEqual({ ok: true, data: { changed: false, problem: null } })
    expect(await cards(env.DB)).toEqual([])
  })

  it('creates a Trello card for a card added to the Work list, without touching the Ego card', async () => {
    const env = await setup()
    const trello = fakeTrello([])
    await sync(env, trello)
    await apply(env.DB, 'mine', null, {
      entity: 'taskCard', type: 'create', payload: {
        boardId: 'gtd', listId: 'work', title: 'From Ego', description: 'notes', position: 1024, labelIds: [], priority: 'none',
        dueDate: '2026-10-12', dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [], attachments: [], activity: []
      }
    })
    const revision = (await card(env.DB, 'mine')).revision

    await sync(env, trello)
    expect(trello.writes()).toEqual([{
      method: 'POST', path: '/1/cards',
      body: { idList: SELECTED, name: 'From Ego', desc: 'notes', due: '2026-10-13T03:59:00.000Z', pos: 'top' }
    }])
    expect((await card(env.DB, 'mine')).revision).toBe(revision)
    const mapped = await query<{ card_id: string }>(env.DB, 'SELECT card_id FROM trello_work_cards WHERE trello_id = ?', [trello.cards[0].id])
    expect(mapped).toEqual([{ card_id: 'mine' }])

    await sync(env, trello)
    expect(trello.writes()).toHaveLength(1)
  })

  it('reads Trello due times on the saved clock and keeps a pushed date-only due from coming back as an edit', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100, { due: '2026-10-12T16:00:00.000Z' })])
    await sync(env, trello)
    expect(await card(env.DB, 'trello-a')).toMatchObject({ dueDate: '2026-10-12', dueTime: '12:00', reminderMinutes: 60 })

    await edit(env.DB, 'trello-a', (input) => ({ ...input, dueDate: '2026-11-02', dueTime: null, reminderMinutes: 0 }))
    await sync(env, trello)
    expect(trello.writes()).toEqual([{ method: 'PUT', path: '/1/cards/a', body: { due: '2026-11-03T04:59:00.000Z' } }])
    await sync(env, trello)
    expect(await card(env.DB, 'trello-a')).toMatchObject({ dueDate: '2026-11-02', dueTime: null })
    expect(trello.writes()).toHaveLength(1)
  })

  it('reports a refused push and tries it again next time', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100)])
    await sync(env, trello)
    await edit(env.DB, 'trello-a', (input) => ({ ...input, title: 'New' }))
    const refusing = { ...trello, fetch: async (url: string, init?: RequestInit) => init?.method === 'PUT'
      ? new Response('unauthorized permission requested', { status: 401 })
      : trello.fetch(url, init) }

    const result = await syncTrelloWork(env, { fetch: refusing.fetch, now: () => NOW })
    expect(result).toEqual({ ok: true, data: { changed: false, problem: 'Trello answered 401: unauthorized permission requested' } })
    await sync(env, trello)
    expect(trello.cards[0].name).toBe('New')
  })

  it('syncs after a device write only when it touched the Work list', async () => {
    const env = await setup()
    const trello = fakeTrello([trelloCard('a', SELECTED, 100)])
    await sync(env, trello)
    const calls = trello.calls.length
    const later = '2026-09-12T11:00:00.000Z'
    const original = globalThis.fetch
    globalThis.fetch = trello.fetch as typeof globalThis.fetch
    try {
      await syncTrelloWorkAfterWrites(env, later)
      expect(trello.calls).toHaveLength(calls)
      await exec(env.DB, 'UPDATE task_cards SET title = ?, updated_at = ?, revision = revision + 1 WHERE id = ?', ['Edited', later, 'trello-a'])
      await syncTrelloWorkAfterWrites(env, later)
      expect(trello.writes()).toEqual([{ method: 'PUT', path: '/1/cards/a', body: { name: 'Edited' } }])
    } finally {
      globalThis.fetch = original
    }
  })

  it('answers POST /v1/tasks/work/sync for a signed-in device and remembers its time zone', async () => {
    const env = await setup(false)
    await exec(env.DB, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-1', 'Phone', ?, 'ego', ?)`,
      [await hashToken(TOKEN), NOW])
    const response = await handle(new Request('https://ego.example/v1/tasks/work/sync', {
      method: 'POST', body: JSON.stringify({ timeZone: 'Europe/Moscow' }),
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
    }), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, data: { changed: false, problem: null } })

    const missing = await handle(new Request('https://ego.example/v1/tasks/work/sync', {
      method: 'POST', body: '{}', headers: { authorization: `Bearer ${TOKEN}` }
    }), { DB: env.DB })
    expect(missing.status).toBe(503)
  })
})

describe('merging one card', () => {
  const base: Base = {
    trello: { name: 'A', desc: '', due: null, list: SELECTED },
    ego: { title: 'A', description: '', dueDate: null, dueTime: null, status: 'selected' },
    gone: false
  }

  it('leaves an unchanged card alone', () => {
    expect(mergeCard(base.trello, base.ego, base, ZONE)).toEqual({ pull: {}, push: {} })
  })

  it('takes everything from Trello for a card coming back', () => {
    const merged = mergeCard({ ...base.trello, list: PROGRESS }, base.ego, { ...base, gone: true }, ZONE)
    expect(merged.pull).toEqual({ title: 'A', description: '', due: { dueDate: null, dueTime: null }, status: 'progress' })
    expect(merged.push).toEqual({})
  })

  it('turns a local date and time into the instant Trello stores, across a clock change', () => {
    expect(trelloDue('2026-03-08', '03:30', ZONE)).toBe('2026-03-08T07:30:00.000Z')
    expect(trelloDue('2026-07-01', '09:00', ZONE)).toBe('2026-07-01T13:00:00.000Z')
    expect(trelloDue(null, null, ZONE)).toBeNull()
  })
})
