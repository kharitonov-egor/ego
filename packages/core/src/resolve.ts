/**
 * Resolve mode: a countdown in a board's focus mode that counts the cards checked off while it
 * runs. Finished runs are shared by every computer and browser.
 */

export interface ResolveRun {
  id: string
  boardId: string
  startedAt: string
  /** What the countdown was set to. */
  plannedSeconds: number
  /** How long the clock ran, pauses left out. Less than planned when the run was stopped early. */
  seconds: number
  cards: number
}

/** A stretch of the clock running, in epoch milliseconds. A pause closes one; `end` is null while it runs. */
export interface ResolveSegment {
  start: number
  end: number | null
}

export const RESOLVE_RUNS_LIMIT = 200
export const RESOLVE_MAX_SECONDS = 24 * 60 * 60
/** One card in a 20-second run would otherwise hold the best pace forever. */
export const RESOLVE_BEST_MIN_SECONDS = 5 * 60
export const RESOLVE_PRESETS = [5 * 60, 10 * 60, 25 * 60, 60 * 60] as const
export const RESOLVE_RECENT_RUNS = 10

const ID = /^[A-Za-z0-9_-]{1,64}$/
const CARDS_LIMIT = 100_000

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isResolveRun(value: unknown): value is ResolveRun {
  if (typeof value !== 'object' || value === null) return false
  const run: Partial<Record<keyof ResolveRun, unknown>> = value
  return typeof run.id === 'string' && ID.test(run.id) &&
    typeof run.boardId === 'string' && run.boardId.length > 0 && run.boardId.length <= 64 &&
    typeof run.startedAt === 'string' && run.startedAt.length <= 40 && !Number.isNaN(Date.parse(run.startedAt)) &&
    isWhole(run.plannedSeconds, 1, RESOLVE_MAX_SECONDS) &&
    isWhole(run.seconds, 0, run.plannedSeconds) &&
    isWhole(run.cards, 0, CARDS_LIMIT)
}

export function isResolveRuns(value: unknown): value is ResolveRun[] {
  return Array.isArray(value) && value.length <= RESOLVE_RUNS_LIMIT && value.every(isResolveRun)
}

/** Every run from each copy once, newest first, keeping the newest `RESOLVE_RUNS_LIMIT`. */
export function mergeResolveRuns(...copies: readonly (readonly ResolveRun[])[]): ResolveRun[] {
  const byId = new Map<string, ResolveRun>()
  for (const copy of copies) for (const run of copy) if (!byId.has(run.id)) byId.set(run.id, run)
  return [...byId.values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id))
    .slice(0, RESOLVE_RUNS_LIMIT)
}

/** Cards per minute. */
export function resolvePace(cards: number, seconds: number): number | null {
  return seconds > 0 ? cards / (seconds / 60) : null
}

export function runPace(run: ResolveRun): number {
  return resolvePace(run.cards, run.seconds) ?? 0
}

export interface ResolveStats {
  /** The fastest run of at least `RESOLVE_BEST_MIN_SECONDS`. The earlier run keeps a tie. */
  best: ResolveRun | null
  /** The run that cleared the most cards, the faster one on a tie. */
  most: ResolveRun | null
  /** All the cards of the newest runs over all their minutes, so a short run weighs less. */
  recentPace: number | null
  recent: ResolveRun[]
}

export function resolveStats(runs: readonly ResolveRun[]): ResolveStats {
  const ordered = mergeResolveRuns(runs)
  let best: ResolveRun | null = null
  let most: ResolveRun | null = null
  for (const run of [...ordered].reverse()) {
    if (run.seconds >= RESOLVE_BEST_MIN_SECONDS && (!best || runPace(run) > runPace(best))) best = run
    if (!most || run.cards > most.cards || (run.cards === most.cards && runPace(run) > runPace(most))) most = run
  }
  const recent = ordered.slice(0, RESOLVE_RECENT_RUNS)
  const recentPace = resolvePace(recent.reduce((total, run) => total + run.cards, 0), recent.reduce((total, run) => total + run.seconds, 0))
  return { best, most, recentPace, recent }
}

