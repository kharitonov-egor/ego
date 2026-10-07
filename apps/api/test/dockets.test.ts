import { afterEach, describe, expect, it } from 'vitest'
import {
  DOCKET_ID_PATTERN, DOCKET_KEY_PREFIX, MAX_DOCKET_BYTES,
  type DocketDetail, type DocketKeyCreated, type DocketKeyList, type DocketKeySummary, type DocketList, type DocketUploaded
} from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { htmlDescription, htmlTitle, newDocketId } from '../src/dockets'
import worker from '../src/index'
import { handle } from '../src/router'
import { createTestDatabase } from './d1'
import { NOW, exec } from './helpers'
import { createTestBucket } from './r2'

const DEVICE_TOKEN = 'browser-device-token-that-is-long-enough-aaaa'
const OTHER_TOKEN = 'other-dataset-token-that-is-long-enough-bbbbb'
const SITE = 'https://ego.kharitonovegor.com'
const API = 'https://api.example'

const PLAN = `<!doctype html><html><head><meta charset="utf-8">
<meta content="Steps for the &quot;docket&quot; feature" name="description">
<title>  Docket   plan &amp; notes </title></head><body><h1>Plan</h1></body></html>`
const PLAN_V2 = '<html><head><title>Docket plan, revised</title></head><body><h1>Plan v2</h1></body></html>'

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

let close: (() => void) | null = null

afterEach(() => {
  close?.()
  close = null
})

async function setup(): Promise<{ env: Env; objects: Map<string, unknown> }> {
  const database = createTestDatabase()
  close = database.close
  await exec(database.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, last_seen_at, web_origin, idle_days)
    VALUES ('device-browser', 'Chrome on Windows', ?, 'ego', ?, ?, ?, 30)`, [await hashToken(DEVICE_TOKEN), NOW, new Date().toISOString(), SITE])
  await exec(database.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-other', 'Elsewhere', ?, 'other', ?)`, [await hashToken(OTHER_TOKEN), NOW])
  const { bucket, objects } = createTestBucket()
  return {
    env: { DB: database.db, DOCKETS: bucket, DOCKET_BASE_URL: SITE, WEB_ORIGINS: `${SITE}, http://localhost:5173` },
    objects
  }
}

function request(path: string, token: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(`${API}${path}`, { ...init, headers })
}

async function call<T>(env: Env, path: string, token: string | null, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const response = await handle(request(path, token, init), env)
  return { status: response.status, body: await response.json() as Envelope<T> }
}

function uploadBody(html: string | Uint8Array, meta: Record<string, unknown> = {}): FormData {
  const form = new FormData()
  form.append('file', new Blob([html], { type: 'text/html' }), 'plan.html')
  form.append('meta', JSON.stringify(meta))
  return form
}

async function newKey(env: Env, name?: string): Promise<DocketKeyCreated> {
  const created = await call<DocketKeyCreated>(env, '/v1/docket-keys', DEVICE_TOKEN, {
    method: 'POST', body: JSON.stringify(name ? { name } : {})
  })
  expect(created.status).toBe(200)
  return created.body.data
}

async function upload(env: Env, token: string, html: string, meta: Record<string, unknown> = {}, id?: string): Promise<DocketUploaded> {
  const path = id ? `/v1/dockets/${id}/versions` : '/v1/dockets'
  const result = await call<DocketUploaded>(env, path, token, { method: 'POST', body: uploadBody(html, meta) })
  expect(result.body.error).toBeUndefined()
  return result.body.data
}

function page(path: string, cookie?: string): Request {
  return new Request(`${API}${path}`, cookie ? { headers: { cookie } } : {})
}

async function signedInCookie(env: Env, token = DEVICE_TOKEN): Promise<string> {
  const response = await handle(request('/docket/session', token, { method: 'POST' }), env)
  expect(response.status).toBe(200)
  const header = response.headers.get('set-cookie') ?? ''
  expect(header).toMatch(/^ego_docket=[^;]+; Path=\/docket; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/)
  return header.split(';')[0]
}

