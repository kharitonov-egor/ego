import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalendarConnectStart, CalendarSnapshot } from '@ego/api-contracts'
import { validateAssistantArguments } from '@ego/core'
import { assistantSystemPrompt, describeWrite, executeAssistantRead, executeAssistantWrite } from '../src/assistant-tools'
import { hashToken, type Env } from '../src/auth'
import { readCalendarSnapshot, readStoredEvents, syncCalendarAccount } from '../src/calendar'
import { encryptConnectorToken } from '../src/connector-crypto'
import { CALENDAR_SCOPE, toCalendarEvent, toCalendarInfo } from '../src/google-calendar'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'desktop-device-token-that-is-long-enough-aaaa'
const KEY = `v1:${Buffer.alloc(32, 9).toString('base64')}`
const ACCOUNT = 'me@example.com'
const SYNC_AT = new Date('2026-10-02T16:00:00.000Z')
let ledger: Ledger | null = null

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

type Json = Record<string, unknown>

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, account_email)
    VALUES ('device-a', 'Desktop', ?, 'ego', ?, ?)`, [await hashToken(TOKEN), NOW, ACCOUNT])
  return {
    DB: ledger.db,
    CONNECTOR_TOKEN_KEY: KEY,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    PUBLIC_BASE_URL: 'https://ego.example'
  }
}

async function connect(env: Env, accountId = ACCOUNT): Promise<void> {
  const token = await encryptConnectorToken(`refresh-${accountId}`, env)
  await exec(env.DB, `INSERT INTO calendar_accounts (dataset_id, id, encrypted_refresh_token, token_key_version,
    granted_scopes, created_at, updated_at) VALUES ('ego', ?, ?, ?, ?, ?, ?)`,
  [accountId, token.encrypted, token.keyVersion, JSON.stringify([CALENDAR_SCOPE]), NOW, NOW])
}

function request(path: string, init: RequestInit & { json?: unknown } = {}): Request {
  const { json, ...rest } = init
  return new Request(`https://ego.example${path}`, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...rest.headers }
  })
}

async function call<T>(env: Env, path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: Envelope<T> }> {
  const response = await handle(request(path, init), env)
  return { status: response.status, body: await response.json() as Envelope<T> }
}

