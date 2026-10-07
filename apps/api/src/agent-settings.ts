import type { AssistantUnits } from '@ego/api-contracts'
import { isValidTimeZone } from './google-health'

/** Until a device has sent its own, the clock Ego reads dates on for Claude. */
export const FALLBACK_TIME_ZONE = 'America/New_York'

/**
 * What the agent remembers between requests. The apps send their time zone and units with every
 * chat turn, so Claude's calls over MCP read "today" on the same clock.
 */
export interface AgentSettingsRecord {
  timeZone: string | null
  units: AssistantUnits
}

const DEFAULTS: AgentSettingsRecord = { timeZone: null, units: 'imperial' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSettings(raw: string | null): AgentSettingsRecord {
  if (!raw) return { ...DEFAULTS }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { ...DEFAULTS } }
  if (!isRecord(value)) return { ...DEFAULTS }
  return {
    timeZone: isValidTimeZone(value.timeZone) ? value.timeZone : null,
    units: value.units === 'metric' ? 'metric' : 'imperial'
  }
}

export async function readAgentSettings(db: D1Database, datasetId: string): Promise<AgentSettingsRecord> {
  const row = await db.prepare('SELECT settings FROM agent_settings WHERE dataset_id = ?').bind(datasetId).first<{ settings: string }>()
  return parseSettings(row?.settings ?? null)
}

export async function writeAgentSettings(db: D1Database, datasetId: string, settings: AgentSettingsRecord, now: string): Promise<void> {
  await db.prepare(`INSERT INTO agent_settings (dataset_id, settings, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(dataset_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`)
    .bind(datasetId, JSON.stringify(settings), now).run()
}

/** Keeps the latest device clock and units. Writes only when either changed. */
export async function rememberClientContext(
  db: D1Database, datasetId: string, timeZone: string | null, units: AssistantUnits, now: string
): Promise<void> {
  const current = await readAgentSettings(db, datasetId)
  const zone = isValidTimeZone(timeZone) ? timeZone : current.timeZone
  if (zone === current.timeZone && units === current.units) return
  await writeAgentSettings(db, datasetId, { ...current, timeZone: zone, units }, now)
}

export function agentTimeZone(settings: AgentSettingsRecord): string {
  return settings.timeZone ?? FALLBACK_TIME_ZONE
}
