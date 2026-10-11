import React, { useState } from 'react'
import { ArrowLeft, ChartColumn, ChevronDown, ChevronUp, Pause, Play, Square, Timer } from 'lucide-react'
import {
  parseResolveDuration, resolveClock, resolveDurationLabel, resolvePace, resolvePaceLabel, resolveRecord, resolveStats, runPace,
  RESOLVE_BEST_MIN_SECONDS, RESOLVE_PRESETS, type ResolveRun
} from '@ego/core'
import { useResolve, useResolveClock, type ActiveResolve } from '../../lib/tasks/resolve'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

/** Pace during a run reads as noise until a minute has gone by. */
const LIVE_PACE_AFTER_SECONDS = 60

/** Buttons give the focus back, so Space and Enter go on acting on the card in the middle. */
function pressed(action: () => void): (event: React.MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.currentTarget.blur()
    action()
  }
}

function isPaused(active: ActiveResolve): boolean {
  return active.finished === null && active.segments.every((segment) => segment.end !== null)
}

/** `Today 14:05`, `Yesterday 9:30`, or `Oct 9` for older runs. */
function runWhen(startedAt: string, now: Date, withTime = true): string {
  const at = new Date(startedAt)
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const name = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : null
  if (!name) return at.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return withTime ? `${name} ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : name
}

/** The collapsed button's text: what is running, or just the mode's name. */
function Summary({ active }: { active: ActiveResolve | null }): React.ReactElement {
  const clock = useResolveClock()
  if (!active) return <span>Resolve</span>
  if (active.finished) {
    const ended = active.finished.seconds >= active.plannedSeconds ? "Time's up" : 'Stopped'
    return <span className="tabular">{ended} · {active.finished.cards} done</span>
  }
  return <span className={cn('tabular', isPaused(active) && 'text-surface-400')}>{resolveClock(clock.remaining)} · {clock.cards} done</span>
}

/** What the board's Focus button adds while a run on this board is going. */
export function ResolveBadge({ boardId }: { boardId: string }): React.ReactElement | null {
  const { active } = useResolve()
  const clock = useResolveClock()
  if (!active || active.boardId !== boardId) return null
  const text = active.finished ? (active.finished.seconds >= active.plannedSeconds ? "Time's up" : 'Stopped') : resolveClock(clock.remaining)
  return <span className="tabular text-surface-300">· {text}</span>
}

function Stat({ value, label, detail }: { value: string; label: string; detail: string }): React.ReactElement {
  return <div className="min-w-0 rounded-xl bg-surface-800 px-2.5 py-2">
    <p className="tabular text-[20px] font-bold leading-tight text-foreground">{value}</p>
    <p className="mt-0.5 text-[12px] leading-snug text-surface-300">{label}</p>
    <p className="text-[12px] leading-snug text-surface-500">{detail}</p>
  </div>
}

function Stats({ runs }: { runs: readonly ResolveRun[] }): React.ReactElement {
  const now = new Date()
  const { best, most, recentPace, recent } = resolveStats(runs)
  if (runs.length === 0) {
    return <p className="py-3 text-[14px] leading-snug text-surface-400">
      No runs yet. Every finished run shows up here, from every computer and browser.
    </p>
  }
  const fastest = Math.max(...recent.map(runPace), 0.01)
  return <div className="flex flex-col gap-3">
    <div className="grid grid-cols-3 gap-1.5">
      <Stat
        value={best ? resolvePaceLabel(runPace(best)) : '–'}
        label="best per minute"
        detail={best ? `${runWhen(best.startedAt, now, false)}, ${resolveDurationLabel(best.seconds)}` : `runs of ${resolveDurationLabel(RESOLVE_BEST_MIN_SECONDS)}+`}
      />
      <Stat
        value={most ? String(most.cards) : '–'}
        label="most in a run"
        detail={most ? resolveDurationLabel(most.seconds) : ''}
      />
      <Stat
        value={recentPace === null ? '–' : resolvePaceLabel(recentPace)}
        label="per minute"
        detail={`last ${recent.length === 1 ? 'run' : `${recent.length} runs`}`}
      />
    </div>
    <ul className="flex flex-col gap-1">
      {recent.map((run) => {
        const pace = runPace(run)
        const isBest = best?.id === run.id
        return <li key={run.id} className="flex items-center gap-2 text-[12px] text-surface-200">
          <span className="w-[112px] shrink-0 truncate text-surface-400">{runWhen(run.startedAt, now)}</span>
          <span className="tabular w-[62px] shrink-0 truncate">{resolveDurationLabel(run.seconds)} · {run.cards}</span>
          <span className="h-1.5 min-w-0 flex-1 rounded-full bg-surface-800">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(4, (pace / fastest) * 100)}%`, background: isBest ? color.attention : color.positive }}
            />
          </span>
          <span className="tabular w-9 shrink-0 text-right font-semibold" style={isBest ? { color: color.attention } : undefined}>
            {resolvePaceLabel(pace)}
          </span>
        </li>
      })}
    </ul>
  </div>
}