export interface ResolveRecord {
  bestPace: boolean
  mostCards: boolean
  /** The best pace before this run, to show what it beat. */
  previousBest: number | null
}

/** What a finished run beat, measured against the runs before it. */
export function resolveRecord(run: ResolveRun, before: readonly ResolveRun[]): ResolveRecord {
  const { best, most } = resolveStats(before.filter((item) => item.id !== run.id))
  const previousBest = best ? runPace(best) : null
  return {
    bestPace: run.seconds >= RESOLVE_BEST_MIN_SECONDS && run.cards > 0 && (previousBest === null || runPace(run) > previousBest),
    mostCards: most !== null && run.cards > most.cards,
    previousBest
  }
}

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 }
const PART = /(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)(?![a-z])/g
const CLOCK = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/

/**
 * Seconds from what a person types: `90s`, `10m`, `1h 30m`, `1.5h`, `25 min`, `1:30` (m:ss),
 * `1:30:00` (h:mm:ss), or a bare number, which means minutes. Null when it reads as nothing or
 * as more than a day.
 */
export function parseResolveDuration(text: string): number | null {
  const typed = text.trim().toLowerCase()
  if (typed === '') return null
  let total: number
  const clock = CLOCK.exec(typed)
  if (/^\d+(?:\.\d+)?$/.test(typed)) {
    total = Number(typed) * 60
  } else if (clock) {
    const parts = clock.slice(1).filter((part): part is string => part !== undefined).map(Number)
    if (parts.slice(1).some((part) => part >= 60)) return null
    total = parts.reduce((sum, part) => sum * 60 + part, 0)
  } else {
    total = 0
    const rest = typed.replace(PART, (_match, amount: string, unit: string) => {
      total += Number(amount) * (UNIT_SECONDS[unit[0] ?? ''] ?? 0)
      return ' '
    })
    if (rest.trim() !== '') return null
  }
  const seconds = Math.round(total)
  return seconds >= 1 && seconds <= RESOLVE_MAX_SECONDS ? seconds : null
}

/** `25m`, `1h 30m`, `1m 30s`. */
export function resolveDurationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const parts: string[] = []
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (rest) parts.push(`${rest}s`)
  return parts.length > 0 ? parts.join(' ') : '0s'
}

/** `12:41`, or `1:02:03` from an hour up. */
export function resolveClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

/** `0.56`, `12.5`. */
export function resolvePaceLabel(pace: number): string {
  return pace >= 10 ? pace.toFixed(1) : pace.toFixed(2)
}

/** Milliseconds the clock has run by `now`. */
export function resolveElapsed(segments: readonly ResolveSegment[], now: number): number {
  return segments.reduce((total, segment) => total + Math.max(0, (segment.end ?? now) - segment.start), 0)
}

/** When the countdown reaches zero, or null while it is paused. */
export function resolveEndsAt(segments: readonly ResolveSegment[], plannedSeconds: number): number | null {
  const open = segments.find((segment) => segment.end === null)
  if (!open) return null
  const before = resolveElapsed(segments.filter((segment) => segment !== open), open.start)
  return open.start + plannedSeconds * 1000 - before
}

/** The segments with the open one closed at `at`. */
export function closeResolveSegments(segments: readonly ResolveSegment[], at: number): ResolveSegment[] {
  return segments.map((segment) => segment.end === null ? { start: segment.start, end: Math.max(segment.start, at) } : segment)
}

interface DoneCard {
  boardId: string
  doneAt: string | null
}

/** Cards on the board whose check went on while the clock ran. A card unchecked since has no `doneAt` and drops out. */
export function resolveCount(cards: readonly DoneCard[], boardId: string, segments: readonly ResolveSegment[], now: number): number {
  let count = 0
  for (const card of cards) {
    if (card.boardId !== boardId || card.doneAt === null) continue
    const at = Date.parse(card.doneAt)
    if (segments.some((segment) => at >= segment.start && at < (segment.end ?? now + 1))) count += 1
  }
  return count
}