function fakeIdToken(email: string): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part({ email })}.signature`
}

interface FakeCalendar {
  entry: Json
  events: Map<string, Json>
  /** Which event ids changed at each tick, for sync tokens. */
  log: Array<{ tick: number; id: string }>
}

/**
 * Google Calendar as the Worker sees it: instances already expanded, masters kept apart, a sync
 * token per calendar that names a point in the change log, and If-Match on writes.
 */
function fakeGoogle() {
  let tick = 1
  let ids = 0
  const calendars = new Map<string, FakeCalendar>()
  const masters = new Map<string, Json>()
  const calls: string[] = []
  const bodies: Array<{ method: string; path: string; body: Json | null }> = []
  let expireTokens = false

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const touch = (calendar: FakeCalendar, event: Json): Json => {
    tick += 1
    event.etag = `"etag-${tick}"`
    event.updated = new Date(Date.parse('2026-10-01T00:00:00Z') + tick * 1000).toISOString()
    calendar.log.push({ tick, id: String(event.id) })
    return event
  }

  const addCalendar = (id: string, entry: Json = {}): FakeCalendar => {
    const calendar = { entry: { id, summary: id, accessRole: 'owner', selected: true, colorId: '14', backgroundColor: '#9fe1e7', ...entry }, events: new Map(), log: [] }
    calendars.set(id, calendar)
    return calendar
  }

  const addEvent = (calendarId: string, event: Json): Json => {
    const calendar = calendars.get(calendarId)
    if (!calendar) throw new Error(`No calendar ${calendarId}`)
    const stored = touch(calendar, { status: 'confirmed', ...event })
    calendar.events.set(String(event.id), stored)
    return stored
  }

  const addSeries = (calendarId: string, master: Json, occurrences: string[]): void => {
    masters.set(String(master.id), { status: 'confirmed', etag: '"master-1"', ...master })
    const start = master.start as { dateTime: string }
    const end = master.end as { dateTime: string }
    const length = Date.parse(end.dateTime) - Date.parse(start.dateTime)
    for (const at of occurrences) {
      const id = `${String(master.id)}_${at.replace(/[-:]/g, '').replace('.000', '')}`
      addEvent(calendarId, {
        id, summary: master.summary, recurringEventId: master.id,
        originalStartTime: { dateTime: at }, start: { dateTime: at }, end: { dateTime: new Date(Date.parse(at) + length).toISOString() },
        attendees: master.attendees
      })
    }
  }

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.redirect === 'error') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"')
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.pathname}${url.search}`)
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) as Json : null
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const form = new URLSearchParams(String(init?.body))
      if (form.get('grant_type') === 'authorization_code') {
        return json({ access_token: 'access-1', refresh_token: 'refresh-new', scope: `openid ${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`, id_token: fakeIdToken('Me@Example.com') })
      }
      return json({ access_token: 'access-2', expires_in: 3599 })
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json({})
    const path = decodeURIComponent(url.pathname.replace('/calendar/v3', ''))
    bodies.push({ method, path, body })
    if (path === '/users/me/settings/timezone') return json({ value: 'America/New_York' })
    if (path === '/users/me/calendarList') return json({ items: [...calendars.values()].map((calendar) => calendar.entry) })
    const entry = /^\/users\/me\/calendarList\/(.+)$/.exec(path)
    if (entry && method === 'PATCH') {
      const calendar = calendars.get(entry[1])
      if (!calendar || !body) return json({ error: { code: 404 } }, 404)
      Object.assign(calendar.entry, body)
      if (body.colorId) calendar.entry.backgroundColor = '#a47ae2'
      return json(calendar.entry)
    }
    const list = /^\/calendars\/([^/]+)\/events$/.exec(path)
    if (list) {
      const calendar = calendars.get(list[1])
      if (!calendar) return json({ error: { code: 404, message: 'Not Found' } }, 404)
      if (method === 'POST' && body) {
        ids += 1
        const id = `new${ids}`
        const created = addEvent(list[1], { ...body, id, organizer: { email: ACCOUNT, self: true } })
        if (Array.isArray(body.recurrence)) masters.set(id, created)
        return json(created)
      }
      const token = url.searchParams.get('syncToken')
      if (token) {
        if (expireTokens) return json({ error: { code: 410, message: 'Sync token is no longer valid' } }, 410)
        const since = Number(token.split('-')[1])
        const changed = new Set(calendar.log.filter((item) => item.tick > since).map((item) => item.id))
        return json({ items: [...changed].map((id) => calendar.events.get(id)), nextSyncToken: `sync-${tick}` })
      }
      return json({ items: [...calendar.events.values()].filter((event) => event.status !== 'cancelled'), nextSyncToken: `sync-${tick}` })
    }
    const instances = /^\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/.exec(path)
    if (instances) {
      const calendar = calendars.get(instances[1])
      const before = Date.parse(url.searchParams.get('timeMax') ?? '')
      const items = [...(calendar?.events.values() ?? [])].filter((event) => event.recurringEventId === instances[2] &&
        Date.parse((event.originalStartTime as { dateTime: string }).dateTime) < before)
      return json({ items })
    }
    const move = /^\/calendars\/([^/]+)\/events\/([^/]+)\/move$/.exec(path)
    if (move) {
      const from = calendars.get(move[1])
      const to = calendars.get(url.searchParams.get('destination') ?? '')
      const event = from?.events.get(move[2])
      if (!from || !to || !event) return json({ error: { code: 404 } }, 404)
      from.events.set(move[2], touch(from, { ...event, status: 'cancelled' }))
      const moved = touch(to, { ...event })
      to.events.set(move[2], moved)
      return json(moved)
    }
    const one = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path)
    if (one) {
      const calendar = calendars.get(one[1])
      const event = calendar?.events.get(one[2]) ?? masters.get(one[2])
      if (!calendar || !event) return json({ error: { code: 404, message: 'Not Found' } }, 404)
      if (method === 'GET') return json(event)
      const ifMatch = new Headers(init?.headers).get('if-match')
      if (ifMatch && ifMatch !== event.etag) return json({ error: { code: 412, message: 'Precondition Failed' } }, 412)
      if (method === 'DELETE') {
        if (masters.has(one[2])) {
          masters.delete(one[2])
          for (const instance of calendar.events.values()) {
            if (instance.recurringEventId === one[2]) calendar.events.set(String(instance.id), touch(calendar, { ...instance, status: 'cancelled' }))
          }
        } else {
          calendar.events.set(one[2], touch(calendar, { ...event, status: 'cancelled' }))
        }
        return new Response(null, { status: 204 })
      }
      if (method === 'PATCH' && body) {
        const next = { ...event, ...body }
        if (masters.has(one[2])) {
          tick += 1
          next.etag = `"master-${tick}"`
          masters.set(one[2], next)
          return json(next)
        }
        calendar.events.set(one[2], touch(calendar, next))
        return json(next)
      }
    }
    return json({ error: { code: 404 } }, 404)
  }

  return {
    fetch: vi.fn(handler) as unknown as typeof fetch,
    calls,
    bodies,
    calendars,
    masters,
    addCalendar,
    addEvent,
    addSeries,
    expire: () => { expireTokens = true },
    change: (calendarId: string, id: string, fields: Json) => {
      const calendar = calendars.get(calendarId)
      const event = calendar?.events.get(id)
      if (!calendar || !event) throw new Error('No such event')
      calendar.events.set(id, touch(calendar, { ...event, ...fields }))
    }
  }
}