function Setup({ onStart }: { onStart: (seconds: number) => void }): React.ReactElement {
  const { lastSeconds } = useResolve()
  const isPreset = (RESOLVE_PRESETS as readonly number[]).includes(lastSeconds)
  const [choice, setChoice] = useState(isPreset ? lastSeconds : RESOLVE_PRESETS[2])
  const [typed, setTyped] = useState(isPreset ? '' : resolveDurationLabel(lastSeconds))
  const typing = typed.trim() !== ''
  const seconds = typing ? parseResolveDuration(typed) : choice
  const start = (): void => { if (seconds !== null) onStart(seconds) }

  return <div className="flex flex-col gap-2">
    <div className="grid grid-cols-4 gap-1.5">
      {RESOLVE_PRESETS.map((preset) => {
        const on = !typing && choice === preset
        return <button
          key={preset}
          type="button"
          aria-pressed={on}
          onClick={pressed(() => {
            setChoice(preset)
            setTyped('')
          })}
          className={cn('min-h-8 rounded-lg text-[13px] font-semibold transition-colors',
            on ? 'bg-foreground text-background' : 'bg-surface-800 text-surface-200 hover:bg-surface-700')}
        >{resolveDurationLabel(preset)}</button>
      })}
    </div>
    <div className="flex gap-1.5">
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.currentTarget.blur()
          start()
        }}
        placeholder="90s, 10m, 1h 30m"
        aria-label="Any other length"
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-[14px] text-foreground outline-none placeholder:text-surface-500 focus:border-surface-400"
      />
      <button
        type="button"
        disabled={seconds === null}
        onClick={pressed(start)}
        className="flex min-h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[14px] font-bold text-background transition-opacity disabled:opacity-40"
      ><Play size={14} fill="currentColor" />Start</button>
    </div>
    {typing && seconds === null && <p className="text-[12px] text-surface-400">Try 90s, 10m, or 1h 30m, up to a day.</p>}
  </div>
}

function Running({ active }: { active: ActiveResolve }): React.ReactElement {
  const resolve = useResolve()
  const clock = useResolveClock()
  const paused = isPaused(active)
  const pace = clock.elapsed >= LIVE_PACE_AFTER_SECONDS ? resolvePace(clock.cards, clock.elapsed) : null
  const left = active.plannedSeconds > 0 ? clock.remaining / active.plannedSeconds : 0

  return <div className="flex flex-col">
    <div className="flex items-baseline gap-2">
      <span className={cn('tabular text-[34px] font-bold leading-none tracking-tight', paused ? 'text-surface-400' : 'text-foreground')}>
        {resolveClock(clock.remaining)}
      </span>
      {paused && <span className="text-[13px] font-semibold text-surface-400">Paused</span>}
    </div>
    <div className="mb-3 mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-800">
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${left * 100}%`, background: paused ? color.textFaint : color.positive }} />
    </div>
    <div className="flex items-end gap-4">
      <div>
        <p className="tabular text-[22px] font-bold leading-tight text-foreground">{clock.cards}</p>
        <p className="text-[12px] text-surface-400">{clock.cards === 1 ? 'card done' : 'cards done'}</p>
      </div>
      <div>
        <p className="tabular text-[22px] font-bold leading-tight text-foreground">{pace === null ? '–' : resolvePaceLabel(pace)}</p>
        <p className="text-[12px] text-surface-400">per minute</p>
      </div>
      <div className="ml-auto flex gap-1.5">
        <button
          type="button"
          aria-label={paused ? 'Resume' : 'Pause'}
          title={paused ? 'Resume' : 'Pause'}
          onClick={pressed(paused ? resolve.resume : resolve.pause)}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-800 text-foreground hover:bg-surface-700"
        >{paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}</button>
        <button
          type="button"
          onClick={pressed(resolve.stop)}
          className="flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-800 px-3 text-[14px] font-semibold hover:bg-surface-700"
          style={{ color: color.destructive }}
        ><Square size={12} fill="currentColor" />Stop</button>
      </div>
    </div>
  </div>
}

function Finished({ run, onAgain }: { run: ResolveRun; onAgain: () => void }): React.ReactElement {
  const resolve = useResolve()
  const record = resolveRecord(run, resolve.runs)
  const pace = runPace(run)
  const notes: string[] = []
  if (record.bestPace) {
    notes.push(record.previousBest === null ? 'Your first best pace.' : `New best pace. The last best was ${resolvePaceLabel(record.previousBest)}.`)
  }
  if (record.mostCards) notes.push('Most cards in one run.')
  if (run.seconds < RESOLVE_BEST_MIN_SECONDS) notes.push(`Runs under ${resolveDurationLabel(RESOLVE_BEST_MIN_SECONDS)} don't count toward the best pace.`)

  return <div className="flex flex-col">
    <div className="flex items-end gap-5">
      <div>
        <p className="tabular text-[26px] font-bold leading-tight text-foreground">{run.cards}</p>
        <p className="text-[12px] text-surface-400">{run.cards === 1 ? 'card' : 'cards'} in {resolveClock(run.seconds)}</p>
      </div>
      <div>
        <p className="tabular text-[26px] font-bold leading-tight text-foreground">{run.seconds > 0 ? resolvePaceLabel(pace) : '–'}</p>
        <p className="text-[12px] text-surface-400">per minute</p>
      </div>
    </div>
    {notes.length > 0 && <p className="mt-2 text-[13px] leading-snug text-surface-300">
      {record.bestPace || record.mostCards ? <span className="font-bold" style={{ color: color.attention }}>{notes[0]} </span> : `${notes[0]} `}
      {notes.slice(1).join(' ')}
    </p>}
    <div className="mt-3 flex gap-1.5">
      <button
        type="button"
        onClick={pressed(onAgain)}
        className="flex min-h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[14px] font-bold text-background"
      ><Play size={14} fill="currentColor" />Again, {resolveDurationLabel(run.plannedSeconds)}</button>
      <button
        type="button"
        onClick={pressed(resolve.dismiss)}
        className="min-h-9 rounded-lg bg-surface-800 px-3.5 text-[14px] font-semibold text-surface-200 hover:bg-surface-700"
      >Close</button>
    </div>
  </div>
}

