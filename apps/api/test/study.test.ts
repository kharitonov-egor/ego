import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudyAssignmentList, StudyMark } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-aaaaaa'
const FEED_URL = 'https://school.instructure.com/feeds/calendars/user_secret.ics'
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function payload<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>
}

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: ledger.db, ...overrides }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ego.example${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers }
  })
}

const FEED = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:event-assignment-1',
  'DTSTART:20261001T210000Z',
  'SUMMARY:PS-3 [CDA4205.002F26]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-2',
  'DTSTART;VALUE=DATE:20261002',
  'SUMMARY:Assignment 3 [COT4210.001F26]',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

function mark(id: string, done: boolean): Request {
  return request(`/v1/study/assignments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ done }) })
}

describe('study assignments', () => {
  it('reports a missing feed link without calling Canvas', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request('/v1/study/assignments'), env)
    expect(response.status).toBe(503)
    expect((await payload(response)).error?.code).toBe('NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the feed from the server secret and merges done marks', async () => {
    const env = await environment({ CANVAS_CALENDAR_URL: FEED_URL })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(FEED, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await handle(mark('event-assignment-2', true), env)
    const response = await handle(request('/v1/study/assignments'), env)
    expect(response.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe(FEED_URL)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('user-agent')).toMatch(/^Ego\//)
    const data = (await payload<StudyAssignmentList>(response)).data
    expect(data.assignments.map((item) => [item.id, item.course, item.doneAt === null])).toEqual([
      ['event-assignment-1', 'CDA4205', true],
      ['event-assignment-2', 'COT4210', false]
    ])
  })

  it('reuses the parsed feed while reading completion marks again', async () => {
    const env = await environment({ CANVAS_CALENDAR_URL: FEED_URL })
    const fetchMock = vi.fn(async () => new Response(FEED, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await handle(request('/v1/study/assignments'), env)
    expect(first.status).toBe(200)
    const firstData = (await payload<StudyAssignmentList>(first)).data
    await handle(mark('event-assignment-1', true), env)
    const second = await handle(request('/v1/study/assignments'), env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const data = (await payload<StudyAssignmentList>(second)).data
    expect(data.fetchedAt).toBe(firstData.fetchedAt)
    expect(data.assignments.find((item) => item.id === 'event-assignment-1')?.doneAt).not.toBeNull()
  })

  it('says so when Canvas is down or sends a login page', async () => {
    const env = await environment({ CANVAS_CALENDAR_URL: FEED_URL })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const down = await handle(request('/v1/study/assignments'), env)
    expect(down.status).toBe(502)
    expect((await payload(down)).error?.message).toContain('HTTP 500')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html></html>', { status: 200 })))
    const page = await handle(request('/v1/study/assignments'), env)
    expect(page.status).toBe(502)
    expect((await payload(page)).error?.message).toContain('feed link')
  })

  it('keeps the first done time when a mark is delivered twice, and clears it on undo', async () => {
    const env = await environment()
    const first = (await payload<StudyMark>(await handle(mark('event-assignment-1', true), env))).data
    expect(first.id).toBe('event-assignment-1')
    expect(first.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const again = (await payload<StudyMark>(await handle(mark('event-assignment-1', true), env))).data
    expect(again.doneAt).toBe(first.doneAt)
    const cleared = (await payload<StudyMark>(await handle(mark('event-assignment-1', false), env))).data
    expect(cleared).toEqual({ id: 'event-assignment-1', doneAt: null })
    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM study_completions').first<{ count: number }>()
    expect(rows?.count).toBe(0)
  })

  it('rejects a mark without a boolean', async () => {
    const env = await environment()
    const response = await handle(request('/v1/study/assignments/event-assignment-1', { method: 'PUT', body: JSON.stringify({ done: 'yes' }) }), env)
    expect(response.status).toBe(400)
  })

  it('needs a signed-in device', async () => {
    const env = await environment({ CANVAS_CALENDAR_URL: FEED_URL })
    const response = await handle(new Request('https://ego.example/v1/study/assignments'), env)
    expect(response.status).toBe(401)
  })
})
