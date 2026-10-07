import type { DeviceIdentity, DeviceList, DeviceSummary } from '@ego/api-contracts'
import { deviceExpiry } from './auth'

interface DeviceListRow {
  id: string
  name: string
  account_email: string | null
  created_at: string
  last_seen_at: string | null
  web_origin: string | null
  idle_days: number | null
}

/** Every device that can still reach this dataset, most recently used first. */
export async function listDevices(db: D1Database, device: DeviceIdentity, now: string): Promise<DeviceList> {
  const rows = await db.prepare(`SELECT id, name, account_email, created_at, last_seen_at, web_origin, idle_days
    FROM devices WHERE dataset_id = ? AND revoked_at IS NULL
    ORDER BY COALESCE(last_seen_at, created_at) DESC, id`)
    .bind(device.datasetId).all<DeviceListRow>()
  const devices: DeviceSummary[] = []
  for (const row of rows.results ?? []) {
    const expiresAt = deviceExpiry(row)
    if (expiresAt !== null && expiresAt <= now) continue
    devices.push({
      id: row.id,
      name: row.name,
      email: row.account_email,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      browser: row.web_origin !== null,
      expiresAt,
      current: row.id === device.deviceId
    })
  }
  return { devices }
}

/** Stops the Worker accepting another device's token. Revoking the asking device signs it out. */
export async function revokeDevice(db: D1Database, device: DeviceIdentity, targetId: string, now: string): Promise<boolean> {
  const result = await db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND dataset_id = ? AND revoked_at IS NULL')
    .bind(now, targetId, device.datasetId).run()
  return (result.meta.changes ?? 0) === 1
}