describe('docket ids and file details', () => {
  it('makes ten lowercase letters and digits', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newDocketId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(DOCKET_ID_PATTERN)
  })

  it('reads the title and description from the head, entities decoded', () => {
    expect(htmlTitle(PLAN)).toBe('Docket plan & notes')
    expect(htmlDescription(PLAN)).toBe('Steps for the "docket" feature')
    expect(htmlTitle('<p>No head</p>')).toBeNull()
    expect(htmlDescription("<meta name='description' content='single quoted &#x2014; ok'>")).toBe('single quoted \u2014 ok')
  })
})

describe('docket keys', () => {
  it('shows a key once, lists it, and stops accepting it once revoked', async () => {
    const { env } = await setup()
    const created = await newKey(env)
    expect(created.token.startsWith(DOCKET_KEY_PREFIX)).toBe(true)
    expect(created.key.name).toMatch(/^CLI · \d{4}-\d{2}-\d{2}$/)

    const listed = await call<DocketKeyList>(env, '/v1/docket-keys', DEVICE_TOKEN)
    expect(listed.body.data.keys.map((key) => key.id)).toEqual([created.key.id])
    expect(JSON.stringify(listed.body)).not.toContain(created.token)

    const current = await call<DocketKeySummary>(env, '/v1/docket-keys/current', created.token)
    expect(current.body.data.id).toBe(created.key.id)
    expect(current.body.data.lastUsedAt).not.toBeNull()
    const renamed = await call<DocketKeySummary>(env, '/v1/docket-keys/current', created.token, {
      method: 'PATCH', body: JSON.stringify({ name: 'CLI · JARVIS' })
    })
    expect(renamed.body.data.name).toBe('CLI · JARVIS')
    expect((await call(env, '/v1/docket-keys/current', created.token, { method: 'PATCH', body: '{"name":" "}' })).status).toBe(400)
    expect((await call(env, '/v1/docket-keys/current', DEVICE_TOKEN, { method: 'PATCH', body: '{"name":"x"}' })).status).toBe(404)

    const revoked = await call<{ revoked: true }>(env, `/v1/docket-keys/${created.key.id}`, DEVICE_TOKEN, { method: 'DELETE' })
    expect(revoked.body.data.revoked).toBe(true)
    expect((await call(env, '/v1/dockets', created.token)).status).toBe(401)
  })

  it('keeps a key away from key management and from the rest of Ego', async () => {
    const { env } = await setup()
    const { token } = await newKey(env, 'Laptop')
    expect((await call(env, '/v1/docket-keys', token, { method: 'POST', body: '{}' })).status).toBe(400)
    expect((await call(env, '/v1/docket-keys', token)).status).toBe(400)
    expect((await call(env, '/v1/balances', token)).status).toBe(401)
    expect((await call(env, '/v1/devices', token)).status).toBe(401)
  })
})

