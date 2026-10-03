import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { ArrowDown, ArrowUp, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react-native'
import type { HabitRecord } from '@ego/api-contracts'
import {
  HABIT_ICON_LIMIT, HABIT_NAME_LIMIT, HABIT_TARGET_LIMIT, isHabitInput,
  type HabitInput, type HabitKind, type HabitPeriod
} from '@ego/core'
import { isoFromParts } from '@ego/local/dates'
import { useHabits, type EditorTarget } from '../../lib/habits/context'
import { momentLabel, runSpoken, twoDigits } from '@ego/local/habits/format'
import { quitClock, quitStart } from '@ego/local/habits/stats'
import { BottomSheet, Label, inputClass } from '../money/Common'
import { DateField } from '../money/DatePicker'
import { Button } from '../ui/button'
import { SegmentedControl } from '../ui/segmented-control'
import { Text as UiText } from '../ui/text'
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

/** The keyboard's emoji key sends one symbol at a time; a paste keeps only its first. */
function typedSymbol(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.length <= HABIT_ICON_LIMIT ? trimmed : Array.from(trimmed)[0] ?? null
}

function EmojiPicker({ kind, value, onChange }: { kind: HabitKind; value: string; onChange: (icon: string) => void }): React.ReactElement {
  const options = EMOJI[kind].includes(value) ? EMOJI[kind] : [value, ...EMOJI[kind]]
  return <>
    <View className="flex-row flex-wrap gap-2">
      {options.map((emoji) => {
        const selected = emoji === value
        return <Pressable
          key={emoji}
          accessibilityRole="button"
          accessibilityLabel={`Use ${emoji}`}
          accessibilityState={{ selected }}
          onPress={() => onChange(emoji)}
          className={`h-12 w-12 items-center justify-center rounded-xl ${selected ? 'border-2 border-primary bg-surface-800' : 'border border-input bg-surface-900 active:bg-surface-800'}`}
        ><Text style={{ fontSize: 24, color: '#fafafa' }}>{emoji}</Text></Pressable>
      })}
    </View>
    <TextInput
      value=""
      onChangeText={(text) => {
        const symbol = typedSymbol(text)
        if (symbol) onChange(symbol)
      }}
      accessibilityLabel="Type any emoji"
      placeholder="Or type any emoji"
      placeholderTextColor="#737373"
      autoCorrect={false}
      className={`${inputClass} mt-3`}
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
    <View className="mt-3 flex-row items-center rounded-xl border border-input bg-surface-900 p-1">
      <Button variant="ghost" size="icon" accessibilityLabel="Fewer" disabled={target <= 1} onPress={() => onChange(period, target - 1)}>
        <Minus color="#fafafa" size={20} />
      </Button>
      <Text accessibilityLiveRegion="polite" className="flex-1 text-center text-[17px] font-semibold text-foreground">{frequencyLabel(period, target)}</Text>
      <Button variant="ghost" size="icon" accessibilityLabel="More" disabled={target >= HABIT_TARGET_LIMIT[period]} onPress={() => onChange(period, target + 1)}>
        <Plus color="#fafafa" size={20} />
      </Button>
    </View>
    {period === 'week' && <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">
      Any days from Monday to Sunday. It shows every day until the week is done.
    </Text>}
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
    <View className="mt-3 flex-row items-center gap-2">
      <TextInput
        value={time.hour}
        onChangeText={(hour) => onChange({ ...time, hour: digits(hour) })}
        accessibilityLabel="Hour"
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        className={`${inputClass} w-16 text-center`}
      />
      <Text className="text-[20px] font-bold text-foreground">:</Text>
      <TextInput
        value={time.minute}
        onChangeText={(minute) => onChange({ ...time, minute: digits(minute) })}
        accessibilityLabel="Minute"
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        className={`${inputClass} w-16 text-center`}
      />
      <SegmentedControl options={MERIDIEMS} value={time.meridiem} onValueChange={(meridiem) => onChange({ ...time, meridiem })} className="ml-1 flex-1" />
    </View>
  </>
}

function Restart({ habit, onDone }: { habit: HabitRecord; onDone: () => void }): React.ReactElement {
  const habits = useHabits()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return <Button variant="outline" className="mt-3" disabled={habits.busy} onPress={() => setConfirming(true)}>
      <RotateCcw color="#fafafa" size={17} /><UiText>Restart the clock</UiText>
    </Button>
  }
  const running = Date.now() - quitClock(habit, habits.log).since
  return <View className="mt-3 rounded-2xl border border-border bg-surface-900 p-4">
    <Text className="text-[17px] font-semibold text-foreground">Restart the clock?</Text>
    <Text className="mt-1 text-[15px] leading-5 text-muted-foreground">{`This run of ${runSpoken(running)} ends now. Best run keeps it.`}</Text>
    <View className="mt-4 flex-row gap-3">
      <Button variant="outline" className="flex-1" onPress={() => setConfirming(false)}><UiText>Cancel</UiText></Button>
      <Button className="flex-1" disabled={habits.busy} onPress={() => void habits.restart(habit).then((saved) => { if (saved) onDone() })}>
        <UiText>Restart</UiText>
      </Button>
    </View>
  </View>
}

