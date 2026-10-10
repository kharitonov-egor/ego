import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import { BellRing, CalendarDays, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react-native'
import type { TaskCardRecord } from '@ego/api-contracts'
import {
  TASK_DATE_ONLY_REMINDERS, TASK_LABEL_COLORS, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_REMINDERS,
  defaultTaskReminder, taskReminderLabel,
  type TaskLabelColor, type TaskPriority, type TaskReminder
} from '@ego/core'
import { formatIso, isoToday, shiftIso } from '@ego/local/dates'
import { EOD, boardLabels, boardLists, liveBoards, type CardFilter, type DueFilter, NO_FILTER } from '@ego/local/tasks/board'
import { useTasks } from '../../lib/tasks/context'
import { useTaskNotifications } from '../../lib/tasks/notifications'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { color } from '../money/tokens'
import { Button } from '../ui/button'
import { SegmentedControl } from '../ui/segmented-control'
import { Text as UiText } from '../ui/text'
import { LABEL_COLORS, LABEL_COLOR_NAMES, LabelChip, PriorityIcon } from './ui'

const BOARD_EMOJI = ['📋', '🏠', '💼', '🎓', '💪', '💡', '🛒', '✈️', '💰', '🎯', '📚', '🧰']

function typedSymbol(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.length <= 16 ? trimmed : Array.from(trimmed)[0] ?? null
}

function Option({ selected, onPress, label, children }: {
  selected: boolean
  onPress: () => void
  label: string
  children?: React.ReactNode
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={label}
    onPress={onPress}
    className={`min-h-11 flex-row items-center justify-center gap-2 rounded-xl border px-3.5 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    {children}
    <Text className={`text-[15px] font-semibold ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</Text>
  </Pressable>
}

function Heading({ children }: { children: string }): React.ReactElement {
  return <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">{children}</Text>
}

/** A new board, or a board's name and emoji. Sheets reuse it for theirs. */
export function BoardSheet({ visible, title, name: initialName, icon: initialIcon, confirm, placeholder = 'Board name', onSave, onClose }: {
  visible: boolean
  title: string
  name: string
  icon: string
  confirm: string
  placeholder?: string
  onSave: (name: string, icon: string) => void
  onClose: () => void
}): React.ReactElement {
  const [name, setName] = useState(initialName)
  const [icon, setIcon] = useState(initialIcon)
  useEffect(() => {
    if (!visible) return
    setName(initialName)
    setIcon(initialIcon)
  }, [initialIcon, initialName, visible])
  const options = icon === '' || BOARD_EMOJI.includes(icon) ? BOARD_EMOJI : [icon, ...BOARD_EMOJI]
  return <BottomSheet visible={visible} title={title} onClose={onClose}>
    <TextInput
      value={name}
      onChangeText={setName}
      placeholder={placeholder}
      placeholderTextColor="#737373"
      accessibilityLabel={placeholder}
      autoFocus={initialName === ''}
      maxLength={120}
      className={inputClass}
    />
    <Heading>Emoji</Heading>
    <View className="flex-row flex-wrap gap-2">
      {options.map((emoji) => {
        const selected = emoji === icon
        return <Pressable
          key={emoji}
          accessibilityRole="button"
          accessibilityLabel={`Use ${emoji}`}
          accessibilityState={{ selected }}
          onPress={() => setIcon(selected ? '' : emoji)}
          className={`h-12 w-12 items-center justify-center rounded-xl ${selected ? 'border-2 border-primary bg-surface-800' : 'border border-input bg-surface-900 active:bg-surface-800'}`}
        ><Text style={{ fontSize: 24, color: '#fafafa' }}>{emoji}</Text></Pressable>
      })}
    </View>
    <TextInput
      value=""
      onChangeText={(text) => {
        const symbol = typedSymbol(text)
        if (symbol) setIcon(symbol)
      }}
      accessibilityLabel="Type any emoji"
      placeholder="Or type any emoji"
      placeholderTextColor="#737373"
      autoCorrect={false}
      className={`${inputClass} mt-3`}
    />
    <Button size="lg" className="mt-5" disabled={name.trim() === ''} onPress={() => onSave(name, icon)}><UiText>{confirm}</UiText></Button>
  </BottomSheet>
}

/** One line of text: a list's name, a checklist's title, a new list. */
export function TextSheet({ visible, title, value, placeholder, confirm, onSave, onClose }: {
  visible: boolean
  title: string
  value: string
  placeholder: string
  confirm: string
  onSave: (text: string) => void
  onClose: () => void
}): React.ReactElement {
  const [text, setText] = useState(value)
  useEffect(() => { if (visible) setText(value) }, [value, visible])
  return <BottomSheet visible={visible} title={title} onClose={onClose}>
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor="#737373"
      accessibilityLabel={placeholder}
      autoFocus
      maxLength={120}
      onSubmitEditing={() => { if (text.trim()) onSave(text) }}
      returnKeyType="done"
      className={inputClass}
    />
    <Button size="lg" className="mt-4" disabled={text.trim() === ''} onPress={() => onSave(text)}><UiText>{confirm}</UiText></Button>
  </BottomSheet>
}

function LabelEditor({ boardId, labelId, onDone }: { boardId: string; labelId: string | null; onDone: () => void }): React.ReactElement {
  const tasks = useTasks()
  const existing = labelId ? tasks.data?.labels.find((label) => label.id === labelId) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [tint, setTint] = useState<TaskLabelColor>(existing?.color ?? 'green')
  const [deleting, setDeleting] = useState(false)
  return <View className="rounded-2xl border border-surface-800 bg-surface-900 p-4">
    <View className="items-start">
      <LabelChip size="large" label={{ id: 'preview', boardId, name: name.trim(), color: tint, position: 0, createdAt: '', updatedAt: '', revision: 1 }} />
    </View>
    <TextInput
      value={name}
      onChangeText={setName}
      placeholder="Name, or leave empty for a color only"
      placeholderTextColor="#737373"
      accessibilityLabel="Label name"
      maxLength={40}
      className={`${inputClass} mt-3`}
    />
    <View className="mt-3 flex-row flex-wrap gap-2">
      {TASK_LABEL_COLORS.map((item) => <Pressable
        key={item}
        accessibilityRole="button"
        accessibilityLabel={LABEL_COLOR_NAMES[item]}
        accessibilityState={{ selected: item === tint }}
        onPress={() => setTint(item)}
        className="h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: LABEL_COLORS[item], borderWidth: item === tint ? 2 : 0, borderColor: '#fafafa' }}
      >{item === tint && <Check color="#fafafa" size={18} strokeWidth={3} />}</Pressable>)}
    </View>
    {deleting
      ? <View className="mt-4">
        <Text className="text-[15px] leading-5 text-muted-foreground">Delete this label? It comes off every card on the board.</Text>
        <View className="mt-3 flex-row gap-3">
          <Button variant="outline" className="flex-1" onPress={() => setDeleting(false)}><UiText>Keep</UiText></Button>
          <Button variant="destructive" className="flex-1" onPress={() => {
            if (labelId) void tasks.deleteLabel(labelId)
            onDone()
          }}><UiText>Delete</UiText></Button>
        </View>
      </View>
      : <View className="mt-4 flex-row gap-3">
        {existing && <Button variant="outline" size="icon" accessibilityLabel="Delete label" onPress={() => setDeleting(true)}>
          <Trash2 color={color.destructive} size={18} />
        </Button>}
        <Button variant="outline" className="flex-1" onPress={onDone}><UiText>Cancel</UiText></Button>
        <Button className="flex-1" onPress={() => {
          void tasks.saveLabel(boardId, labelId, name, tint)
          onDone()
        }}><UiText>{existing ? 'Save' : 'Create'}</UiText></Button>
      </View>}
  </View>
}

/**
 * The board's labels. With `selected`, a tap puts a label on the card or takes it off; either way
 * the pencil edits a label and the button below makes a new one.
 */
export function LabelSheet({ visible, boardId, selected, onToggle, onClose }: {
  visible: boolean
  boardId: string
  selected?: readonly string[]
  onToggle?: (labelId: string) => void
  onClose: () => void
}): React.ReactElement {
  const tasks = useTasks()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  useEffect(() => { if (!visible) setEditing(null) }, [visible])
  const labels = tasks.data ? boardLabels(tasks.data, boardId) : []
  return <BottomSheet visible={visible} title="Labels" onClose={onClose}>
    {labels.length === 0 && editing === null && <Text className="text-[15px] leading-5 text-muted-foreground">
      This board has no labels yet. Labels belong to a board and can go on any of its cards.
    </Text>}
    {labels.map((label) => editing === label.id
      ? <View key={label.id} className="mb-2"><LabelEditor boardId={boardId} labelId={label.id} onDone={() => setEditing(null)} /></View>
      : <View key={label.id} className="min-h-14 flex-row items-center border-b border-surface-900">
        <Pressable
          accessibilityRole={selected ? 'checkbox' : 'button'}
          accessibilityState={selected ? { checked: selected.includes(label.id) } : undefined}
          accessibilityLabel={label.name || `${LABEL_COLOR_NAMES[label.color]} label`}
          onPress={() => selected && onToggle ? onToggle(label.id) : setEditing(label.id)}
          className="flex-1 flex-row items-center py-2"
        >
          {selected && <View className={`mr-3 h-6 w-6 items-center justify-center rounded-md border ${selected.includes(label.id) ? 'border-transparent bg-primary' : 'border-surface-500'}`}>
            {selected.includes(label.id) && <Check color="#0a0a0a" size={16} strokeWidth={3} />}
          </View>}
          <LabelChip label={label} size="large" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit label" onPress={() => setEditing(label.id)} hitSlop={8} className="h-11 w-11 items-center justify-center">
          <Pencil color={color.textMuted} size={18} />
        </Pressable>
      </View>)}
    <View className="mt-4">
      {editing === 'new'
        ? <LabelEditor boardId={boardId} labelId={null} onDone={() => setEditing(null)} />
        : <Button variant="outline" onPress={() => setEditing('new')}><Plus color="#fafafa" size={18} /><UiText>Create a label</UiText></Button>}
    </View>
  </BottomSheet>
}

export function PrioritySheet({ visible, value, onChange, onClose }: {
  visible: boolean
  value: TaskPriority
  onChange: (priority: TaskPriority) => void
  onClose: () => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title="Priority" onClose={onClose} dismissOnBackdrop>
    {[...TASK_PRIORITIES].reverse().map((priority) => <Pressable
      key={priority}
      accessibilityRole="button"
      accessibilityState={{ selected: priority === value }}
      onPress={() => {
        onChange(priority)
        onClose()
      }}
      className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900"
    >
      <View className="w-8">{priority === 'none' ? <View /> : <PriorityIcon priority={priority} size={18} />}</View>
      <Text className="flex-1 text-[17px] text-foreground">{TASK_PRIORITY_LABELS[priority]}</Text>
      {priority === value && <Check color="#fafafa" size={20} />}
    </Pressable>)}
  </BottomSheet>
}

interface ClockDraft {
  hour: string
  minute: string
  meridiem: 'am' | 'pm'
}

const MERIDIEMS = [{ value: 'am' as const, label: 'AM' }, { value: 'pm' as const, label: 'PM' }]
const TIME_PRESETS = ['09:00', '12:00', '17:00', '21:00']

function draftOf(time: string | null): ClockDraft {
  const [hours, minutes] = (time ?? '17:00').split(':').map(Number)
  return { hour: String(hours % 12 || 12), minute: String(minutes).padStart(2, '0'), meridiem: hours >= 12 ? 'pm' : 'am' }
}

function timeOf(draft: ClockDraft): string | null {
  if (!/^\d{1,2}$/.test(draft.hour) || !/^\d{1,2}$/.test(draft.minute)) return null
  const hour = Number(draft.hour)
  const minute = Number(draft.minute)
  if (hour < 1 || hour > 12 || minute > 59) return null
  const hours = (hour % 12) + (draft.meridiem === 'pm' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function presetLabel(time: string): string {
  const [hours] = time.split(':').map(Number)
  return hours === 12 ? 'Noon' : `${hours % 12 || 12} ${hours < 12 ? 'AM' : 'PM'}`
}

export interface DueValue {
  dueDate: string | null
  dueTime: string | null
  reminderMinutes: TaskReminder | null
}

/** The due date, an optional time, and when to be reminded. */
export function DueSheet({ visible, card, onSave, onClose }: {
  visible: boolean
  card: Pick<TaskCardRecord, 'dueDate' | 'dueTime' | 'reminderMinutes'>
  onSave: (value: DueValue) => void
  onClose: () => void
}): React.ReactElement {
  const notifications = useTaskNotifications()
  const today = isoToday()
  const [date, setDate] = useState(card.dueDate ?? today)
  const [timed, setTimed] = useState(card.dueTime !== null)
  const [clock, setClock] = useState(draftOf(card.dueTime))
  const [reminder, setReminder] = useState<TaskReminder | null>(card.dueDate ? card.reminderMinutes : null)
  const [calendar, setCalendar] = useState(false)
  useEffect(() => {
    if (!visible) return
    setDate(card.dueDate ?? today)
    setTimed(card.dueTime !== null)
    setClock(draftOf(card.dueTime))
    setReminder(card.dueDate ? card.reminderMinutes : null)
  }, [card.dueDate, card.dueTime, card.reminderMinutes, today, visible])
  const time = timed ? timeOf(clock) : null
  const choices: readonly TaskReminder[] = timed ? TASK_REMINDERS : TASK_DATE_ONLY_REMINDERS
  const shownReminder = reminder !== null && !choices.includes(reminder) ? defaultTaskReminder(timed ? time : null) : reminder
  const days = [
    { label: EOD, date: today },
    { label: 'Tomorrow', date: shiftIso(today, 1) },
    { label: 'Next week', date: shiftIso(today, 7) }
  ]
  const changeTimed = (on: boolean): void => {
    setTimed(on)
    if (reminder !== null) setReminder(defaultTaskReminder(on ? '17:00' : null))
  }
  const pickDay = (day: string): void => {
    setDate(day)
    if (day === today && timed) changeTimed(false)
  }
  const picked = !days.some((day) => day.date === date)
  const digits = (text: string): string => text.replace(/\D/g, '')
  const save = async (): Promise<void> => {
    if (shownReminder !== null) await notifications.ensurePermission()
    onSave({ dueDate: date, dueTime: time, reminderMinutes: shownReminder })
    onClose()
  }
  return <BottomSheet visible={visible} title="Dates" onClose={onClose}>
    <View className="flex-row flex-wrap gap-2">
      {days.map((day) => <Option key={day.label} label={day.label} selected={date === day.date} onPress={() => pickDay(day.date)} />)}
      <Option label={picked ? formatIso(date) : 'Pick a day'} selected={picked} onPress={() => setCalendar(true)}>
        <CalendarDays color={picked ? '#0a0a0a' : '#fafafa'} size={17} />
      </Option>
    </View>
    <View className="mt-5 flex-row items-center">
      <Text className="flex-1 text-[17px] font-medium text-foreground">Due at a time</Text>
      <Switch
        accessibilityLabel="Due at a time"
        value={timed}
        onValueChange={changeTimed}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={timed ? '#0a0a0a' : '#d4d4d4'}
        ios_backgroundColor="#404040"
      />
    </View>
    {timed && <>
      <View className="mt-3 flex-row items-center gap-2">
        <TextInput
          value={clock.hour}
          onChangeText={(hour) => setClock({ ...clock, hour: digits(hour) })}
          accessibilityLabel="Hour"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <Text className="text-[20px] font-bold text-foreground">:</Text>
        <TextInput
          value={clock.minute}
          onChangeText={(minute) => setClock({ ...clock, minute: digits(minute) })}
          accessibilityLabel="Minute"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {TIME_PRESETS.map((preset) => <Option key={preset} label={presetLabel(preset)} selected={time === preset} onPress={() => setClock(draftOf(preset))} />)}
      </View>
      {time === null && <Text className="mt-2 text-[14px] text-destructive">Enter a time like 5:30.</Text>}
    </>}
    <Heading>Reminder</Heading>
    <View className="flex-row flex-wrap gap-2">
      <Option label="None" selected={shownReminder === null} onPress={() => setReminder(null)} />
      {choices.map((minutes) => <Option key={minutes} label={taskReminderLabel(minutes, timed)} selected={shownReminder === minutes} onPress={() => setReminder(minutes)} />)}
    </View>
    {notifications.blocked && shownReminder !== null && <Text className="mt-3 text-[14px] leading-5 text-attention">
      Notifications are off for Ego. Turn them on in Android settings, or the reminder stays silent.
    </Text>}
    <View className="mt-6 flex-row gap-3">
      {card.dueDate !== null && <Button variant="outline" size="lg" className="flex-1" onPress={() => {
        onSave({ dueDate: null, dueTime: null, reminderMinutes: null })
        onClose()
      }}><UiText>Remove</UiText></Button>}
      <Button size="lg" className="flex-1" disabled={timed && time === null} onPress={() => void save()}><UiText>Save</UiText></Button>
    </View>
    <CalendarDialog visible={calendar} value={date} onCancel={() => setCalendar(false)} onConfirm={(iso) => {
      setDate(iso)
      setCalendar(false)
    }} />
  </BottomSheet>
}

function Toggle({ label, detail, value, disabled = false, onChange }: {
  label: string
  detail?: string
  value: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}): React.ReactElement {
  return <View className={`min-h-14 flex-row items-center border-b border-surface-900 ${disabled ? 'opacity-40' : ''}`}>
    <View className="flex-1 py-2">
      <Text className="text-[17px] text-foreground">{label}</Text>
      {detail && <Text className="text-[14px] text-muted-foreground">{detail}</Text>}
    </View>
    <Switch
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: '#404040', true: '#fafafa' }}
      thumbColor={value ? '#0a0a0a' : '#d4d4d4'}
      ios_backgroundColor="#404040"
    />
  </View>
}

/** Moves a card to a list on any board, or copies it there. */
export function MoveSheet({ visible, mode, card, onDone, onClose }: {
  visible: boolean
  mode: 'move' | 'copy'
  card: TaskCardRecord
  onDone: (cardId: string) => void
  onClose: () => void
}): React.ReactElement {
  const tasks = useTasks()
  const [boardId, setBoardId] = useState(card.boardId)
  const [listId, setListId] = useState(card.listId)
  const [place, setPlace] = useState<'top' | 'bottom'>(mode === 'copy' ? 'bottom' : 'top')
  const [title, setTitle] = useState(card.title)
  const [keepLabels, setKeepLabels] = useState(true)
  const [keepChecklists, setKeepChecklists] = useState(true)
  const [keepAttachments, setKeepAttachments] = useState(true)
  useEffect(() => {
    if (!visible) return
    setBoardId(card.boardId)
    setListId(card.listId)
    setPlace(mode === 'copy' ? 'bottom' : 'top')
    setTitle(card.title)
  }, [card.boardId, card.listId, card.title, mode, visible])
  const data = tasks.data
  const boards = data ? liveBoards(data) : []
  const lists = data ? boardLists(data, boardId) : []
  const target = lists.some((list) => list.id === listId) ? listId : lists[0]?.id ?? null
  const uploading = data?.uploads.has(card.id) ?? false
  const confirm = async (): Promise<void> => {
    if (!target || !data) return
    if (mode === 'move') {
      const count = data.cards.filter((item) => item.listId === target && item.archivedAt === null && item.id !== card.id).length
      if (await tasks.moveCard(card.id, { listId: target, boardId, index: place === 'top' ? 0 : count })) onDone(card.id)
    } else {
      const id = await tasks.copyCard(card.id, { title, boardId, listId: target, place, keepLabels, keepChecklists, keepAttachments })
      if (id) onDone(id)
    }
    onClose()
  }
  return <BottomSheet visible={visible} title={mode === 'move' ? 'Move card' : 'Copy card'} onClose={onClose}>
    {mode === 'copy' && <TextInput
      value={title}
      onChangeText={setTitle}
      placeholder="Title"
      placeholderTextColor="#737373"
      accessibilityLabel="Title of the copy"
      multiline
      className={inputClass}
    />}
    <Heading>Board</Heading>
    <View className="flex-row flex-wrap gap-2">
      {boards.map((board) => <Option key={board.id} label={`${board.icon ? `${board.icon} ` : ''}${board.name}`} selected={board.id === boardId} onPress={() => setBoardId(board.id)} />)}
    </View>
    <Heading>List</Heading>
    {lists.length === 0
      ? <Text className="text-[15px] text-muted-foreground">That board has no lists. Add one first.</Text>
      : <View className="flex-row flex-wrap gap-2">
        {lists.map((list) => <Option key={list.id} label={list.name} selected={list.id === target} onPress={() => setListId(list.id)} />)}
      </View>}
    <Heading>Position</Heading>
    <View className="flex-row gap-2">
      <Option label="Top" selected={place === 'top'} onPress={() => setPlace('top')} />
      <Option label="Bottom" selected={place === 'bottom'} onPress={() => setPlace('bottom')} />
    </View>
    {mode === 'copy' && <>
      <Heading>Keep</Heading>
      <Toggle label="Labels" detail={boardId !== card.boardId ? 'Only labels this board also has' : undefined} value={keepLabels} onChange={setKeepLabels} />
      <Toggle label="Checklists" value={keepChecklists} disabled={card.checklists.length === 0} onChange={setKeepChecklists} />
      <Toggle
        label="Attachments"
        detail={uploading ? 'Wait until the files finish uploading' : undefined}
        value={keepAttachments && !uploading}
        disabled={card.attachments.length === 0 || uploading}
        onChange={setKeepAttachments}
      />
    </>}
    <Button size="lg" className="mt-6" disabled={!target || (mode === 'copy' && title.trim() === '')} onPress={() => void confirm()}>
      <UiText>{mode === 'move' ? 'Move' : 'Create card'}</UiText>
    </Button>
  </BottomSheet>
}

const DUE_FILTERS: Array<{ value: DueFilter; label: string }> = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: EOD },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No date' }
]

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function FilterSheet({ visible, boardId, filter, onChange, onClose }: {
  visible: boolean
  boardId: string
  filter: CardFilter
  onChange: (filter: CardFilter) => void
  onClose: () => void
}): React.ReactElement {
  const tasks = useTasks()
  const labels = useMemo(() => tasks.data ? boardLabels(tasks.data, boardId) : [], [boardId, tasks.data])
  return <BottomSheet visible={visible} title="Filter" onClose={onClose} dismissOnBackdrop>
    <View className={`${inputClass} flex-row items-center`}>
      <Search color="#737373" size={18} />
      <TextInput
        value={filter.text}
        onChangeText={(text) => onChange({ ...filter, text })}
        placeholder="Search titles and descriptions"
        placeholderTextColor="#737373"
        accessibilityLabel="Search cards"
        className="ml-2 flex-1 text-[17px] text-foreground"
      />
    </View>
    {labels.length > 0 && <>
      <Heading>Labels</Heading>
      <View className="flex-row flex-wrap gap-2">
        {labels.map((label) => {
          const selected = filter.labelIds.includes(label.id)
          return <Pressable
            key={label.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={label.name || LABEL_COLOR_NAMES[label.color]}
            onPress={() => onChange({ ...filter, labelIds: toggled(filter.labelIds, label.id) })}
            className={`rounded-full p-1 ${selected ? 'border-2 border-primary' : 'border-2 border-transparent'}`}
          ><LabelChip label={label} size="large" /></Pressable>
        })}
      </View>
    </>}
    <Heading>Priority</Heading>
    <View className="flex-row flex-wrap gap-2">
      {[...TASK_PRIORITIES].reverse().filter((priority) => priority !== 'none').map((priority) => <Option
        key={priority}
        label={TASK_PRIORITY_LABELS[priority]}
        selected={filter.priorities.includes(priority)}
        onPress={() => onChange({ ...filter, priorities: toggled(filter.priorities, priority) })}
      />)}
    </View>
    <Heading>Due</Heading>
    <View className="flex-row flex-wrap gap-2">
      {DUE_FILTERS.map((due) => <Option
        key={due.value}
        label={due.label}
        selected={filter.due.includes(due.value)}
        onPress={() => onChange({ ...filter, due: toggled(filter.due, due.value) })}
      />)}
    </View>
    <View className="mt-6 flex-row gap-3">
      <Button variant="outline" size="lg" className="flex-1" onPress={() => onChange(NO_FILTER)}><UiText>Clear</UiText></Button>
      <Button size="lg" className="flex-1" onPress={onClose}><UiText>Show cards</UiText></Button>
    </View>
  </BottomSheet>
}

export function TaskNotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const notifications = useTaskNotifications()
  return <BottomSheet visible={visible} title="Notifications" onClose={onClose} dismissOnBackdrop>
    <View className="flex-row items-start">
      <BellRing color={color.textMuted} size={20} style={{ marginTop: 2 }} />
      <Text className="ml-3 flex-1 text-[15px] leading-6 text-muted-foreground">
        Each card with a due date reminds you when its reminder says, and not once it is done or archived. Set the reminder in a card's dates.
      </Text>
    </View>
    <View className="mt-4">
      <Toggle
        label="Morning digest"
        detail="At 9 AM, the cards due that day. Date-only cards then wait for the digest instead of reminding on their own."
        value={notifications.preference.digest}
        disabled={!notifications.available}
        onChange={(on) => void notifications.setDigest(on)}
      />
    </View>
    {!notifications.available && <Text className="mt-3 text-[14px] leading-5 text-attention">This build cannot schedule notifications.</Text>}
    {notifications.blocked && <Text className="mt-3 text-[14px] leading-5 text-attention">
      Notifications are off for Ego. Turn them on in Android settings.
    </Text>}
  </BottomSheet>
}