describe('docket uploads', () => {
  it('creates a private docket from a file and records where it came from', async () => {
    const { env, objects } = await setup()
    const { token } = await newKey(env)
    const result = await upload(env, token, PLAN, { repository: 'kharitonov-egor/ego', commit: 'abc1234', ref: 'main', fileName: 'plan.html' })
    expect(result.version).toBe(1)
    expect(result.docket.id).toMatch(DOCKET_ID_PATTERN)
    expect(result.docket).toMatchObject({
      title: 'Docket plan & notes',
      description: 'Steps for the "docket" feature',
      public: false,
      repository: 'kharitonov-egor/ego',
      latestVersion: 1,
      versionCount: 1,
      url: `${SITE}/docket/${result.docket.id}`
    })
    expect(result.versionUrl).toBe(`${SITE}/docket/${result.docket.id}/v/1`)
    expect(objects.size).toBe(1)

    const detail = await call<DocketDetail>(env, `/v1/dockets/${result.docket.id}`, DEVICE_TOKEN)
    expect(detail.body.data.versions).toEqual([
      expect.objectContaining({ version: 1, commit: 'abc1234', ref: 'main', size: new TextEncoder().encode(PLAN).byteLength })
    ])
  })

  it('takes the title from flags, then the file, then the file name', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    expect((await upload(env, token, PLAN, { title: 'From the flag', public: true })).docket).toMatchObject({ title: 'From the flag', public: true })
    expect((await upload(env, token, '<p>bare</p>', { fileName: 'C:\\plans\\launch-notes.html' })).docket.title).toBe('launch-notes')
    expect((await upload(env, token, '<p>bare</p>')).docket.title).toBe('Untitled docket')
  })

  it('adds a version at the same link and keeps the visibility unless asked', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const first = await upload(env, token, PLAN, { public: true, repository: 'kharitonov-egor/ego' })
    const second = await upload(env, token, PLAN_V2, {}, first.docket.id)
    expect(second.version).toBe(2)
    expect(second.docket).toMatchObject({
      id: first.docket.id, url: first.docket.url, title: 'Docket plan, revised', public: true,
      repository: 'kharitonov-egor/ego', latestVersion: 2, versionCount: 2
    })
    expect(second.versionUrl).toBe(`${SITE}/docket/${first.docket.id}/v/2`)
    const third = await upload(env, token, PLAN_V2, { public: false }, first.docket.id)
    expect(third.docket.public).toBe(false)

    const html = await handle(request(`/v1/dockets/${first.docket.id}/html?version=1`, token), env)
    expect(await html.text()).toBe(PLAN)
    expect(html.headers.get('x-docket-version')).toBe('1')
    expect(await (await handle(request(`/v1/dockets/${first.docket.id}/html`, token), env)).text()).toBe(PLAN_V2)
  })

  it('refuses files over the limit and empty ones', async () => {
    const { env, objects } = await setup()
    const { token } = await newKey(env)
    const big = await call(env, '/v1/dockets', token, { method: 'POST', body: uploadBody(new Uint8Array(MAX_DOCKET_BYTES + 1)) })
    expect(big.status).toBe(400)
    expect(big.body.error?.message).toContain('10 MB')
    expect((await call(env, '/v1/dockets', token, { method: 'POST', body: uploadBody('') })).status).toBe(400)
    expect(objects.size).toBe(0)
  })

  it('answers not found for another dataset, a bad ID, or a new version of a missing docket', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const mine = await upload(env, token, PLAN)
    expect((await call(env, `/v1/dockets/${mine.docket.id}`, OTHER_TOKEN)).status).toBe(404)
    expect((await call<DocketList>(env, '/v1/dockets', OTHER_TOKEN)).body.data.dockets).toEqual([])
    expect((await call(env, '/v1/dockets/NOT-AN-ID', token)).status).toBe(404)
    expect((await call(env, '/v1/dockets/abcdefghij/versions', token, { method: 'POST', body: uploadBody(PLAN) })).status).toBe(404)
  })
})

