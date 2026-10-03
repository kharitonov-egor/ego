import React, { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { HabitRecord } from '@ego/api-contracts'
import {
  HABIT_ICON_LIMIT, HABIT_NAME_LIMIT, HABIT_TARGET_LIMIT, isHabitInput,
  type HabitInput, type HabitKind, type HabitPeriod
} from '@ego/core'
import { isoFromParts } from '@ego/local/dates'
import { momentLabel, runSpoken, twoDigits } from '@ego/local/habits/format'
import { quitClock, quitStart } from '@ego/local/habits/stats'
import { useHabits, type EditorTarget } from '../../lib/habits/context'
import { cn } from '../../lib/utils'
import { Label } from '../common'
import { DateField } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { HabitIcon } from './ui'

const EMOJI: Record<HabitKind, readonly string[]> = {
  build: [
    '✅', '📚', '✍️', '🏃', '🚶', '🏋️', '🧘', '🚴', '🏊', '💧', '🥗', '🍎', '💊', '😴', '🌅', '🧠',
    '🎯', '💻', '🎸', '🎨', '🧹', '🌱', '🐕', '🙏', '💰', '🦷', '🚿', '📞', '❤️', '☀️', '📵', '🧴'
  ],
  break: [
    '🚫', '🚬', '🍺', '🍷', '🥃', '🍔', '🍟', '🍩', '🍫', '🍭', '🥤', '☕', '📱', '🎮', '📺', '🛒',
    '💸', '🎰', '💅', '😡', '🛌', '🌙'
  ]
}

const PLACEHOLDER: Record<HabitKind, string> = { build: 'Read 20 pages', break: 'Smoking' }
const PERIODS = [{ value: 'day', label: 'Per day' }, { value: 'week', label: 'Per week' }] as const
const MERIDIEMS = [{ value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }] as const
const RESTART_PAGE = 20
const MINUTE = 60 * 1000

interface ClockTime {
  date: string
  hour: string
  minute: string
  meridiem: 'am' | 'pm'
}

/** The Windows emoji panel sends one symbol at a time; a paste keeps only its first. */
function typedSymbol(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.length <= HABIT_ICON_LIMIT ? trimmed : Array.from(trimmed)[0] ?? null
}

function EmojiPicker({ kind, value, onChange }: { kind: HabitKind; value: string; onChange: (icon: string) => void }): React.ReactElement {
  const options = EMOJI[kind].includes(value) ? EMOJI[kind] : [value, ...EMOJI[kind]]
  return <>
    <div className="flex flex-wrap gap-2">
      {options.map((emoji) => {
        const selected = emoji === value
        return <button
          key={emoji}
          type="button"
          aria-label={`Use ${emoji}`}
          aria-pressed={selected}
          onClick={() => onChange(emoji)}
          className={cn('flex h-12 w-12 items-center justify-center rounded-xl transition-colors',
            selected ? 'border-2 border-primary bg-surface-800' : 'border border-input bg-surface-900 hover:bg-surface-800 active:bg-surface-800')}
        ><span aria-hidden className="text-[24px] leading-none text-foreground">{emoji}</span></button>
      })}
    </div>
    <input
      value=""
      onChange={(event) => {
        const symbol = typedSymbol(event.target.value)
        if (symbol) onChange(symbol)
      }}
      aria-label="Type any emoji"
      placeholder="Or type any emoji (Windows key + period)"
      autoComplete="off"
      spellCheck={false}
      className={cn(inputClass, 'mt-3')}
    />
  </>
}

function frequencyLabel(period: HabitPeriod, target: number): string {
  if (period === 'week') return target === 1 ? '1 day a week' : `${target} days a week`
  return target === 1 ? 'Once a day' : target === 2 ? 'Twice a day' : `${target} times a day`
}

function Frequency({ period, target, onChange }: {
  period: HabitPeriod
  target: number
  onChange: (period: HabitPeriod, target: number) => void
}): React.ReactElement {
  return <>
    <SegmentedControl
      options={PERIODS}
      value={period}
      onValueChange={(next) => onChange(next, Math.min(target, HABIT_TARGET_LIMIT[next]))}
    />
    <div className="mt-3 flex items-center rounded-xl border border-input bg-surface-900 p-1">
      <Button variant="ghost" size="icon" aria-label="Fewer" disabled={target <= 1} onClick={() => onChange(period, target - 1)}>
        <Minus color="#fafafa" size={20} />
      </Button>
      <span aria-live="polite" className="flex-1 text-center text-[17px] font-semibold text-foreground">{frequencyLabel(period, target)}</span>
      <Button variant="ghost" size="icon" aria-label="More" disabled={target >= HABIT_TARGET_LIMIT[period]} onClick={() => onChange(period, target + 1)}>
        <Plus color="#fafafa" size={20} />
      </Button>
    </div>
    {period === 'week' && <p className="mt-2 text-[14px] leading-5 text-muted-foreground">
      Any days from Monday to Sunday. It shows every day until the week is done.
    </p>}
  </>
}

function clockTimeOf(milliseconds: number): ClockTime {
  const moment = new Date(milliseconds)
  const hours = moment.getHours()
  return {
    date: isoFromParts(moment.getFullYear(), moment.getMonth(), moment.getDate()),
    hour: String(hours % 12 || 12),
    minute: twoDigits(moment.getMinutes()),
    meridiem: hours >= 12 ? 'pm' : 'am'
  }
}

function momentOf(time: ClockTime): number | null {
  if (!/^\d{1,2}$/.test(time.hour) || !/^\d{1,2}$/.test(time.minute)) return null
  const hour = Number(time.hour)
  const minute = Number(time.minute)
  if (hour < 1 || hour > 12 || minute > 59) return null
  const [year, month, day] = time.date.split('-').map(Number)
  return new Date(year, month - 1, day, (hour % 12) + (time.meridiem === 'pm' ? 12 : 0), minute).getTime()
}

function QuitMoment({ time, onChange }: { time: ClockTime; onChange: (time: ClockTime) => void }): React.ReactElement {
  const digits = (text: string): string => text.replace(/\D/g, '')
  return <>
    <DateField label="Quit on" value={time.date} onChange={(date) => onChange({ ...time, date })} />
    <div className="mt-3 flex items-center gap-2">
      <input
        value={time.hour}
        onChange={(event) => onChange({ ...time, hour: digits(event.target.value) })}
        onFocus={(event) => event.target.select()}
        aria-label="Hour"
        inputMode="numeric"
        maxLength={2}
        className={cn(inputClass, 'tabular w-16 text-center')}
      />
      <span className="text-[20px] font-bold text-foreground">:</span>
      <input
        value={time.minute}
        onChange={(event) => onChange({ ...time, minute: digits(event.target.value) })}
        onFocus={(event) => event.target.select()}
        aria-label="Minute"
        inputMode="numeric"
        maxLength={2}
        className={cn(inputClass, 'tabular w-16 text-center')}
      />
      <SegmentedControl options={MERIDIEMS} value={time.meridiem} onValueChange={(meridiem) => onChange({ ...time, meridiem })} className="ml-1 flex-1" />
    </div>
  </>
}

function Restart({ habit, onDone }: { habit: HabitRecord; onDone: () => void }): React.ReactElement {
  const habits = useHabits()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return <Button variant="outline" className="mt-3 w-full" disabled={habits.busy} onClick={() => setConfirming(true)}>
      <RotateCcw color="#fafafa" size={17} />Restart the clock
    </Button>
  }
  const running = Date.now() - quitClock(habit, habits.log).since
  return <div className="mt-3 rounded-2xl border border-border bg-surface-900 p-4">
    <p className="text-[17px] font-semibold text-foreground">Restart the clock?</p>
    <p className="mt-1 text-[15px] leading-5 text-muted-foreground">{`This run of ${runSpoken(running)} ends now. Best run keeps it.`}</p>
    <div className="mt-4 flex gap-3">
      <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Cancel</Button>
      <Button className="flex-1" disabled={habits.busy} onClick={() => void habits.restart(habit).then((saved) => { if (saved) onDone() })}>
        Restart
      </Button>
    </div>
  </div>
}