function standup(id: string, day: string, extra: Json = {}): Json {
  return {
    id, summary: 'Standup', start: { dateTime: `${day}T13:00:00Z` }, end: { dateTime: `${day}T13:30:00Z` },
    organizer: { email: ACCOUNT, self: true }, ...extra
  }
}

async function eventRow(env: Env, calendarId: string, id: string): Promise<Json | null> {
  return env.DB.prepare('SELECT * FROM calendar_events WHERE dataset_id = ? AND calendar_id = ? AND id = ?')
    .bind('ego', calendarId, id).first<Json>()
}

describe('google calendar parsing', () => {
  it('draws calendars in the current palette and keeps custom colors', () => {
    expect(toCalendarInfo(ACCOUNT, { id: 'a', summary: 'Classes', colorId: '14', backgroundColor: '#9fe1e7', accessRole: 'owner', selected: true })?.color).toBe('#039be5')
    expect(toCalendarInfo(ACCOUNT, { id: 'b', summary: 'Gym', colorId: '14', backgroundColor: '#123456', accessRole: 'reader' })).toMatchObject({
      color: '#123456', accessRole: 'reader', selected: false, name: 'Gym'
    })
  })

  it('reads an invitation with Meet and the account\'s own answer', () => {
    const event = toCalendarEvent(ACCOUNT, ACCOUNT, {
      id: 'meet1', summary: 'Sync', etag: '"1"', updated: '2026-10-01T00:00:00Z',
      start: { dateTime: '2026-10-05T10:00:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-05T11:00:00-04:00' },
      organizer: { email: 'boss@example.com' },
      attendees: [{ email: 'boss@example.com', organizer: true, responseStatus: 'accepted' }, { email: ACCOUNT, self: true, responseStatus: 'needsAction' }],
      conferenceData: { conferenceSolution: { name: 'Google Meet' }, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc' }] }
    })
    expect(event).toMatchObject({
      key: `${ACCOUNT}/${ACCOUNT}/meet1`, start: '2026-10-05T14:00:00.000Z', end: '2026-10-05T15:00:00.000Z', allDay: false,
      response: 'needsAction', conference: { name: 'Google Meet', url: 'https://meet.google.com/abc' }
    })
    expect(toCalendarEvent(ACCOUNT, ACCOUNT, { id: 'gone', status: 'cancelled', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } })).toBeNull()
  })
})

