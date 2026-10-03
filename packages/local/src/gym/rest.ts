export const REST_PRESETS = [30, 60, 90, 120, 180, 300] as const

export interface RestPreference {
  seconds: number
  autoStart: boolean
}

export const DEFAULT_REST: RestPreference = { seconds: 90, autoStart: true }

export function parseRestPreference(raw: string | null): RestPreference {
  if (!raw) return DEFAULT_REST
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_REST
    const record: Record<string, unknown> = { ...value }
    const seconds = typeof record.seconds === 'number' && Number.isInteger(record.seconds) && record.seconds >= 5 && record.seconds <= 3600
      ? record.seconds
      : DEFAULT_REST.seconds
    return { seconds, autoStart: record.autoStart !== false }
  } catch {
    return DEFAULT_REST
  }
}

export function secondsLeft(endsAt: number | null, now: number): number {
  if (endsAt === null) return 0
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}