function Restarts({ habit }: { habit: HabitRecord }): React.ReactElement {
  const habits = useHabits()
  const [shown, setShown] = useState(RESTART_PAGE)
  const restarts = [...(habits.log.slips.get(habit.id) ?? [])].reverse()
  return <View className="mt-6">
    <Text accessibilityRole="header" className="mb-2 text-[15px] font-medium text-surface-200">Restarts</Text>
    {restarts.length === 0
      ? <Text className="text-[15px] text-muted-foreground">No restarts yet.</Text>
      : <View className="overflow-hidden rounded-2xl border border-border">
        {restarts.slice(0, shown).map((restart, index) => {
          const when = momentLabel(Date.parse(restart.loggedAt ?? restart.createdAt))
          return <View key={restart.id} className={`min-h-12 flex-row items-center pl-4 ${index > 0 ? 'border-t border-border' : ''}`}>
            <RotateCcw color="#a3a3a3" size={15} />
            <Text className="ml-3 flex-1 text-[15px] text-foreground">{when}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove the restart on ${when}`}
              onPress={() => void habits.removeEntry(restart.id)}
              hitSlop={4}
              className="h-12 w-12 items-center justify-center active:bg-surface-800"
            ><X color="#737373" size={17} /></Pressable>
          </View>
        })}
        {restarts.length > shown && <Pressable accessibilityRole="button" onPress={() => setShown((count) => count + RESTART_PAGE)} className="min-h-12 items-center justify-center border-t border-border active:bg-surface-900">
          <Text className="text-[15px] font-semibold text-foreground">Show older</Text>
        </Pressable>}
      </View>}
  </View>
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

  return <View>
    <View className="mb-6 items-center">
      <HabitIcon icon={icon} size={76} />
      <Text numberOfLines={1} className={`mt-3 text-[20px] font-bold ${name.trim() ? 'text-foreground' : 'text-surface-500'}`}>{name.trim() || PLACEHOLDER[kind]}</Text>
    </View>
    <Label text="Name">
      <TextInput
        value={name}
        onChangeText={setName}
        accessibilityLabel="Habit name"
        placeholder={PLACEHOLDER[kind]}
        placeholderTextColor="#737373"
        maxLength={HABIT_NAME_LIMIT}
        returnKeyType="done"
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
    {problem && <Text className="-mt-3 mb-4 text-[14px] text-attention">{problem}</Text>}
    <Button size="lg" disabled={!canSave} onPress={() => void save()}>
      <UiText>{habit ? 'Save changes' : 'Add habit'}</UiText>
    </Button>
    {habit && <>
      {siblings.length > 1 && <View className="mt-3 flex-row gap-3">
        <Button variant="outline" className="flex-1" disabled={index <= 0 || habits.busy} onPress={() => void habits.move(habit, -1)}>
          <ArrowUp color="#fafafa" size={17} /><UiText>Move up</UiText>
        </Button>
        <Button variant="outline" className="flex-1" disabled={index >= siblings.length - 1 || habits.busy} onPress={() => void habits.move(habit, 1)}>
          <ArrowDown color="#fafafa" size={17} /><UiText>Move down</UiText>
        </Button>
      </View>}
      {kind === 'break' && <>
        <Restart habit={habit} onDone={habits.closeEditor} />
        <Restarts habit={habit} />
      </>}
      {confirmingDelete
        ? <View className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <Text className="text-[17px] font-semibold text-foreground">{`Delete ${habit.name}?`}</Text>
          <Text className="mt-1 text-[15px] leading-5 text-muted-foreground">Its history goes with it, on every device.</Text>
          <View className="mt-4 flex-row gap-3">
            <Button variant="outline" className="flex-1" disabled={habits.busy} onPress={() => setConfirmingDelete(false)}><UiText>Cancel</UiText></Button>
            <Button variant="destructive" className="flex-1" disabled={habits.busy} onPress={() => void remove()}><UiText>Delete</UiText></Button>
          </View>
        </View>
        : <Button variant="ghost" className="mt-4" disabled={habits.busy} onPress={() => setConfirmingDelete(true)}>
          <Trash2 color="#fb7185" size={17} />
          <UiText className="text-destructive">Delete habit</UiText>
        </Button>}
    </>}
  </View>
}

export function HabitEditorHost(): React.ReactElement {
  const habits = useHabits()
  const target = habits.editor
  const title = target?.habit ? 'Edit habit' : target?.kind === 'break' ? 'New habit to break' : 'New habit'
  return <BottomSheet visible={target !== null} title={title} onClose={habits.closeEditor}>
    {target && <HabitForm target={target} />}
  </BottomSheet>
}