function Restarts({ habit }: { habit: HabitRecord }): React.ReactElement {
  const habits = useHabits()
  const [shown, setShown] = useState(RESTART_PAGE)
  const restarts = [...(habits.log.slips.get(habit.id) ?? [])].reverse()
  return <div className="mt-6">
    <h3 className="mb-2 text-[15px] font-medium text-surface-200">Restarts</h3>
    {restarts.length === 0
      ? <p className="text-[15px] text-muted-foreground">No restarts yet.</p>
      : <div className="overflow-hidden rounded-2xl border border-border">
        {restarts.slice(0, shown).map((restart, index) => {
          const when = momentLabel(Date.parse(restart.loggedAt ?? restart.createdAt))
          return <div key={restart.id} className={cn('flex min-h-12 items-center pl-4', index > 0 && 'border-t border-border')}>
            <RotateCcw color="#a3a3a3" size={15} />
            <span className="tabular ml-3 flex-1 text-[15px] text-foreground">{when}</span>
            <button
              type="button"
              aria-label={`Remove the restart on ${when}`}
              title="Remove"
              onClick={() => void habits.removeEntry(restart.id)}
              className="flex h-12 w-12 items-center justify-center hover:bg-surface-800 active:bg-surface-800"
            ><X color="#737373" size={17} /></button>
          </div>
        })}
        {restarts.length > shown && <button
          type="button"
          onClick={() => setShown((count) => count + RESTART_PAGE)}
          className="flex min-h-12 w-full items-center justify-center border-t border-border text-[15px] font-semibold text-foreground hover:bg-surface-900 active:bg-surface-900"
        >Show older</button>}
      </div>}
  </div>
}

