import { afterEach, describe, expect, it } from 'vitest'
import { taskCardInput, type TaskCardInput } from '@ego/core'
import type { SyncCommand, TaskAgentRun } from '@ego/api-contracts'
import type { Env } from '../src/auth'
import { applyOperation } from '../src/commands'
import { query } from '../src/reads'
import { handle } from '../src/router'
import { toTaskCardRecord, type TaskCardRow } from '../src/rows'
import { AGENT_STALE_MS, agentBranch, readTaskAgentRuns, runTaskAgent } from '../src/task-agent'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const HOOK = 'https://relay.example/hooks/jarvis'
const SECRET = 'webhook-signing-secret'
const AGENT_TOKEN = 'jarvis-agent-token-that-is-long-enough-0123'

let server: Ledger | null = null

afterEach(() => {
  server?.close()
  server = null
})

async function apply(db: D1Database, entityId: string, expectedRevision: number | null, command: SyncCommand): Promise<void> {
  const result = await applyOperation(db, { operationId: crypto.randomUUID(), entityId, expectedRevision, createdAt: NOW, command }, NOW)
  if (!result.ok) throw new Error(result.error.message)
}

async function setup(env: Partial<Env> = {}): Promise<Env> {
  server = await seedLedger()
  const db = server.db
  await apply(db, 'gtd', null, { entity: 'taskBoard', type: 'create', payload: { name: 'GTD', icon: '', position: 1024, hideDone: false, archivedAt: null } })
  await apply(db, 'inbox', null, { entity: 'taskList', type: 'create', payload: { boardId: 'gtd', name: 'Inbox', position: 1024, archivedAt: null, kind: 'inbox' } })
  await apply(db, 'jarvis', null, { entity: 'taskList', type: 'create', payload: { boardId: 'gtd', name: 'Jarvis', position: 2048, archivedAt: null, kind: 'agent' } })
  return {
    DB: db, T3_AGENT_WEBHOOK_URL: HOOK, T3_AGENT_WEBHOOK_SECRET: SECRET, TASKS_AGENT_TOKEN: AGENT_TOKEN,
    WEB_ORIGINS: 'https://ego.example', ...env
  }
}

function draft(listId: string, title: string, position: number, overrides: Partial<TaskCardInput> = {}): TaskCardInput {
  return {
    boardId: 'gtd', listId, title, description: `About ${title}`, position, labelIds: [], priority: 'none',
    dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null,
    checklists: [], attachments: [], activity: [], ...overrides
  }
}

async function addCard(db: D1Database, id: string, listId: string, position: number, overrides: Partial<TaskCardInput> = {}): Promise<void> {
  await apply(db, id, null, { entity: 'taskCard', type: 'create', payload: draft(listId, `Card ${id}`, position, overrides) })
}

async function edit(db: D1Database, id: string, change: (input: TaskCardInput) => TaskCardInput): Promise<void> {
  const row = (await query<TaskCardRow>(db, 'SELECT * FROM task_cards WHERE id = ?', [id]))[0]
  await apply(db, id, row.revision, { entity: 'taskCard', type: 'update', payload: change(taskCardInput(toTaskCardRecord(row))) })
}

interface Sent {
  url: string
  body: string
  signature: string | null
}

function fakeT3(status = 202) {
  const sent: Sent[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, body: String(init?.body), signature: new Headers(init?.headers).get('x-ego-signature') })
    return new Response('{}', { status })
  }
  return { sent, fetch, cards: () => sent.map((item) => (JSON.parse(item.body) as { cardId: string }).cardId) }
}

async function runs(db: D1Database): Promise<Map<string, TaskAgentRun>> {
  return new Map((await readTaskAgentRuns(db)).map((run) => [run.cardId, run]))
}

async function hmac(body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function call(env: Env, path: string, init: RequestInit = {}, token = AGENT_TOKEN): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return handle(new Request(`https://api.example${path}`, { ...init, headers }), env)
}

