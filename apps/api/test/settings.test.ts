import { afterEach, describe, expect, it } from 'vitest'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'settings-device-token-long-enough-0123456789'

let server: Ledger | null = null

afterEach(() => {
  server?.close()
  server = null
})

async function setup(): Promise<Env> {
  server = await seedLedger()
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-1', 'Desk', ?, 'ego', ?)`,
    [await hashToken(TOKEN), NOW])
  return { DB: server.db }
}

async function call(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; payload: unknown }> {
  const response = await handle(new Request(`https://ego.example${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` }
  }), env)
  return { status: response.status, payload: await response.json() }
}

describe('shared settings', () => {
  it('starts empty, keeps a save, and ignores one older than what it has', async () => {
    const env = await setup()
    expect((await call(env, 'GET', '/v1/settings/hotkeys')).payload).toEqual({ ok: true, data: null })

    const newer = { value: { 'card.archive': 'KeyX', 'card.label1': 'Digit1' }, updatedAt: '2026-10-10T12:00:00.000Z' }
    expect((await call(env, 'PUT', '/v1/settings/hotkeys', newer)).payload).toEqual({ ok: true, data: newer })

    const older = { value: { 'card.archive': 'KeyZ' }, updatedAt: '2026-10-10T11:00:00.000Z' }
    expect((await call(env, 'PUT', '/v1/settings/hotkeys', older)).payload).toEqual({ ok: true, data: newer })
    expect((await call(env, 'GET', '/v1/settings/hotkeys')).payload).toEqual({ ok: true, data: newer })
  })

  it('refuses a shortcut in the wrong shape and a key it does not know', async () => {
    const env = await setup()
    const bad = await call(env, 'PUT', '/v1/settings/hotkeys', { value: { 'card.archive': 'ctrl c' }, updatedAt: NOW })
    expect(bad.status).toBe(400)
    expect((await call(env, 'GET', '/v1/settings/theme')).status).toBe(404)
  })
})