describe('docket edits', () => {
  it('publishes, renames, and lists newest upload first', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const older = await upload(env, token, PLAN)
    const newer = await upload(env, token, PLAN_V2)
    const edited = await call<DocketDetail>(env, `/v1/dockets/${older.docket.id}`, token, {
      method: 'PATCH', body: JSON.stringify({ public: true, title: '  Renamed  ', description: 'New words' })
    })
    expect(edited.body.data).toMatchObject({ public: true, title: 'Renamed', description: 'New words' })
    await exec(env.DB, 'UPDATE dockets SET updated_at = ? WHERE id = ?', ['2026-01-01T00:00:00.000Z', older.docket.id])
    const listed = await call<DocketList>(env, '/v1/dockets', DEVICE_TOKEN)
    expect(listed.body.data.dockets.map((docket) => docket.id)).toEqual([newer.docket.id, older.docket.id])
    expect((await call(env, `/v1/dockets/${older.docket.id}`, token, { method: 'PATCH', body: JSON.stringify({ title: ' ' }) })).status).toBe(400)
    expect((await call(env, `/v1/dockets/${older.docket.id}`, token, { method: 'PATCH', body: '{}' })).status).toBe(400)
  })

  it('deletes every version and its files', async () => {
    const { env, objects } = await setup()
    const { token } = await newKey(env)
    const first = await upload(env, token, PLAN, { public: true })
    await upload(env, token, PLAN_V2, {}, first.docket.id)
    expect(objects.size).toBe(2)
    expect((await call(env, `/v1/dockets/${first.docket.id}`, token, { method: 'DELETE' })).body.data).toEqual({ deleted: true })
    expect(objects.size).toBe(0)
    expect((await handle(page(`/docket/${first.docket.id}`), env)).status).toBe(404)
    expect((await call(env, `/v1/dockets/${first.docket.id}`, token, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('docket pages', () => {
  it('serves a public docket sandboxed, at the latest version or a pinned one', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const first = await upload(env, token, PLAN, { public: true })
    await upload(env, token, PLAN_V2, {}, first.docket.id)

    const latest = await handle(page(`/docket/${first.docket.id}`), env)
    expect(latest.status).toBe(200)
    expect(await latest.text()).toBe(PLAN_V2)
    const policy = latest.headers.get('content-security-policy') ?? ''
    expect(policy).toMatch(/^sandbox allow-scripts /)
    expect(policy).not.toContain('allow-same-origin')
    expect(latest.headers.get('x-robots-tag')).toContain('noindex')

    expect(await (await handle(page(`/docket/${first.docket.id}/v/1`), env)).text()).toBe(PLAN)
    const missing = await handle(page(`/docket/${first.docket.id}/v/9`), env)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('no version 9')
    expect((await handle(page('/docket/abcdefghij'), env)).status).toBe(404)
    expect((await handle(page('/docket/short'), env)).status).toBe(404)
  })

  it('shows a private docket only to a browser with its cookie', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const docket = await upload(env, token, PLAN)

    const stranger = await handle(page(`/docket/${docket.docket.id}/v/1`), env)
    expect(stranger.status).toBe(401)
    expect(stranger.headers.get('set-cookie')).toBeNull()
    const text = await stranger.text()
    expect(text).toContain('This docket is private')
    expect(text).toContain(`${SITE}/dockets?open=${docket.docket.id}/v/1`)
    expect(text).not.toContain('Plan</h1>')

    const cookie = await signedInCookie(env)
    const mine = await handle(page(`/docket/${docket.docket.id}`, cookie), env)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    expect(await mine.text()).toBe(PLAN)

    const otherCookie = await signedInCookie(env, OTHER_TOKEN)
    expect((await handle(page(`/docket/${docket.docket.id}`, otherCookie), env)).status).toBe(401)
  })

  it('keeps the same cookie on a refresh and drops it when the device signs out', async () => {
    const { env } = await setup()
    const { token } = await newKey(env)
    const docket = await upload(env, token, PLAN)
    const cookie = await signedInCookie(env)
    const refreshed = await handle(request('/docket/session', DEVICE_TOKEN, { method: 'POST', headers: { cookie } }), env)
    expect(refreshed.headers.get('set-cookie')?.split(';')[0]).toBe(cookie)

    expect((await handle(request('/v1/session', DEVICE_TOKEN, { method: 'DELETE' }), env)).status).toBe(200)
    const after = await handle(page(`/docket/${docket.docket.id}`, cookie), env)
    expect(after.status).toBe(401)
    expect(after.headers.get('set-cookie')).toMatch(/^ego_docket=; Path=\/docket; .*Max-Age=0$/)
  })

  it('gives a tab-only sign-in a cookie that ends with the browser session', async () => {
    const { env } = await setup()
    await exec(env.DB, 'UPDATE devices SET idle_days = 1 WHERE id = ?', ['device-browser'])
    const response = await handle(request('/docket/session', DEVICE_TOKEN, { method: 'POST' }), env)
    expect(response.headers.get('set-cookie')).not.toContain('Max-Age')
    expect((await handle(request('/docket/session', null, { method: 'POST' }), env)).status).toBe(401)
  })
})

describe('browser calls', () => {
  it('allows PATCH from the web app', async () => {
    const { env } = await setup()
    const preflight = await worker.fetch(new Request(`${API}/v1/dockets/abcdefghij`, {
      method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'PATCH' }
    }), env, { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PATCH')
  })
})