function report(env: Env, cardId: string, body: Record<string, unknown>): Promise<Response> {
  return call(env, `/v1/tasks/agent/cards/${cardId}/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
}

const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()

describe('cards in an agent list go to Jarvis', () => {
  it('sends a new card to the T3 webhook, signed, with a branch to work on', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    await addCard(env.DB, 'elsewhere', 'inbox', 1024)
    const t3 = fakeT3()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => NOW })

    expect(t3.cards()).toEqual(['a'])
    const [sent] = t3.sent
    expect(sent.url).toBe(HOOK)
    expect(sent.signature).toBe(`sha256=${await hmac(sent.body)}`)
    expect(JSON.parse(sent.body)).toEqual({
      cardId: 'a', title: 'Card a', description: 'About Card a', branch: agentBranch('Card a', NOW),
      board: 'GTD', list: 'Jarvis', link: 'https://ego.example/tasks/card/a', queuedAt: NOW
    })
    expect((await runs(env.DB)).get('a')).toMatchObject({ status: 'sent', branch: 'jarvis/card-a-' + Date.parse(NOW).toString(36), note: null })

    await runTaskAgent(env, { fetch: t3.fetch, now: () => at(1) })
    expect(t3.sent).toHaveLength(1)
  })

  it('runs two at a time and sends the next when one reports a pull request', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    await addCard(env.DB, 'b', 'jarvis', 2048)
    await addCard(env.DB, 'c', 'jarvis', 3072)
    const t3 = fakeT3()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => NOW })
    expect(t3.cards()).toEqual(['a', 'b'])
    expect((await runs(env.DB)).get('c')?.status).toBe('queued')

    expect((await report(env, 'a', { status: 'working' })).status).toBe(200)
    expect((await report(env, 'a', { status: 'asking', note: 'Which screen?' })).status).toBe(200)
    expect((await runs(env.DB)).get('a')).toMatchObject({ status: 'asking', note: 'Which screen?' })
    await runTaskAgent(env, { fetch: t3.fetch, now: () => at(5) })
    expect(t3.cards()).toEqual(['a', 'b', 'c'])

    expect((await report(env, 'a', { status: 'working' })).status).toBe(200)
    const pr = await report(env, 'a', { status: 'pr', prUrl: 'https://github.com/kharitonov-egor/ego/pull/60' })
    expect(await pr.json()).toMatchObject({ ok: true, data: { status: 'pr', prUrl: 'https://github.com/kharitonov-egor/ego/pull/60', note: null } })
  })

  it('leaves done cards alone and forgets a card that leaves the list', async () => {
    const env = await setup()
    await addCard(env.DB, 'done', 'jarvis', 1024, { doneAt: NOW })
    await addCard(env.DB, 'a', 'jarvis', 2048)
    const t3 = fakeT3()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => NOW })
    expect(t3.cards()).toEqual(['a'])

    await edit(env.DB, 'a', (input) => ({ ...input, listId: 'inbox' }))
    await runTaskAgent(env, { fetch: t3.fetch, now: () => at(1) })
    expect((await runs(env.DB)).has('a')).toBe(false)

    await edit(env.DB, 'a', (input) => ({ ...input, listId: 'jarvis' }))
    await runTaskAgent(env, { fetch: t3.fetch, now: () => at(2) })
    expect(t3.cards()).toEqual(['a', 'a'])
    expect((await runs(env.DB)).get('a')?.branch).toBe(agentBranch('Card a', at(2)))
  })

  it('keeps cards queued until the webhook is set up', async () => {
    const env = await setup({ T3_AGENT_WEBHOOK_URL: undefined })
    await addCard(env.DB, 'a', 'jarvis', 1024)
    const t3 = fakeT3()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => NOW })
    expect(t3.sent).toEqual([])
    expect((await runs(env.DB)).get('a')?.status).toBe('queued')
  })

  it('retries a failed send and gives up after five tries', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    const t3 = fakeT3(502)
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runTaskAgent(env, { fetch: t3.fetch, now: () => at(attempt) })
      expect(t3.sent).toHaveLength(attempt)
    }
    expect((await runs(env.DB)).get('a')).toMatchObject({ status: 'failed', note: 'T3 answered 502' })
    await runTaskAgent(env, { fetch: t3.fetch, now: () => at(10) })
    expect(t3.sent).toHaveLength(5)
  })

  it('calls a quiet run failed after three hours, which frees its slot', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    await addCard(env.DB, 'b', 'jarvis', 2048)
    await addCard(env.DB, 'c', 'jarvis', 3072)
    const t3 = fakeT3()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => NOW })
    const later = new Date(Date.parse(NOW) + AGENT_STALE_MS + 60_000).toISOString()
    await runTaskAgent(env, { fetch: t3.fetch, now: () => later })
    const after = await runs(env.DB)
    expect(after.get('a')).toMatchObject({ status: 'failed', note: 'Jarvis did not report for 3 hours' })
    expect(after.get('c')?.status).toBe('sent')
  })
})

describe("Jarvis's endpoints", () => {
  it('needs the agent token and only reaches cards that have a run', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    await addCard(env.DB, 'private', 'inbox', 1024)
    await runTaskAgent(env, { fetch: fakeT3().fetch, now: () => NOW })

    expect((await call(env, '/v1/tasks/agent/cards/a', {}, 'wrong-token-that-is-long-enough-012345')).status).toBe(401)
    expect((await call(env, '/v1/tasks/agent/cards/private')).status).toBe(404)
    const read = await call(env, '/v1/tasks/agent/cards/a')
    expect(await read.json()).toMatchObject({
      ok: true,
      data: { card: { id: 'a', title: 'Card a' }, board: 'GTD', list: 'Jarvis', link: 'https://ego.example/tasks/card/a', run: { status: 'sent' } }
    })
    expect((await report(env, 'private', { status: 'working' })).status).toBe(404)
    expect((await call(env, '/v1/tasks/agent/runs')).status).toBe(401)
  })

  it('checks reports', async () => {
    const env = await setup()
    await addCard(env.DB, 'a', 'jarvis', 1024)
    await runTaskAgent(env, { fetch: fakeT3().fetch, now: () => NOW })
    expect((await report(env, 'a', { status: 'queued' })).status).toBe(400)
    expect((await report(env, 'a', { status: 'pr' })).status).toBe(400)
    expect((await report(env, 'a', { status: 'pr', prUrl: 'https://evil.example/pull/1' })).status).toBe(400)
    expect((await report(env, 'a', { status: 'failed', note: 'x'.repeat(900) })).status).toBe(200)
    expect((await runs(env.DB)).get('a')?.note).toHaveLength(500)
  })

  it('serves only the files attached to the card', async () => {
    const files = new Map([['shot', 'png bytes']])
    const bucket = {
      get: async (key: string) => {
        const text = files.get(key.replace(/^tasks\//, ''))
        return text === undefined ? null : { body: text, httpMetadata: { contentType: 'image/png' } }
      }
    } as unknown as R2Bucket
    const env = await setup({ DIARY_MEDIA: bucket })
    await exec(env.DB, `INSERT INTO task_media (id, content_type, size, created_at) VALUES ('shot', 'image/png', 9, ?)`, [NOW])
    await addCard(env.DB, 'a', 'jarvis', 1024, {
      attachments: [{
        id: 'att', mediaId: 'shot', kind: 'photo', mimeType: 'image/png', fileName: 'bug.png', size: 9,
        width: 10, height: 10, durationSeconds: null, previewId: null, addedAt: NOW
      }]
    })
    await runTaskAgent(env, { fetch: fakeT3().fetch, now: () => NOW })
    const file = await call(env, '/v1/tasks/agent/cards/a/media/shot')
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('png bytes')
    expect((await call(env, '/v1/tasks/agent/cards/a/media/other')).status).toBe(404)
  })
})