describe('calendar connection', () => {
  it('asks Google for calendar access and keeps the account the browser returns', async () => {
    const env = await environment()
    const google = fakeGoogle()
    vi.stubGlobal('fetch', google.fetch)
    const started = await call<CalendarConnectStart>(env, '/v1/calendar/connect', { method: 'POST', json: {} })
    const authorization = new URL(started.body.data.authorizationUrl)
    expect(authorization.searchParams.get('scope')).toContain(CALENDAR_SCOPE)
    expect(authorization.searchParams.get('login_hint')).toBe(ACCOUNT)
    const another = await call<CalendarConnectStart>(env, '/v1/calendar/connect', { method: 'POST', json: { another: true } })
    expect(new URL(another.body.data.authorizationUrl).searchParams.get('login_hint')).toBeNull()

    const state = authorization.searchParams.get('state')
    const callback = await handle(new Request(`https://ego.example/v1/connectors/google/callback?state=${state}&code=abc`), env)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('ego://calendar?connected=1')
    const row = await env.DB.prepare('SELECT id, revoked_at FROM calendar_accounts').first<Json>()
    expect(row).toEqual({ id: ACCOUNT, revoked_at: null })
    const again = await handle(new Request(`https://ego.example/v1/connectors/google/callback?state=${state}&code=abc`), env)
    expect(again.headers.get('location')).toBe('ego://calendar?error=expired')
  })
})

describe('calendar sync', () => {
  it('downloads every calendar, then only what changed', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT, { primary: true })
    google.addCalendar('classes', { summary: 'Classes', colorId: '7', backgroundColor: '#42d692' })
    google.addCalendar('hidden', { hidden: true })
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    google.addEvent('classes', { id: 'c1', summary: 'Algorithms', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } })
    vi.stubGlobal('fetch', google.fetch)

    const outcome = await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const first = await readCalendarSnapshot(env, 'ego', null, null, SYNC_AT)
    expect([outcome, first.accounts[0]?.lastError]).toEqual(['synced', null])
    expect(first.accounts).toEqual([expect.objectContaining({ id: ACCOUNT, connected: true, timeZone: 'America/New_York', lastError: null })])
    expect(first.calendars.map((calendar) => [calendar.name, calendar.color])).toEqual([[ACCOUNT, '#039be5'], ['Classes', '#009688']])
    expect(first.events.map((event) => event.title).sort()).toEqual(['Algorithms', 'Standup'])
    const listCall = google.calls.find((line) => line.includes('/calendars/classes/events'))
    expect(listCall).toContain('timeMin=')
    expect(listCall).toContain('singleEvents=true')

    google.change(ACCOUNT, 'a1', { summary: 'Standup (moved)' })
    google.change('classes', 'c1', { status: 'cancelled' })
    google.calls.length = 0
    const later = new Date(SYNC_AT.getTime() + 60_000)
    expect(await syncCalendarAccount(env, 'ego', ACCOUNT, later, { minimumGapMs: 0 })).toBe('synced')
    expect(google.calls.filter((line) => line.includes('/events?')).every((line) => line.includes('syncToken='))).toBe(true)
    const delta = await readCalendarSnapshot(env, 'ego', first.serverTime, null, later)
    expect(delta.events.map((event) => [event.id, event.title, event.deleted]).sort()).toEqual([
      ['a1', 'Standup (moved)', false], ['c1', 'Algorithms', true]
    ])
    expect(delta.calendars.map((calendar) => calendar.updatedAt).sort()).toEqual(first.calendars.map((calendar) => calendar.updatedAt).sort())
  })

  it('starts over when Google expires a sync token', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT)
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    google.expire()
    google.addEvent(ACCOUNT, standup('a2', '2026-10-06'))
    expect(await syncCalendarAccount(env, 'ego', ACCOUNT, new Date(SYNC_AT.getTime() + 60_000), { minimumGapMs: 0 })).toBe('synced')
    expect(await eventRow(env, ACCOUNT, 'a2')).toMatchObject({ deleted_at: null })
  })

  it('skips a run that follows the last one too closely', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT)
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    expect(await syncCalendarAccount(env, 'ego', ACCOUNT, new Date(SYNC_AT.getTime() + 1000), { minimumGapMs: 60_000 })).toBe('skipped')
  })

  it('pages a large first download', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT)
    for (let index = 0; index < 1205; index += 1) {
      google.addEvent(ACCOUNT, standup(`e${index}`, `2026-1${index % 2}-1${index % 9}`))
    }
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const first = await readCalendarSnapshot(env, 'ego', null, null, SYNC_AT)
    expect(first.events).toHaveLength(1000)
    expect(first.cursor).not.toBeNull()
    const second = await readCalendarSnapshot(env, 'ego', null, first.cursor, new Date())
    expect(second.events).toHaveLength(205)
    expect(second.cursor).toBeNull()
    expect(second.serverTime).toBe(first.serverTime)
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(1205)
  })

  it('reads the selected calendars for a range', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT)
    google.addCalendar('off', { selected: false })
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    google.addEvent('off', standup('o1', '2026-10-05'))
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const events = await readStoredEvents(env, 'ego', '2026-10-05T00:00:00.000Z', '2026-10-06T00:00:00.000Z')
    expect(events.map((event) => event.id)).toEqual(['a1'])
  })
})

