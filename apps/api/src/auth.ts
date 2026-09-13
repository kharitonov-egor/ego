import type { ApiResult, DeviceIdentity } from '@ego/api-contracts'

export interface Env {
  DB: D1Database
}

interface DeviceRow {
  id: string
  name: string
  dataset_id: string
}

const MINIMUM_TOKEN_LENGTH = 32

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null
  return value.trim()
}

/**
 * The device presents a credential this API can revoke on its own. It is never a
 * Cloudflare account token, so a stolen phone cannot reach the account API.
 */
export async function authorize(request: Request, db: D1Database): Promise<ApiResult<DeviceIdentity>> {
  const token = bearer(request)
  const unauthorized: ApiResult<DeviceIdentity> = {
    ok: false,
    error: { code: 'AUTH_REQUIRED', message: 'Connect this device again' }
  }
  if (!token || token.length < MINIMUM_TOKEN_LENGTH) return unauthorized
  const result = await db
    .prepare('SELECT id, name, dataset_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await hashToken(token))
    .all<DeviceRow>()
  const device = result.results?.[0]
  if (!device) return unauthorized
  return { ok: true, data: { deviceId: device.id, name: device.name, datasetId: device.dataset_id } }
}

export function touchDevice(db: D1Database, deviceId: string, now: string): Promise<unknown> {
  return db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, deviceId).run()
}
