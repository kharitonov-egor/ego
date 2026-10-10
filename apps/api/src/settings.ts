import { invalid, isSharedSettingKey, type ApiResult, type SharedSetting, type SharedSettingKey } from '@ego/api-contracts'
import { isHotkeyBindings } from '@ego/core'
import { query } from './reads'

const VALIDATORS: Record<SharedSettingKey, (value: unknown) => boolean> = {
  hotkeys: isHotkeyBindings
}

interface SettingRow {
  value: string
  updated_at: string
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

async function readSetting(db: D1Database, key: SharedSettingKey): Promise<SharedSetting | null> {
  const row = (await query<SettingRow>(db, 'SELECT value, updated_at FROM settings WHERE key = ?', [key]))[0]
  if (!row) return null
  try {
    return { value: JSON.parse(row.value), updatedAt: row.updated_at }
  } catch {
    return null
  }
}

/**
 * GET and PUT /v1/settings/:key. A save older than the stored one is ignored, so a device that
 * was offline cannot undo a newer change, and either way the answer is what is stored.
 */
export async function settingsRoute(request: Request, db: D1Database, rawKey: string): Promise<ApiResult<SharedSetting | null>> {
  if (!isSharedSettingKey(rawKey)) return { ok: false, error: { code: 'NOT_FOUND', message: 'There is no such setting' } }
  if (request.method === 'GET') return { ok: true, data: await readSetting(db, rawKey) }
  if (request.method !== 'PUT') return { ok: false, error: { code: 'NOT_FOUND', message: 'There is no such setting' } }
  let body: unknown = null
  try { body = await request.json() } catch { body = null }
  if (typeof body !== 'object' || body === null || !('value' in body) || !('updatedAt' in body) ||
    !isTimestamp(body.updatedAt) || !VALIDATORS[rawKey](body.value)) {
    return invalid('That setting is not in the expected shape')
  }
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= settings.updated_at`).bind(rawKey, JSON.stringify(body.value), body.updatedAt).run()
  return { ok: true, data: await readSetting(db, rawKey) }
}