describe('calendar writes', () => {
  async function synced() {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT, { primary: true })
    google.addCalendar('work', { summary: 'Work' })
    vi.stubGlobal('fetch', google.fetch)
    return { env, google }
  }

  it('moves an event and answers with the new copy', async () => {
    const { env, google } = await synced()
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const etag = String(google.calendars.get(ACCOUNT)?.events.get('a1')?.etag)
    const moved = await call<CalendarSnapshot>(env, '/v1/calendar/events', {
      method: 'PATCH',
      json: {
        since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'a1', etag, scope: 'one', targetCalendarId: null,
        changes: { start: '2026-10-05T15:00:00.000Z', end: '2026-10-05T15:30:00.000Z', allDay: false }
      }
    })
    expect(moved.body.ok).toBe(true)
    const patch = google.bodies.find((item) => item.method === 'PATCH')
    expect(patch?.body).toMatchObject({ start: { dateTime: '2026-10-05T15:00:00.000Z' }, end: { dateTime: '2026-10-05T15:30:00.000Z' } })
    expect(moved.body.data.events.find((event) => event.id === 'a1')?.start).toBe('2026-10-05T15:00:00.000Z')
  })

  it('refuses a change made against an old copy and reloads the event', async () => {
    const { env, google } = await synced()
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const stale = String(google.calendars.get(ACCOUNT)?.events.get('a1')?.etag)
    google.change(ACCOUNT, 'a1', { summary: 'Renamed in Google' })
    const result = await call<CalendarSnapshot>(env, '/v1/calendar/events', {
      method: 'PATCH',
      json: { since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'a1', etag: stale, scope: 'one', targetCalendarId: null, changes: { title: 'Mine' } }
    })
    expect(result.status).toBe(409)
    expect(result.body.error?.code).toBe('CONFLICT')
    const row = await eventRow(env, ACCOUNT, 'a1')
    expect(JSON.parse(String(row?.event)).title).toBe('Renamed in Google')
  })

  it('splits a series for this and following, carrying the count over', async () => {
    const { env, google } = await synced()
    google.addSeries(ACCOUNT, {
      id: 'gym', summary: 'Gym', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
      start: { dateTime: '2026-10-01T22:00:00.000Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-01T23:00:00.000Z', timeZone: 'America/New_York' },
      organizer: { email: ACCOUNT, self: true }
    }, ['2026-10-01T22:00:00.000Z', '2026-10-08T22:00:00.000Z', '2026-10-15T22:00:00.000Z', '2026-10-22T22:00:00.000Z'])
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const result = await call<CalendarSnapshot>(env, '/v1/calendar/events', {
      method: 'PATCH',
      json: {
        since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'gym_20261015T220000Z', etag: null, scope: 'following',
        targetCalendarId: null, changes: { title: 'Gym (legs)' }
      }
    })
    expect(result.body.ok).toBe(true)
    const created = google.bodies.find((item) => item.method === 'POST')?.body
    expect(created).toMatchObject({ summary: 'Gym (legs)', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=2'], start: { dateTime: '2026-10-15T22:00:00.000Z', timeZone: 'America/New_York' } })
    expect(google.masters.get('gym')?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=2'])
  })

  it('shifts the whole series when one occurrence moves for all events', async () => {
    const { env, google } = await synced()
    google.addSeries(ACCOUNT, {
      id: 'class', summary: 'Class', recurrence: ['RRULE:FREQ=WEEKLY'],
      start: { dateTime: '2026-09-28T14:00:00.000Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-09-28T15:00:00.000Z', timeZone: 'America/New_York' },
      organizer: { email: ACCOUNT, self: true }
    }, ['2026-09-28T14:00:00.000Z', '2026-10-05T14:00:00.000Z'])
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    await call<CalendarSnapshot>(env, '/v1/calendar/events', {
      method: 'PATCH',
      json: {
        since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'class_20261005T140000Z', etag: null, scope: 'all',
        targetCalendarId: null, changes: { start: '2026-10-06T16:00:00.000Z', end: '2026-10-06T17:30:00.000Z', allDay: false }
      }
    })
    expect(google.masters.get('class')).toMatchObject({
      start: { dateTime: '2026-09-29T16:00:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-09-29T17:30:00.000Z', timeZone: 'America/New_York' }
    })
  })

  it('ends a series before the opened occurrence for delete following', async () => {
    const { env, google } = await synced()
    google.addSeries(ACCOUNT, {
      id: 'club', summary: 'Club', recurrence: ['RRULE:FREQ=WEEKLY'],
      start: { dateTime: '2026-10-01T22:00:00.000Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-01T23:00:00.000Z' },
      organizer: { email: ACCOUNT, self: true }
    }, ['2026-10-01T22:00:00.000Z', '2026-10-08T22:00:00.000Z'])
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const result = await call<CalendarSnapshot>(env, '/v1/calendar/events/delete', {
      method: 'POST',
      json: { since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'club_20261008T220000Z', scope: 'following' }
    })
    expect(result.body.ok).toBe(true)
    expect(google.masters.get('club')?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20261008T215959Z'])
  })

  it('answers an invitation with a note, keeping the other guests', async () => {
    const { env, google } = await synced()
    google.addEvent(ACCOUNT, {
      id: 'inv', summary: 'Review', start: { dateTime: '2026-10-05T18:00:00Z' }, end: { dateTime: '2026-10-05T19:00:00Z' },
      organizer: { email: 'boss@example.com' },
      attendees: [{ email: 'boss@example.com', organizer: true, responseStatus: 'accepted' }, { email: ACCOUNT, self: true, responseStatus: 'needsAction' }]
    })
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const result = await call<CalendarSnapshot>(env, '/v1/calendar/rsvp', {
      method: 'POST',
      json: { since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'inv', answer: 'tentative', comment: 'Running late', scope: 'one' }
    })
    expect(result.body.ok).toBe(true)
    const patch = google.bodies.find((item) => item.method === 'PATCH')
    expect(patch?.body?.attendees).toEqual([
      { email: 'boss@example.com', organizer: true, responseStatus: 'accepted' },
      { email: ACCOUNT, self: true, responseStatus: 'tentative', comment: 'Running late' }
    ])
    expect(google.calls.find((line) => line.startsWith('PATCH'))).toContain('sendUpdates=all')
    expect(result.body.data.events.find((event) => event.id === 'inv')?.response).toBe('tentative')
  })

  it('creates an event with a Meet link and checks the draft first', async () => {
    const { env, google } = await synced()
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const draft = {
      title: 'Coffee', description: null, location: 'Kahwa', allDay: false, start: '2026-10-07T13:00:00.000Z', end: '2026-10-07T14:00:00.000Z',
      timeZone: 'America/New_York', recurrence: [], colorId: '5', attendees: [{ email: 'friend@example.com', optional: false }], meet: true,
      reminders: { useDefault: true, overrides: [] }, transparency: 'opaque', visibility: 'default',
      guestsCanModify: false, guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true
    }
    const bad = await call<CalendarSnapshot>(env, '/v1/calendar/events', { method: 'POST', json: { accountId: ACCOUNT, calendarId: 'work', draft: { ...draft, end: draft.start } } })
    expect(bad.status).toBe(400)
    const created = await call<CalendarSnapshot>(env, '/v1/calendar/events', { method: 'POST', json: { since: null, accountId: ACCOUNT, calendarId: 'work', draft } })
    expect(created.body.ok).toBe(true)
    const post = google.bodies.find((item) => item.method === 'POST')
    expect(post?.body).toMatchObject({ summary: 'Coffee', colorId: '5', attendees: [{ email: 'friend@example.com' }], conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } } })
    expect(google.calls.find((line) => line.startsWith('POST'))).toContain('conferenceDataVersion=1')
    expect(created.body.data.events.map((event) => event.title)).toContain('Coffee')
  })

  it('changes a calendar\'s color and tick in Google', async () => {
    const { env } = await synced()
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const result = await call<CalendarSnapshot>(env, '/v1/calendar/lists', {
      method: 'PATCH', json: { since: null, accountId: ACCOUNT, calendarId: 'work', selected: false, colorId: '24' }
    })
    expect(result.body.ok).toBe(true)
    expect(result.body.data.calendars.find((calendar) => calendar.id === 'work')).toMatchObject({ selected: false, color: '#9e69af' })
  })

  it('takes a disconnected account off every device', async () => {
    const { env, google } = await synced()
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const before = await readCalendarSnapshot(env, 'ego', null, null, SYNC_AT)
    const result = await call<{ disconnected: true }>(env, '/v1/calendar/disconnect', { method: 'POST', json: { accountId: ACCOUNT } })
    expect(result.body.ok).toBe(true)
    const after = await readCalendarSnapshot(env, 'ego', before.serverTime, null, new Date())
    expect(after.accounts).toEqual([])
    expect(after.events.every((event) => event.deleted)).toBe(true)
    expect(after.calendars.every((calendar) => calendar.deleted)).toBe(true)
  })
})

describe('calendar undo', () => {
  it('brings a deleted event back', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT)
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    await call(env, '/v1/calendar/events/delete', { method: 'POST', json: { since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'a1', scope: 'one' } })
    expect(await eventRow(env, ACCOUNT, 'a1')).toMatchObject({ deleted_at: expect.any(String) })
    const restored = await call<CalendarSnapshot>(env, '/v1/calendar/events/restore', { method: 'POST', json: { since: null, accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'a1' } })
    expect(restored.body.ok).toBe(true)
    expect(await eventRow(env, ACCOUNT, 'a1')).toMatchObject({ deleted_at: null })
  })
})

