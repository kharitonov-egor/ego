import React, { useEffect, useMemo, useState } from 'react'
import { BellRing, CalendarDays, Check, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { CalendarDialog } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { Switch } from '../ui/switch'
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
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onPress}
    className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-[15px] font-semibold transition-colors',
      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface-900 text-foreground hover:bg-surface-800')}
  >
    {children}
    {label}
  </button>
}

function Heading({ children }: { children: string }): React.ReactElement {
  return <h3 className="mb-2 mt-5 text-[15px] font-medium text-surface-200">{children}</h3>
}

/** A new board, or a board's name and emoji. */
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
  return <Sheet visible={visible} title={title} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (name.trim()) onSave(name, icon)
    }}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        maxLength={120}
        className={inputClass}
      />
      <Heading>Emoji</Heading>
      <div className="flex flex-wrap gap-2">
        {options.map((emoji) => {
          const selected = emoji === icon
          return <button
            key={emoji}
            type="button"
            aria-label={`Use ${emoji}`}
            aria-pressed={selected}
            onClick={() => setIcon(selected ? '' : emoji)}
            className={cn('flex h-12 w-12 items-center justify-center rounded-xl text-[24px] transition-colors',
              selected ? 'border-2 border-primary bg-surface-800' : 'border border-input bg-surface-900 hover:bg-surface-800')}
          >{emoji}</button>
        })}
      </div>
      <input
        value=""
        onChange={(event) => {
          const symbol = typedSymbol(event.target.value)
          if (symbol) setIcon(symbol)
        }}
        aria-label="Type any emoji"
        placeholder="Or type any emoji"
        autoComplete="off"
        spellCheck={false}
        className={cn(inputClass, 'mt-3')}
      />
      <Button type="submit" size="lg" className="mt-5 w-full" disabled={name.trim() === ''}>{confirm}</Button>
    </form>
  </Sheet>
}

/** One line of text: a list's name, a checklist's title, a new card. */
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
  return <Sheet visible={visible} title={title} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (text.trim()) onSave(text)
    }}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.target.select()}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        maxLength={120}
        className={inputClass}
      />
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={text.trim() === ''}>{confirm}</Button>
    </form>
  </Sheet>
}

function LabelEditor({ boardId, labelId, onDone }: { boardId: string; labelId: string | null; onDone: () => void }): React.ReactElement {
  const tasks = useTasks()
  const existing = labelId ? tasks.data?.labels.find((label) => label.id === labelId) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [tint, setTint] = useState<TaskLabelColor>(existing?.color ?? 'green')
  const [deleting, setDeleting] = useState(false)
  const save = (): void => {
    void tasks.saveLabel(boardId, labelId, name, tint)
    onDone()
  }
  return <div className="rounded-2xl border border-surface-800 bg-surface-900 p-4">
    <div className="flex items-start">
      <LabelChip size="large" label={{ id: 'preview', boardId, name: name.trim(), color: tint, position: 0, createdAt: '', updatedAt: '', revision: 1 }} />
    </div>
    <input
      value={name}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        save()
      }}
      placeholder="Name, or leave empty for a color only"
      aria-label="Label name"
      autoFocus
      maxLength={40}
      className={cn(inputClass, 'mt-3')}
    />
    <div className="mt-3 flex flex-wrap gap-2">
      {TASK_LABEL_COLORS.map((item) => <button
        key={item}
        type="button"
        aria-label={LABEL_COLOR_NAMES[item]}
        title={LABEL_COLOR_NAMES[item]}
        aria-pressed={item === tint}
        onClick={() => setTint(item)}
        className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform hover:scale-105"
        style={{ backgroundColor: LABEL_COLORS[item], borderWidth: item === tint ? 2 : 0, borderColor: '#fafafa' }}
      >{item === tint && <Check color="#fafafa" size={18} strokeWidth={3} />}</button>)}
    </div>
    {deleting
      ? <div className="mt-4">
        <p className="text-[15px] leading-5 text-muted-foreground">Delete this label? It comes off every card on the board.</p>
        <div className="mt-3 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setDeleting(false)}>Keep</Button>
          <Button variant="destructive" className="flex-1" onClick={() => {
            if (labelId) void tasks.deleteLabel(labelId)
            onDone()
          }}>Delete</Button>
        </div>
      </div>
      : <div className="mt-4 flex gap-3">
        {existing && <Button variant="outline" size="icon" aria-label="Delete label" title="Delete label" className="h-11 w-11" onClick={() => setDeleting(true)}>
          <Trash2 color={color.destructive} size={18} />
        </Button>}
        <Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
        <Button className="flex-1" onClick={save}>{existing ? 'Save' : 'Create'}</Button>
      </div>}
  </div>
}