/** Mounted fresh for each opening, so the draft always starts from the saved habit. */
function HabitForm({ target }: { target: EditorTarget }): React.ReactElement {
  const habits = useHabits()
  const { kind } = target
  const siblings = (habits.habits ?? []).filter((item) => item.kind === kind)
  const habit = target.habit ? siblings.find((item) => item.id === target.habit?.id) ?? target.habit : null
  const index = habit ? siblings.findIndex((item) => item.id === habit.id) : -1
  const [name, setName] = useState(habit?.name ?? '')
  const [icon, setIcon] = useState(habit?.icon ?? EMOJI[kind][0])
  const [startDate, setStartDate] = useState(habit?.startDate ?? habits.today)
  const [period, setPeriod] = useState<HabitPeriod>(habit?.period ?? 'day')
  const [goal, setGoal] = useState(habit?.target ?? 1)
  const [shownQuit] = useState(() => clockTimeOf(habit ? quitStart(habit) : Date.now()))
  /** Null until the quit is edited, so an untouched one keeps its exact moment, seconds and all. */
  const [quit, setQuit] = useState<ClockTime | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const position = habit ? habit.position : siblings.reduce((next, item) => Math.max(next, item.position + 1), 0)
  const quitMoment = quit ? momentOf(quit) : null
  const quitChanged = quit !== null && (!habit || quitMoment === null ||
    Math.floor(quitMoment / MINUTE) !== Math.floor(quitStart(habit) / MINUTE))

  const inputAt = (now: number): HabitInput => {
    if (kind === 'build') return { name, icon, kind, startDate, position, target: goal, period, startedAt: null }
    const startedAt = quitChanged && quitMoment !== null ? new Date(quitMoment).toISOString()
      : habit ? habit.startedAt : new Date(now).toISOString()
    return { name, icon, kind, startDate: (quit ?? shownQuit).date, position, target: 1, period: 'day', startedAt }
  }
  const problem = kind === 'build'
    ? startDate > habits.today ? 'Pick today or an earlier day.' : null
    : quit !== null && quitMoment === null ? 'Enter a time like 9:30.'
      : quitMoment !== null && quitMoment > Date.now() ? 'Pick a moment that has already passed.' : null
  const dirty = !habit || name.trim() !== habit.name || icon !== habit.icon || (kind === 'build'
    ? startDate !== habit.startDate || goal !== habit.target || period !== habit.period
    : quitChanged)
  const canSave = isHabitInput(inputAt(Date.now())) && problem === null && dirty && !habits.busy

  const save = async (): Promise<void> => {
    if (await habits.save(inputAt(Date.now()), habit)) habits.closeEditor()
  }
  const remove = async (): Promise<void> => {
    if (habit && await habits.remove(habit)) habits.closeEditor()
  }

  return <form
    noValidate
    onSubmit={(event) => {
      event.preventDefault()
      if (canSave) void save()
    }}
  >
    <div className="mb-6 flex flex-col items-center">
      <HabitIcon icon={icon} size={76} />
      <p className={cn('mt-3 max-w-full truncate text-[20px] font-bold', name.trim() ? 'text-foreground' : 'text-surface-500')}>{name.trim() || PLACEHOLDER[kind]}</p>
    </div>
    <Label text="Name" htmlFor="habit-name">
      <input
        id="habit-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={PLACEHOLDER[kind]}
        maxLength={HABIT_NAME_LIMIT}
        autoComplete="off"
        className={inputClass}
      />
    </Label>
    <Label text="Emoji"><EmojiPicker kind={kind} value={icon} onChange={setIcon} /></Label>
    {kind === 'build'
      ? <>
        <Label text="How often">
          <Frequency period={period} target={goal} onChange={(nextPeriod, nextGoal) => { setPeriod(nextPeriod); setGoal(nextGoal) }} />
        </Label>
        <Label text="Counts from">
          <DateField label="Counts from" value={startDate} onChange={setStartDate} />
        </Label>
      </>
      : <Label text="Quit on">
        <QuitMoment time={quit ?? shownQuit} onChange={setQuit} />
      </Label>}
    {problem && <p className="-mt-3 mb-4 text-[14px] text-attention">{problem}</p>}
    <Button type="submit" size="lg" disabled={!canSave} className="w-full">
      {habit ? 'Save changes' : 'Add habit'}
    </Button>
    {habit && <>
      {siblings.length > 1 && <div className="mt-3 flex gap-3">
        <Button variant="outline" className="flex-1" disabled={index <= 0 || habits.busy} onClick={() => void habits.move(habit, -1)}>
          <ArrowUp color="#fafafa" size={17} />Move up
        </Button>
        <Button variant="outline" className="flex-1" disabled={index >= siblings.length - 1 || habits.busy} onClick={() => void habits.move(habit, 1)}>
          <ArrowDown color="#fafafa" size={17} />Move down
        </Button>
      </div>}
      {kind === 'break' && <>
        <Restart habit={habit} onDone={habits.closeEditor} />
        <Restarts habit={habit} />
      </>}
      {confirmingDelete
        ? <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-[17px] font-semibold text-foreground">{`Delete ${habit.name}?`}</p>
          <p className="mt-1 text-[15px] leading-5 text-muted-foreground">Its history goes with it, on every device.</p>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" className="flex-1" disabled={habits.busy} onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" disabled={habits.busy} onClick={() => void remove()}>Delete</Button>
          </div>
        </div>
        : <Button variant="ghost" className="mt-4 w-full text-destructive" disabled={habits.busy} onClick={() => setConfirmingDelete(true)}>
          <Trash2 color="#fb7185" size={17} />Delete habit
        </Button>}
    </>}
  </form>
}

export function HabitEditorHost(): React.ReactElement {
  const habits = useHabits()
  const target = habits.editor
  const title = target?.habit ? 'Edit habit' : target?.kind === 'break' ? 'New habit to break' : 'New habit'
  return <Sheet visible={target !== null} title={title} onClose={habits.closeEditor}>
    {target && <HabitForm target={target} />}
  </Sheet>
}