describe('calendar tools for the AI chat', () => {
  async function chat() {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle()
    google.addCalendar(ACCOUNT, { primary: true, summary: 'Personal' })
    google.addCalendar('classes', { summary: 'Classes', accessRole: 'reader' })
    google.addEvent(ACCOUNT, standup('a1', '2026-10-05'))
    google.addEvent(ACCOUNT, {
      id: 'inv', summary: 'Review', start: { dateTime: '2026-10-06T18:00:00Z' }, end: { dateTime: '2026-10-06T19:00:00Z' },
      organizer: { email: 'boss@example.com' },
      attendees: [{ email: 'boss@example.com', organizer: true, responseStatus: 'accepted' }, { email: ACCOUNT, self: true, responseStatus: 'needsAction' }]
    })
    vi.stubGlobal('fetch', google.fetch)
    await syncCalendarAccount(env, 'ego', ACCOUNT, SYNC_AT, { minimumGapMs: 0 })
    const ctx = {
      env, device: { deviceId: 'device-a', name: 'Desktop', datasetId: 'ego' }, now: SYNC_AT.toISOString(), today: '2026-10-02',
      timeZone: 'America/New_York', units: 'imperial' as const
    }
    return { env, google, ctx }
  }

  it('reads events on the user\'s clock with their keys', async () => {
    const { ctx } = await chat()
    const args = { from: '2026-10-05', to: '2026-10-06', query: null }
    expect(validateAssistantArguments('read_calendar', args).ok).toBe(true)
    const outcome = await executeAssistantRead(ctx, { name: 'read_calendar', args, callId: 'c1' })
    expect(outcome.data).toMatchObject({
      events: [
        { key: `${ACCOUNT}/${ACCOUNT}/a1`, title: 'Standup', start: '2026-10-05 09:00', end: '2026-10-05 09:30', calendar: 'Personal' },
        { key: `${ACCOUNT}/${ACCOUNT}/inv`, title: 'Review', yourAnswer: 'needsAction', organizer: 'boss@example.com' }
      ]
    })
    expect(outcome.trail).toBe('Read the calendar for Mon, Oct 5 to Tue, Oct 6')
    expect(await assistantSystemPrompt(ctx)).toContain('"name":"Personal"')
  })

  it('shows a new event on the card, then adds it to the primary calendar', async () => {
    const { ctx, google } = await chat()
    const args = {
      calendarId: null, title: 'Dentist', date: '2026-10-08', startTime: '15:00', endTime: null, endDate: null,
      location: 'Main St', description: null, guests: null, meet: null, repeat: 'RRULE:FREQ=MONTHLY;BYDAY=2TH'
    }
    expect(validateAssistantArguments('add_calendar_event', args).ok).toBe(true)
    expect(await describeWrite(ctx, 'add_calendar_event', args)).toEqual({
      title: 'Add an event',
      lines: ['"Dentist"', 'Thu, Oct 8, 3:00 PM to 4:00 PM', 'In Personal', 'Main St', 'Monthly on the second Thursday']
    })
    const outcome = await executeAssistantWrite(ctx, { name: 'add_calendar_event', args, callId: 'c2' })
    expect(outcome.trail).toBe('Added "Dentist" to Personal')
    expect(google.bodies.find((item) => item.method === 'POST')?.body).toMatchObject({
      summary: 'Dentist', start: { dateTime: '2026-10-08T19:00:00.000Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TH']
    })
  })

  it('moves an event and answers an invitation', async () => {
    const { ctx, google } = await chat()
    const move = { eventKey: `${ACCOUNT}/${ACCOUNT}/a1`, title: null, date: '2026-10-07', startTime: '10:00', endTime: null, location: null, description: null, allEvents: null }
    expect((await describeWrite(ctx, 'update_calendar_event', move)).lines).toContain('Move to Wed, Oct 7, 10:00 AM to 10:30 AM')
    await executeAssistantWrite(ctx, { name: 'update_calendar_event', args: move, callId: 'c3' })
    expect(google.calendars.get(ACCOUNT)?.events.get('a1')?.start).toEqual({ dateTime: '2026-10-07T14:00:00.000Z', date: null, timeZone: 'America/New_York' })
    const answer = { eventKey: `${ACCOUNT}/${ACCOUNT}/inv`, answer: 'declined', note: 'Out sick', allEvents: null }
    const outcome = await executeAssistantWrite(ctx, { name: 'answer_calendar_event', args: answer, callId: 'c4' })
    expect(outcome.trail).toBe('Not going: "Review"')
  })
})
