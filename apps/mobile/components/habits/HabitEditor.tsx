import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { ArrowDown, ArrowUp, Hand, Trash2, X } from 'lucide-react-native'
import type { HabitRecord } from '@ego/api-contracts'
import { HABIT_ICON_LIMIT, HABIT_NAME_LIMIT, isHabitInput, type HabitInput, type HabitKind } from '@ego/core'
import { formatIso } from '../../lib/dates'
import { useHabits, type EditorTarget } from '../../lib/habits/context'
import { BottomSheet, Label, inputClass } from '../money/Common'
import { DateField } from '../money/DatePicker'
import { Button } from '../ui/button'
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
const HISTORY_PAGE = 20

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

function History({ habit }: { habit: HabitRecord }): React.ReactElement {
  const habits = useHabits()
  const [shown, setShown] = useState(HISTORY_PAGE)
  const [pastDay, setPastDay] = useState(habits.today)
  const events = [...(habits.log.events.get(habit.id) ?? [])].reverse()
  return <View className="mt-6">
    <Text accessibilityRole="header" className="mb-2 text-[15px] font-medium text-surface-200">History</Text>
    {events.length === 0
      ? <Text className="text-[15px] text-muted-foreground">Nothing logged yet.</Text>
      : <View className="overflow-hidden rounded-2xl border border-border">
        {events.slice(0, shown).map((event, index) => <View key={event.id} className={`min-h-12 flex-row items-center pl-4 ${index > 0 ? 'border-t border-border' : ''}`}>
          {event.kind === 'resisted' ? <Hand color="#a3a3a3" size={16} /> : <View className="h-2 w-2 rounded-full bg-destructive" />}
          <Text className="ml-3 flex-1 text-[15px] text-foreground">{event.kind === 'resisted' ? 'Resisted' : 'Slipped'}</Text>
          <Text className="text-[14px] text-muted-foreground">{formatIso(event.date)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${event.kind === 'resisted' ? 'resisted urge' : 'slip'} on ${formatIso(event.date)}`}
            onPress={() => void habits.removeEntry(event.id)}
            hitSlop={4}
            className="h-12 w-12 items-center justify-center active:bg-surface-800"
          ><X color="#737373" size={17} /></Pressable>
        </View>)}
        {events.length > shown && <Pressable accessibilityRole="button" onPress={() => setShown((count) => count + HISTORY_PAGE)} className="min-h-12 items-center justify-center border-t border-border active:bg-surface-900">
          <Text className="text-[15px] font-semibold text-foreground">Show older</Text>
        </Pressable>}
      </View>}
    <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">Log a past day</Text>
    <DateField label="Day to log" value={pastDay} onChange={setPastDay} />
    {pastDay > habits.today && <Text className="mt-2 text-[14px] text-attention">Pick today or an earlier day.</Text>}
    <View className="mt-3 flex-row gap-3">
      <Button variant="secondary" className="flex-1" disabled={pastDay > habits.today} onPress={() => void habits.record(habit, 'resisted', pastDay)}>
        <UiText>Resisted</UiText>
      </Button>
      <Button variant="secondary" className="flex-1" disabled={pastDay > habits.today} onPress={() => void habits.record(habit, 'slipped', pastDay)}>
        <UiText>Slipped</UiText>
      </Button>
    </View>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const input: HabitInput = {
    name, icon, kind, startDate,
    position: habit ? habit.position : siblings.reduce((next, item) => Math.max(next, item.position + 1), 0)
  }
  const futureStart = startDate > habits.today
  const dirty = !habit || name.trim() !== habit.name || icon !== habit.icon || startDate !== habit.startDate
  const canSave = isHabitInput(input) && !futureStart && dirty && !habits.busy

  const save = async (): Promise<void> => {
    if (await habits.save(input, habit)) habits.closeEditor()
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
    <Label text={kind === 'build' ? 'Counts from' : 'Clean since'}>
      <DateField label={kind === 'build' ? 'Counts from' : 'Clean since'} value={startDate} onChange={setStartDate} />
      {futureStart && <Text className="mt-2 text-[14px] text-attention">Pick today or an earlier day.</Text>}
    </Label>
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
      {kind === 'break' && <History habit={habit} />}
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
