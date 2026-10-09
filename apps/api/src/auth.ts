import type { BrowserWorker } from '@cloudflare/puppeteer'
import type { ApiResult, DeviceIdentity } from '@ego/api-contracts'

export interface Env {
  DB: D1Database
  /** Diary photos, videos, voice notes, and files, Tasks attachments, and Food photos. */
  DIARY_MEDIA?: R2Bucket
  OPENAI_API_KEY?: string
  CONNECTOR_TOKEN_KEY?: string
  CONNECTOR_TOKEN_KEY_PREVIOUS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  PUBLIC_BASE_URL?: string
  /** Comma-separated Google accounts that may sign in. Sign-in stays off while this is empty. */
  ALLOWED_EMAILS?: string
  /** Comma-separated origins of the web app. Only these may call the API from a browser or receive a sign-in. */
  WEB_ORIGINS?: string
  DATASET_ID?: string
  OPENROUTER_API_KEY?: string
  /** The OpenRouter model behind the AI chat. Defaults to openai/gpt-6-sol. */
  ASSISTANT_MODEL?: string
  /** The OpenRouter model that reads food photos. Falls back to ASSISTANT_MODEL. */
  FOOD_MODEL?: string
  /** The OpenRouter model that reads receipt photos for the web app. */
  RECEIPT_MODEL?: string
  /** A FoodData Central key. Barcode lookups use Open Food Facts alone without it. */
  USDA_API_KEY?: string
  TRELLO_API_KEY?: string
  TRELLO_TOKEN?: string
  /** The Canvas calendar feed link. Anyone holding it can read the calendar. */
  CANVAS_CALENDAR_URL?: string
  /** The secret given to `eas webhook:create`. EAS signs each build report with it. */
  EAS_WEBHOOK_SECRET?: string
  /** Daily SQL dumps of D1, kept forever. */
  BACKUPS?: R2Bucket
  D1_ACCOUNT_ID?: string
  D1_DATABASE_ID?: string
  /** A Cloudflare API token with D1 Edit on this account. The export API is not reachable through the binding. */
  D1_EXPORT_TOKEN?: string
  /** The HTML of every docket version. Private: the Worker serves each one only to its owner unless it is public. */
  DOCKETS?: R2Bucket
  /** Where docket links point, the web app's origin. Falls back to the first of WEB_ORIGINS. */
  DOCKET_BASE_URL?: string
  /** Cloudflare Browser Rendering. It screenshots bookmarks that have no cover image. */
  BROWSER?: BrowserWorker
  /** Those screenshots, served publicly under unguessable names. */
  CONTENT_PREVIEWS?: R2Bucket
}

export const currentDataset = (env: Pick<Env, 'DATASET_ID'>): string => env.DATASET_ID ?? 'ego'

interface DeviceRow {
  id: string
  name: string
  dataset_id: string
  created_at: string
  last_seen_at: string | null
  idle_days: number | null
}

const DAY_MS = 86_400_000

/** When an idle-limited token stops working, or null for one that never lapses. */
export function deviceExpiry(device: Pick<DeviceRow, 'created_at' | 'last_seen_at' | 'idle_days'>): string | null {
  if (device.idle_days === null) return null
  const lastUsed = Date.parse(device.last_seen_at ?? device.created_at)
  return new Date(Number.isFinite(lastUsed) ? lastUsed + device.idle_days * DAY_MS : 0).toISOString()
}

const MINIMUM_TOKEN_LENGTH = 32

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function bearer(request: Request): string | null {
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
export async function authorize(request: Request, db: D1Database, now = new Date()): Promise<ApiResult<DeviceIdentity>> {
  const token = bearer(request)
  const unauthorized: ApiResult<DeviceIdentity> = {
    ok: false,
    error: { code: 'AUTH_REQUIRED', message: 'Connect this device again' }
  }
  if (!token || token.length < MINIMUM_TOKEN_LENGTH) return unauthorized
  const result = await db
    .prepare(`SELECT id, name, dataset_id, created_at, last_seen_at, idle_days
      FROM devices WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(await hashToken(token))
    .all<DeviceRow>()
  const device = result.results?.[0]
  if (!device) return unauthorized
  const expiry = deviceExpiry(device)
  if (expiry !== null && expiry <= now.toISOString()) return unauthorized
  return { ok: true, data: { deviceId: device.id, name: device.name, datasetId: device.dataset_id } }
}

export function touchDevice(db: D1Database, deviceId: string, now: string): Promise<unknown> {
  return db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, deviceId).run()
}
