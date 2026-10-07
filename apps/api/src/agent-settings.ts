import { ASSISTANT_TOOLS, DEFAULT_AGENT_SETTINGS, isAgentSettings, isAssistantToolName, type AgentSettings } from '@ego/core'
import type { AssistantUnits } from '@ego/api-contracts'
import { isValidTimeZone } from './google-health'

/** Until a device has sent its own, the clock Ego reads dates on for Claude. */
export const FALLBACK_TIME_ZONE = 'America/New_York'

/**
 * Everything the agent keeps per dataset: the user's settings, the latest device clock and units
 * (the apps send them with every chat turn, so Claude reads "today" on the same clock), when the
 * Agent chat was last read, and how the routine's last fires went.
 */
export interface AgentSettingsRecord extends AgentSettings {
  timeZone: string | null
  units: AssistantUnits
  readAt: string | null
  lastFiredAt: string | null
  lastFireError: string | null
  /** Fire times in the last hour. The routine's API trigger allows only so many. */
  fires: string[]
  /** The Composio Tool Router session the chat's app tools run in. */
  composioSessionId: string | null
}

const DEFAULTS: AgentSettingsRecord = {
  ...DEFAULT_AGENT_SETTINGS,
  devices: { ...DEFAULT_AGENT_SETTINGS.devices },
  trusted: [...DEFAULT_AGENT_SETTINGS.trusted],
  timeZone: null,
  units: 'imperial',
  readAt: null,
  lastFiredAt: null,
  lastFireError: null,
  fires: [],
  composioSessionId: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Only write tools can be trusted; anything else in the list is dropped. */
export function trustedTools(list: readonly string[]): string[] {
  return [...new Set(list)].filter((name) => isAssistantToolName(name) && ASSISTANT_TOOLS[name].access === 'write')
}

export function parseSettings(raw: string | null): AgentSettingsRecord {
  if (!raw) return { ...DEFAULTS, devices: { ...DEFAULTS.devices }, trusted: [...DEFAULTS.trusted] }
  let value: unknown
  try { value = JSON.parse(raw) } catch { value = null }
  if (!isRecord(value)) return parseSettings(null)
  const user: AgentSettings = isAgentSettings(value)
    ? { quietStart: value.quietStart, quietEnd: value.quietEnd, dailyCap: value.dailyCap, devices: { ...value.devices }, proposalDays: value.proposalDays, trusted: trustedTools(value.trusted) }
    : { ...DEFAULT_AGENT_SETTINGS, devices: { ...DEFAULT_AGENT_SETTINGS.devices }, trusted: [...DEFAULT_AGENT_SETTINGS.trusted] }
  return {
    ...user,
    timeZone: isValidTimeZone(value.timeZone) ? value.timeZone : null,
    units: value.units === 'metric' ? 'metric' : 'imperial',
    readAt: stringOrNull(value.readAt),
    lastFiredAt: stringOrNull(value.lastFiredAt),
    lastFireError: stringOrNull(value.lastFireError),
    fires: Array.isArray(value.fires) ? value.fires.filter((item): item is string => typeof item === 'string') : [],
    composioSessionId: stringOrNull(value.composioSessionId)
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

/** Reads, changes, and writes the record in one go. */
export async function updateAgentSettings(
  db: D1Database, datasetId: string, now: string, change: (current: AgentSettingsRecord) => AgentSettingsRecord
): Promise<AgentSettingsRecord> {
  const next = change(await readAgentSettings(db, datasetId))
  await writeAgentSettings(db, datasetId, next, now)
  return next
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

export function agentTimeZone(settings: Pick<AgentSettingsRecord, 'timeZone'>): string {
  return settings.timeZone ?? FALLBACK_TIME_ZONE
}

export function userSettings(record: AgentSettingsRecord): AgentSettings {
  return {
    quietStart: record.quietStart,
    quietEnd: record.quietEnd,
    dailyCap: record.dailyCap,
    devices: { ...record.devices },
    proposalDays: record.proposalDays,
    trusted: [...record.trusted]
  }
}