/**
 * Focus mode's Resolve section in the top-right corner: a countdown, the cards checked off while it
 * runs, and past runs. It folds down to one button that still shows the time left.
 */
export function ResolveMode({ boardId, listId }: { boardId: string; listId: string }): React.ReactElement {
  const resolve = useResolve()
  const { active, open } = resolve
  const [showStats, setShowStats] = useState(false)
  const start = (seconds: number): void => resolve.start(boardId, listId, seconds)
  const live = active !== null && active.finished === null && !isPaused(active)
  const title = showStats ? 'Past runs' : active?.finished
    ? (active.finished.seconds >= active.plannedSeconds ? "Time's up" : 'Stopped')
    : 'Resolve mode'

  return <div className="relative ml-auto">
    <button
      type="button"
      aria-expanded={open}
      onClick={pressed(() => resolve.setOpen(!open))}
      className={cn('flex min-h-10 items-center gap-2 rounded-xl bg-surface-900 px-3 text-[14px] font-semibold text-foreground hover:bg-surface-800',
        live && 'shadow-[inset_0_0_0_1px_rgba(52,211,153,0.45)]')}
    >
      {active && isPaused(active) ? <Pause size={15} color={color.textMuted} /> : <Timer size={16} color={live ? color.positive : color.textMuted} />}
      <Summary active={active} />
      {open ? <ChevronUp size={16} color={color.textMuted} /> : <ChevronDown size={16} color={color.textMuted} />}
    </button>
    {open && <section
      aria-label="Resolve mode"
      onWheel={(event) => event.stopPropagation()}
      className={cn('absolute right-0 top-full z-30 mt-2 rounded-2xl border border-border bg-surface-900 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)]',
        showStats ? 'w-[360px]' : 'w-[300px]')}
    >
      <div className="mb-2.5 flex items-center gap-1">
        {showStats && <button
          type="button"
          aria-label="Back"
          onClick={pressed(() => setShowStats(false))}
          className="-ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-surface-300 hover:bg-surface-800"
        ><ArrowLeft size={16} /></button>}
        <h2 className="flex-1 text-[14px] font-semibold text-surface-200">{title}</h2>
        {!showStats && <button
          type="button"
          aria-label="Past runs"
          title="Past runs"
          onClick={pressed(() => {
            setShowStats(true)
            resolve.refresh()
          })}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-800 text-surface-300 hover:text-foreground"
        ><ChartColumn size={15} /></button>}
        <button
          type="button"
          aria-label="Fold Resolve mode away"
          title="Fold away"
          onClick={pressed(() => resolve.setOpen(false))}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-800 text-surface-300 hover:text-foreground"
        ><ChevronUp size={15} /></button>
      </div>
      {showStats
        ? <Stats runs={resolve.runs} />
        : active?.finished
          ? <Finished run={active.finished} onAgain={() => start(active.plannedSeconds)} />
          : active
            ? <Running active={active} />
            : <Setup onStart={start} />}
    </section>}
  </div>
}