/**
 * The board's labels. With `selected`, a click puts a label on the card or takes it off; either
 * way the pencil edits a label and the button below makes a new one.
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
  return <Sheet visible={visible} title="Labels" onClose={onClose}>
    {labels.length === 0 && editing === null && <p className="text-[15px] leading-5 text-muted-foreground">
      This board has no labels yet. Labels belong to a board and can go on any of its cards.
    </p>}
    {labels.map((label) => editing === label.id
      ? <div key={label.id} className="mb-2"><LabelEditor boardId={boardId} labelId={label.id} onDone={() => setEditing(null)} /></div>
      : <div key={label.id} className="flex min-h-14 items-center border-b border-surface-900">
        <button
          type="button"
          role={selected ? 'checkbox' : undefined}
          aria-checked={selected ? selected.includes(label.id) : undefined}
          aria-label={label.name || `${LABEL_COLOR_NAMES[label.color]} label`}
          onClick={() => selected && onToggle ? onToggle(label.id) : setEditing(label.id)}
          className="flex min-w-0 flex-1 items-center rounded-lg py-2 text-left hover:bg-surface-900"
        >
          {selected && <span className={cn('mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
            selected.includes(label.id) ? 'border-transparent bg-primary' : 'border-surface-500')}>
            {selected.includes(label.id) && <Check color="#0a0a0a" size={16} strokeWidth={3} />}
          </span>}
          <LabelChip label={label} size="large" />
        </button>
        <button type="button" aria-label="Edit label" title="Edit label" onClick={() => setEditing(label.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-900">
          <Pencil color={color.textMuted} size={18} />
        </button>
      </div>)}
    <div className="mt-4">
      {editing === 'new'
        ? <LabelEditor boardId={boardId} labelId={null} onDone={() => setEditing(null)} />
        : <Button variant="outline" className="w-full" onClick={() => setEditing('new')}><Plus color="#fafafa" size={18} />Create a label</Button>}
    </div>
  </Sheet>
}

export function PrioritySheet({ visible, value, onChange, onClose }: {
  visible: boolean
  value: TaskPriority
  onChange: (priority: TaskPriority) => void
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible={visible} title="Priority" onClose={onClose} dismissOnBackdrop>
    {[...TASK_PRIORITIES].reverse().map((priority) => <button
      key={priority}
      type="button"
      aria-pressed={priority === value}
      onClick={() => {
        onChange(priority)
        onClose()
      }}
      className="flex min-h-14 w-full items-center rounded-lg border-b border-surface-900 px-1 text-left hover:bg-surface-900 active:bg-surface-900"
    >
      <span className="w-8">{priority !== 'none' && <PriorityIcon priority={priority} size={18} />}</span>
      <span className="flex-1 text-[17px] text-foreground">{TASK_PRIORITY_LABELS[priority]}</span>
      {priority === value && <Check color="#fafafa" size={20} />}
    </button>)}
  </Sheet>
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
  const save = (): void => {
    if (timed && time === null) return
    onSave({ dueDate: date, dueTime: time, reminderMinutes: shownReminder })
    onClose()
  }
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    save()
  }
  return <Sheet visible={visible} title="Dates" onClose={onClose}>
    <div className="flex flex-wrap gap-2">
      {days.map((day) => <Option key={day.label} label={day.label} selected={date === day.date} onPress={() => pickDay(day.date)} />)}
      <Option label={picked ? formatIso(date) : 'Pick a day'} selected={picked} onPress={() => setCalendar(true)}>
        <CalendarDays color={picked ? '#0a0a0a' : '#fafafa'} size={17} />
      </Option>
    </div>
    <div className="mt-5 flex items-center">
      <span className="flex-1 text-[17px] font-medium text-foreground">Due at a time</span>
      <Switch
        label="Due at a time"
        checked={timed}
        onCheckedChange={changeTimed}
      />
    </div>
    {timed && <>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={clock.hour}
          onChange={(event) => setClock({ ...clock, hour: digits(event.target.value) })}
          onFocus={(event) => event.target.select()}
          onKeyDown={submitOnEnter}
          aria-label="Hour"
          inputMode="numeric"
          maxLength={2}
          className={cn(inputClass, 'w-16 text-center tabular')}
        />
        <span className="text-[20px] font-bold text-foreground">:</span>
        <input
          value={clock.minute}
          onChange={(event) => setClock({ ...clock, minute: digits(event.target.value) })}
          onFocus={(event) => event.target.select()}
          onKeyDown={submitOnEnter}
          aria-label="Minute"
          inputMode="numeric"
          maxLength={2}
          className={cn(inputClass, 'w-16 text-center tabular')}
        />
        <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {TIME_PRESETS.map((preset) => <Option key={preset} label={presetLabel(preset)} selected={time === preset} onPress={() => setClock(draftOf(preset))} />)}
      </div>
      {time === null && <p className="mt-2 text-[14px] text-destructive">Enter a time like 5:30.</p>}
    </>}
    <Heading>Reminder</Heading>
    <div className="flex flex-wrap gap-2">
      <Option label="None" selected={shownReminder === null} onPress={() => setReminder(null)} />
      {choices.map((minutes) => <Option key={minutes} label={taskReminderLabel(minutes, timed)} selected={shownReminder === minutes} onPress={() => setReminder(minutes)} />)}
    </div>
    <div className="mt-6 flex gap-3">
      {card.dueDate !== null && <Button variant="outline" size="lg" className="flex-1" onClick={() => {
        onSave({ dueDate: null, dueTime: null, reminderMinutes: null })
        onClose()
      }}>Remove</Button>}
      <Button size="lg" className="flex-1" disabled={timed && time === null} onClick={save}>Save</Button>
    </div>
    <CalendarDialog visible={calendar} value={date} onCancel={() => setCalendar(false)} onConfirm={(iso) => {
      setDate(iso)
      setCalendar(false)
    }} />
  </Sheet>
}

function Toggle({ label, detail, value, disabled = false, onChange }: {
  label: string
  detail?: string
  value: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}): React.ReactElement {
  return <div className={cn('flex min-h-14 items-center gap-3 border-b border-surface-900', disabled && 'opacity-40')}>
    <div className="flex-1 py-2">
      <p className="text-[17px] text-foreground">{label}</p>
      {detail && <p className="text-[14px] text-muted-foreground">{detail}</p>}
    </div>
    <Switch label={label} checked={value} disabled={disabled} onCheckedChange={onChange} />
  </div>
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
  return <Sheet visible={visible} title={mode === 'move' ? 'Move card' : 'Copy card'} onClose={onClose}>
    {mode === 'copy' && <textarea
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      placeholder="Title"
      aria-label="Title of the copy"
      rows={1}
      maxLength={500}
      className={cn(inputClass, 'resize-none [field-sizing:content]')}
    />}
    <Heading>Board</Heading>
    <div className="flex flex-wrap gap-2">
      {boards.map((board) => <Option key={board.id} label={`${board.icon ? `${board.icon} ` : ''}${board.name}`} selected={board.id === boardId} onPress={() => setBoardId(board.id)} />)}
    </div>
    <Heading>List</Heading>
    {lists.length === 0
      ? <p className="text-[15px] text-muted-foreground">That board has no lists. Add one first.</p>
      : <div className="flex flex-wrap gap-2">
        {lists.map((list) => <Option key={list.id} label={list.name} selected={list.id === target} onPress={() => setListId(list.id)} />)}
      </div>}
    <Heading>Position</Heading>
    <div className="flex gap-2">
      <Option label="Top" selected={place === 'top'} onPress={() => setPlace('top')} />
      <Option label="Bottom" selected={place === 'bottom'} onPress={() => setPlace('bottom')} />
    </div>
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
    <Button size="lg" className="mt-6 w-full" disabled={!target || (mode === 'copy' && title.trim() === '')} onClick={() => void confirm()}>
      {mode === 'move' ? 'Move' : 'Create card'}
    </Button>
  </Sheet>
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
  return <Sheet visible={visible} title="Filter" onClose={onClose} dismissOnBackdrop>
    <label className={cn(inputClass, 'flex items-center focus-within:border-surface-400')}>
      <Search color="#737373" size={18} />
      <input
        value={filter.text}
        onChange={(event) => onChange({ ...filter, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onClose()
        }}
        placeholder="Search titles and descriptions"
        aria-label="Search cards"
        className="ml-2 min-w-0 flex-1 bg-transparent text-[17px] text-foreground outline-none"
      />
    </label>
    {labels.length > 0 && <>
      <Heading>Labels</Heading>
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const selected = filter.labelIds.includes(label.id)
          return <button
            key={label.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={label.name || LABEL_COLOR_NAMES[label.color]}
            onClick={() => onChange({ ...filter, labelIds: toggled(filter.labelIds, label.id) })}
            className={cn('rounded-full border-2 p-1', selected ? 'border-primary' : 'border-transparent hover:border-surface-700')}
          ><LabelChip label={label} size="large" /></button>
        })}
      </div>
    </>}
    <Heading>Priority</Heading>
    <div className="flex flex-wrap gap-2">
      {[...TASK_PRIORITIES].reverse().filter((priority) => priority !== 'none').map((priority) => <Option
        key={priority}
        label={TASK_PRIORITY_LABELS[priority]}
        selected={filter.priorities.includes(priority)}
        onPress={() => onChange({ ...filter, priorities: toggled(filter.priorities, priority) })}
      />)}
    </div>
    <Heading>Due</Heading>
    <div className="flex flex-wrap gap-2">
      {DUE_FILTERS.map((due) => <Option
        key={due.value}
        label={due.label}
        selected={filter.due.includes(due.value)}
        onPress={() => onChange({ ...filter, due: toggled(filter.due, due.value) })}
      />)}
    </div>
    <div className="mt-6 flex gap-3">
      <Button variant="outline" size="lg" className="flex-1" onClick={() => onChange(NO_FILTER)}>Clear</Button>
      <Button size="lg" className="flex-1" onClick={onClose}>Show cards</Button>
    </div>
  </Sheet>
}

export function TaskNotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const notifications = useTaskNotifications()
  return <Sheet visible={visible} title="Notifications" onClose={onClose} dismissOnBackdrop>
    <div className="flex items-start">
      <BellRing color={color.textMuted} size={20} className="mt-0.5 shrink-0" />
      <p className="ml-3 flex-1 text-[15px] leading-6 text-muted-foreground">
        Each card with a due date reminds you when its reminder says, and not once it is done or archived. Set the reminder in a card's dates.
      </p>
    </div>
    <div className="mt-4">
      <Toggle
        label="Morning digest"
        detail="At 9 AM, the cards due that day. Date-only cards then wait for the digest instead of reminding on their own."
        value={notifications.preference.digest}
        onChange={notifications.setDigest}
      />
    </div>
  </Sheet>
}
