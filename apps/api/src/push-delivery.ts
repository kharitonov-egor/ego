import type { DeviceIdentity, WebPushSubscriptionInput, WebPushTestResult } from '@ego/api-contracts'
import { readAgentSettings } from './agent-settings'
import type { Env } from './auth'
import { query } from './reads'
import { sendPush, vapidKeys, type PushMessage, type PushSubscriptionKeys } from './web-push'

const AGENT_ROUTE = '/ai?chat=agent'
/** A notification older than this is no longer worth a push. Devices still list it. */
const PUSH_WINDOW_MS = 24 * 3_600_000
/** A subscription that keeps failing is dropped; the browser can subscribe again from Settings. */
const MAX_FAILURES = 5

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface DueRow {
  id: string
  dataset_id: string
  title: string
  body: string
}

export async function saveSubscription(db: D1Database, device: DeviceIdentity, input: WebPushSubscriptionInput, now: string): Promise<void> {
  await db.prepare(`INSERT INTO web_push_subscriptions (id, dataset_id, device_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET dataset_id = excluded.dataset_id, device_id = excluded.device_id, p256dh = excluded.p256dh,
      auth = excluded.auth, failures = 0, revoked_at = NULL`)
    .bind(crypto.randomUUID(), device.datasetId, device.deviceId, input.endpoint, input.keys.p256dh, input.keys.auth, now).run()
}

export async function removeSubscription(db: D1Database, device: DeviceIdentity, endpoint: string, now: string): Promise<void> {
  await db.prepare('UPDATE web_push_subscriptions SET revoked_at = ? WHERE endpoint = ? AND dataset_id = ? AND revoked_at IS NULL')
    .bind(now, endpoint, device.datasetId).run()
}

/** Live subscriptions whose browser is still signed in. */
async function subscriptionsFor(db: D1Database, datasetId: string, deviceId: string | null = null): Promise<SubscriptionRow[]> {
  return query<SubscriptionRow>(db, `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM web_push_subscriptions s
    JOIN devices d ON d.id = s.device_id AND d.revoked_at IS NULL
    WHERE s.dataset_id = ? AND s.revoked_at IS NULL ${deviceId ? 'AND s.device_id = ?' : ''}`, deviceId ? [datasetId, deviceId] : [datasetId])
}

async function pushTo(db: D1Database, rows: readonly SubscriptionRow[], message: PushMessage, env: Env, now: string): Promise<WebPushTestResult> {
  const keys = vapidKeys(env)
  const tally: WebPushTestResult = { sent: 0, failed: 0 }
  if (!keys) return tally
  for (const row of rows) {
    const subscription: PushSubscriptionKeys = { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }
    const result = await sendPush(subscription, message, keys, Date.parse(now))
    if (result === 'sent') {
      tally.sent += 1
      await db.prepare('UPDATE web_push_subscriptions SET last_sent_at = ?, failures = 0 WHERE id = ?').bind(now, row.id).run()
    } else {
      tally.failed += 1
      await db.prepare(`UPDATE web_push_subscriptions SET failures = failures + 1,
        revoked_at = CASE WHEN ? OR failures + 1 >= ? THEN ? ELSE revoked_at END WHERE id = ?`)
        .bind(result === 'gone' ? 1 : 0, MAX_FAILURES, now, row.id).run()
    }
  }
  return tally
}

/**
 * Pushes every notification whose time has come and that has not gone out yet, to every browser
 * that subscribed, unless the user turned Web off. Each notification is marked whatever happens,
 * so a dead push service cannot make the cron resend it forever.
 */
export async function deliverWebPushes(env: Env, now: string, datasetId: string | null = null): Promise<number> {
  const keys = vapidKeys(env)
  if (!keys) return 0
  const since = new Date(Date.parse(now) - PUSH_WINDOW_MS).toISOString()
  const due = await query<DueRow>(env.DB, `SELECT id, dataset_id, title, body FROM agent_notifications
    WHERE pushed_at IS NULL AND silent = 0 AND deliver_at <= ? AND created_at >= ? ${datasetId ? 'AND dataset_id = ?' : ''}
    ORDER BY deliver_at`, datasetId ? [now, since, datasetId] : [now, since])
  let sent = 0
  for (const row of due) {
    const claimed = await env.DB.prepare('UPDATE agent_notifications SET pushed_at = ? WHERE id = ? AND pushed_at IS NULL').bind(now, row.id).run()
    if ((claimed.meta.changes ?? 0) === 0) continue
    const settings = await readAgentSettings(env.DB, row.dataset_id)
    if (!settings.devices.web) continue
    const result = await pushTo(env.DB, await subscriptionsFor(env.DB, row.dataset_id), {
      title: row.title, body: row.body, route: AGENT_ROUTE, tag: row.id, urgent: false
    }, env, now)
    sent += result.sent
  }
  return sent
}

/** A push to this browser only, from the button in Settings. */
export async function testPush(env: Env, device: DeviceIdentity, now: string): Promise<WebPushTestResult> {
  return pushTo(env.DB, await subscriptionsFor(env.DB, device.datasetId, device.deviceId), {
    title: 'Ego', body: 'Notifications from the agent will look like this.', route: AGENT_ROUTE, tag: 'test', urgent: false
  }, env, now)
}
