import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Video, X } from 'lucide-react'
import type { CalendarEvent, CalendarEventDraft, CalendarInfo, CalendarReminder } from '@ego/api-contracts'
import {
  EVENT_COLORS, WEEKDAY_CODES, WEEKDAY_NAMES, describeRecurrence, recurrencePresets, type RecurrenceFrequency, type RecurrenceRule
} from '@ego/core'
import { REMINDER_CHOICES, descriptionText, draftProblem, isWritable, lastDayOf, withAllDay, withStart } from '@ego/local/calendar/draft'
import { atClock, clockValue, localDayOf } from '@ego/local/calendar/layout'
import { defaultRule, monthlyChoices, presetOf, ruleOf, untilDay, untilFor, withRule } from '@ego/local/calendar/recurrence'
import { shiftIso } from '@ego/local/dates'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { Switch } from '../ui/switch'
import { ColorDot } from './ui'

const FIELD = cn(inputClass, 'min-h-10 py-2 text-[15px] [color-scheme:dark]')
const SELECT = cn(FIELD, 'appearance-auto pr-2')
const FREQUENCIES: ReadonlyArray<{ value: RecurrenceFrequency; label: string }> = [
  { value: 'DAILY', label: 'day' }, { value: 'WEEKLY', label: 'week' }, { value: 'MONTHLY', label: 'month' }, { value: 'YEARLY', label: 'year' }
]

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }): React.ReactElement {
  return <label className={cn('flex flex-col gap-1.5', className)}>
    <span className="text-[13px] font-semibold text-surface-400">{label}</span>
    {children}
  </label>
}

/** Google's custom repeat dialog, inline: every N units, on which days, and when it stops. */
function CustomRepeat({ rule, startDay, allDay, onChange }: {
  rule: RecurrenceRule
  startDay: string
  allDay: boolean
  onChange: (rule: RecurrenceRule) => void
}): React.ReactElement {
  const monthly = monthlyChoices(startDay)
  const endDay = rule.end.kind === 'until' ? untilDay(rule.end.until) : shiftIso(startDay, 90)
  return <div className="flex flex-col gap-3 rounded-2xl bg-surface-900 p-4">
    <div className="flex items-center gap-2 text-[15px]">
      Every
      <input type="number" min={1} max={99} value={rule.interval} aria-label="Repeat every"
        onChange={(change) => onChange({ ...rule, interval: Math.max(1, Math.min(99, Number(change.target.value) || 1)) })}
        className={cn(FIELD, 'w-20')} />
      <select value={rule.frequency} aria-label="Unit" className={cn(SELECT, 'w-36')}
        onChange={(change) => onChange({ ...rule, frequency: change.target.value as RecurrenceFrequency, weekdays: [], monthly: null })}>
        {FREQUENCIES.map((item) => <option key={item.value} value={item.value}>{item.label}{rule.interval > 1 ? 's' : ''}</option>)}
      </select>
    </div>
    {rule.frequency === 'WEEKLY' && <div className="flex gap-1.5" role="group" aria-label="Repeat on">
      {[1, 2, 3, 4, 5, 6, 0].map((index) => {
        const code = WEEKDAY_CODES[index]
        const on = rule.weekdays.includes(code) || (rule.weekdays.length === 0 && new Date(`${startDay}T12:00:00`).getDay() === index)
        return <button key={code} type="button" aria-pressed={on} title={WEEKDAY_NAMES[code]}
          onClick={() => {
            const current = rule.weekdays.length > 0 ? rule.weekdays : [WEEKDAY_CODES[new Date(`${startDay}T12:00:00`).getDay()]]
            const next = on ? current.filter((day) => day !== code) : [...current, code]
            if (next.length > 0) onChange({ ...rule, weekdays: next })
          }}
          className={cn('h-9 w-9 rounded-full text-[13px] font-semibold', on ? 'bg-white text-black' : 'bg-surface-800 text-surface-300 hover:bg-surface-700')}
        >{WEEKDAY_NAMES[code].charAt(0)}</button>
      })}
    </div>}
    {rule.frequency === 'MONTHLY' && <select aria-label="Monthly on" className={SELECT}
      value={rule.monthly?.kind ?? 'day'}
      onChange={(change) => onChange({ ...rule, monthly: monthly.find((item) => item.kind === change.target.value)?.rule ?? null })}>
      {monthly.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
    </select>}
    <div className="flex flex-col gap-2 text-[15px]">
      <span className="text-[13px] font-semibold text-surface-400">Ends</span>
      <label className="flex items-center gap-3"><input type="radio" className="accent-white" checked={rule.end.kind === 'never'} onChange={() => onChange({ ...rule, end: { kind: 'never' } })} />Never</label>
      <label className="flex items-center gap-3">
        <input type="radio" className="accent-white" checked={rule.end.kind === 'until'} onChange={() => onChange({ ...rule, end: { kind: 'until', until: untilFor(endDay, allDay) } })} />
        On
        <input type="date" value={endDay} disabled={rule.end.kind !== 'until'} aria-label="End date"
          onChange={(change) => { if (change.target.value) onChange({ ...rule, end: { kind: 'until', until: untilFor(change.target.value, allDay) } }) }}
          className={cn(FIELD, 'w-44')} />
      </label>
      <label className="flex items-center gap-3">
        <input type="radio" className="accent-white" checked={rule.end.kind === 'count'} onChange={() => onChange({ ...rule, end: { kind: 'count', count: 10 } })} />
        After
        <input type="number" min={1} max={730} value={rule.end.kind === 'count' ? rule.end.count : 10} disabled={rule.end.kind !== 'count'} aria-label="Occurrences"
          onChange={(change) => onChange({ ...rule, end: { kind: 'count', count: Math.max(1, Math.min(730, Number(change.target.value) || 1)) } })}
          className={cn(FIELD, 'w-24')} />
        occurrences
      </label>
    </div>
  </div>
}

function ReminderRow({ reminder, onChange, onRemove }: {
  reminder: CalendarReminder
  onChange: (reminder: CalendarReminder) => void
  onRemove: () => void
}): React.ReactElement {
  const choices = REMINDER_CHOICES.some((choice) => choice.minutes === reminder.minutes)
    ? REMINDER_CHOICES
    : [...REMINDER_CHOICES, { minutes: reminder.minutes, label: `${reminder.minutes} minutes before` }]
  return <div className="flex items-center gap-2">
    <select aria-label="Notify by" value={reminder.method} onChange={(change) => onChange({ ...reminder, method: change.target.value === 'email' ? 'email' : 'popup' })} className={cn(SELECT, 'w-40')}>
      <option value="popup">Notification</option>
      <option value="email">Email</option>
    </select>
    <select aria-label="When" value={reminder.minutes} onChange={(change) => onChange({ ...reminder, minutes: Number(change.target.value) })} className={SELECT}>
      {choices.map((choice) => <option key={choice.minutes} value={choice.minutes}>{choice.label}</option>)}
    </select>
    <button type="button" aria-label="Remove notification" onClick={onRemove} className="rounded-full p-2 text-surface-400 hover:bg-surface-800"><X size={16} /></button>
  </div>
}

export interface EditorResult {
  calendar: CalendarInfo
  before: CalendarEventDraft
  after: CalendarEventDraft
}

/** The full event editor: every field Google Calendar's own editor has, in one sheet. */
export function EventEditor({ visible, event, initial, calendars, defaultCalendar, offline, onClose, onSave }: {
  visible: boolean
  /** Null for a new event. */
  event: CalendarEvent | null
  initial: CalendarEventDraft
  calendars: readonly CalendarInfo[]
  defaultCalendar: CalendarInfo | null
  offline: boolean
  onClose: () => void
  onSave: (result: EditorResult) => Promise<boolean>
}): React.ReactElement | null {
  const [draft, setDraft] = useState(initial)
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
  const [calendarKey, setCalendarKey] = useState(defaultCalendar?.key ?? '')
  const [custom, setCustom] = useState(false)
  const [guest, setGuest] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    setDraft(initial)
    setDescriptionDraft(null)
    setCalendarKey(defaultCalendar?.key ?? '')
    setCustom(presetOf(initial.recurrence, initial.allDay ? initial.start : localDayOf(initial.start)) === 'custom')
    setGuest('')
    setProblem(null)
    setSaving(false)
  }, [visible, initial, defaultCalendar?.key])

  const writable = useMemo(() => calendars.filter((calendar) => isWritable(calendar) &&
    (!event || calendar.accountId === event.accountId)), [calendars, event])
  const calendar = writable.find((item) => item.key === calendarKey) ?? defaultCalendar
  const startDay = draft.allDay ? draft.start : localDayOf(draft.start)
  const endDay = draft.allDay ? lastDayOf(draft) : localDayOf(draft.end)
  const presets = recurrencePresets(startDay)
  const preset = custom ? 'custom' : presetOf(draft.recurrence, startDay)
  const rule = ruleOf(draft.recurrence)
  const accounts = [...new Set(writable.map((item) => item.accountId))]
  const hasCall = event?.conference !== null && event?.conference !== undefined && draft.meet !== false

  const set = (patch: Partial<CalendarEventDraft>): void => setDraft((current) => ({ ...current, ...patch }))

  const addGuest = (): void => {
    const emails = guest.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)
    if (emails.length === 0) return
    const known = new Set(draft.attendees.map((person) => person.email.toLowerCase()))
    set({ attendees: [...draft.attendees, ...emails.filter((email) => !known.has(email.toLowerCase())).map((email) => ({ email, optional: false }))] })
    setGuest('')
  }

  const save = async (): Promise<void> => {
    if (!calendar) {
      setProblem('Choose a calendar you can edit.')
      return
    }
    const after = { ...draft, description: descriptionDraft === null ? draft.description : descriptionDraft.trim() || null }
    const issue = draftProblem(after)
    if (issue) {
      setProblem(issue)
      return
    }
    setSaving(true)
    const ok = await onSave({ calendar, before: initial, after })
    setSaving(false)
    if (ok) onClose()
  }

  return <Sheet
    visible={visible}
    title={event ? 'Edit event' : 'New event'}
    wide
    onClose={onClose}
    footer={<div className="flex items-center gap-3">
      {problem && <p className="mr-auto text-[14px] text-destructive">{problem}</p>}
      {offline && !problem && <p className="mr-auto text-[14px] text-attention">Offline. Saving waits for the connection.</p>}
      <Button variant="outline" className="ml-auto" onClick={onClose}>Cancel</Button>
      <Button disabled={saving || offline} onClick={() => void save()}>{saving ? 'Saving...' : 'Save'}</Button>
    </div>}
  >
    <div className="flex flex-col gap-4">
      <input
        data-autofocus
        value={draft.title}
        onChange={(change) => set({ title: change.target.value })}
        onKeyDown={(key) => { if (key.key === 'Enter' && (key.ctrlKey || key.metaKey)) void save() }}
        placeholder="Add title"
        maxLength={1024}
        aria-label="Title"
        className={cn(inputClass, 'text-[20px] font-semibold')}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Starts">
          <div className="flex gap-2">
            <input type="date" value={startDay} aria-label="Start date" className={cn(FIELD, 'w-44')}
              onChange={(change) => { if (change.target.value) setDraft(withStart(draft, draft.allDay ? change.target.value : atClock(change.target.value, clockValue(draft.start)))) }} />
            {!draft.allDay && <input type="time" step={300} value={clockValue(draft.start)} aria-label="Start time" className={cn(FIELD, 'w-32')}
              onChange={(change) => { if (change.target.value) setDraft(withStart(draft, atClock(startDay, change.target.value))) }} />}
          </div>
        </Field>
        <Field label="Ends">
          <div className="flex gap-2">
            {!draft.allDay && <input type="time" step={300} value={clockValue(draft.end)} aria-label="End time" className={cn(FIELD, 'w-32')}
              onChange={(change) => { if (change.target.value) set({ end: atClock(endDay, change.target.value) }) }} />}
            <input type="date" value={endDay} aria-label="End date" className={cn(FIELD, 'w-44')}
              onChange={(change) => {
                if (!change.target.value) return
                set({ end: draft.allDay ? shiftIso(change.target.value, 1) : atClock(change.target.value, clockValue(draft.end)) })
              }} />
          </div>
        </Field>
        <label className="flex min-h-10 items-center gap-2.5 pb-0.5">
          <Switch label="All day" checked={draft.allDay} onCheckedChange={(on) => setDraft(withAllDay(draft, on))} />
          <span className="text-[15px]">All day</span>
        </label>
      </div>
      {!draft.allDay && draft.timeZone && <p className="-mt-2 text-[13px] text-surface-500">{draft.timeZone.replace(/_/g, ' ')}</p>}

      <Field label="Repeat">
        <select value={preset} className={SELECT} onChange={(change) => {
          if (change.target.value === 'custom') {
            setCustom(true)
            if (!rule) set({ recurrence: withRule(draft.recurrence, defaultRule(startDay)) })
            return
          }
          setCustom(false)
          set({ recurrence: presets.find((item) => item.preset === change.target.value)?.lines ?? [] })
        }}>
          {presets.map((item) => <option key={item.preset} value={item.preset}>{item.label}</option>)}
          <option value="custom">{preset === 'custom' && rule ? `Custom: ${describeRecurrence(draft.recurrence, startDay)}` : 'Custom...'}</option>
        </select>
      </Field>
      {preset === 'custom' && rule && <CustomRepeat rule={rule} startDay={startDay} allDay={draft.allDay} onChange={(next) => set({ recurrence: withRule(draft.recurrence, next) })} />}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Calendar">
          <select value={calendar?.key ?? ''} className={SELECT} onChange={(change) => setCalendarKey(change.target.value)}>
            {accounts.map((account) => <optgroup key={account} label={account}>
              {writable.filter((item) => item.accountId === account).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <ColorDot color={draft.colorId ? EVENT_COLORS[draft.colorId]?.hex ?? '#fff' : calendar?.color ?? '#fff'} size={14} />
            <select value={draft.colorId ?? ''} className={SELECT} onChange={(change) => set({ colorId: change.target.value || null })}>
              <option value="">Calendar color</option>
              {Object.entries(EVENT_COLORS).map(([id, named]) => <option key={id} value={id}>{named.name}</option>)}
            </select>
          </div>
        </Field>
      </div>

      <Field label="Location">
        <input value={draft.location ?? ''} onChange={(change) => set({ location: change.target.value || null })} placeholder="Add location" maxLength={1024} className={FIELD} />
      </Field>

      {(calendar?.meet || hasCall) && <div className="flex items-center gap-3">
        <Video size={18} className="text-surface-400" />
        {hasCall || draft.meet === true
          ? <>
            <span className="text-[15px]">{draft.meet === true ? 'A Google Meet link is added when you save' : `${event?.conference?.name ?? 'Video call'} attached`}</span>
            <Button size="sm" variant="ghost" onClick={() => set({ meet: event?.conference ? false : null })}>Remove</Button>
          </>
          : <Button size="sm" variant="secondary" onClick={() => set({ meet: true })}>Add Google Meet video conferencing</Button>}
      </div>}

      <Field label="Guests">
        <div className="flex gap-2">
          <input value={guest} onChange={(change) => setGuest(change.target.value)} disabled={event?.attendeesOmitted}
            onKeyDown={(key) => { if (key.key === 'Enter') { key.preventDefault(); addGuest() } }}
            placeholder={event?.attendeesOmitted ? 'Google hides this event\'s guest list' : 'Add guests by email'} className={FIELD} />
          <Button variant="secondary" disabled={!guest.trim()} onClick={addGuest}><Plus size={16} />Add</Button>
        </div>
      </Field>
      {draft.attendees.length > 0 && <div className="-mt-1 flex flex-col gap-1">
        {draft.attendees.map((person) => <div key={person.email} className="flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-surface-900">
          <span className="min-w-0 flex-1 truncate text-[15px]">{person.email}</span>
          <label className="flex items-center gap-1.5 text-[13px] text-surface-400">
            <input type="checkbox" className="accent-white" checked={person.optional}
              onChange={(change) => set({ attendees: draft.attendees.map((item) => item.email === person.email ? { ...item, optional: change.target.checked } : item) })} />
            Optional
          </label>
          <button type="button" aria-label={`Remove ${person.email}`} onClick={() => set({ attendees: draft.attendees.filter((item) => item.email !== person.email) })}
            className="rounded-full p-1.5 text-surface-400 hover:bg-surface-800"><X size={15} /></button>
        </div>)}
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 px-2 text-[14px] text-surface-300">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-white" checked={draft.guestsCanModify} onChange={(change) => set({ guestsCanModify: change.target.checked })} />Guests can modify event</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-white" checked={draft.guestsCanInviteOthers} onChange={(change) => set({ guestsCanInviteOthers: change.target.checked })} />Guests can invite others</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-white" checked={draft.guestsCanSeeOtherGuests} onChange={(change) => set({ guestsCanSeeOtherGuests: change.target.checked })} />Guests can see the guest list</label>
        </div>
      </div>}

      <Field label="Notifications">
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2.5">
            <Switch label="Use the calendar's notifications" checked={draft.reminders.useDefault}
              onCheckedChange={(on) => set({ reminders: { useDefault: on, overrides: on ? [] : calendar?.defaultReminders ?? [] } })} />
            <span className="text-[15px]">Use the calendar's notifications</span>
          </label>
          {!draft.reminders.useDefault && draft.reminders.overrides.map((reminder, index) => <ReminderRow
            key={index}
            reminder={reminder}
            onChange={(next) => set({ reminders: { useDefault: false, overrides: draft.reminders.overrides.map((item, at) => at === index ? next : item) } })}
            onRemove={() => set({ reminders: { useDefault: false, overrides: draft.reminders.overrides.filter((_, at) => at !== index) } })}
          />)}
          {!draft.reminders.useDefault && draft.reminders.overrides.length < 5 && <Button size="sm" variant="ghost" className="self-start"
            onClick={() => set({ reminders: { useDefault: false, overrides: [...draft.reminders.overrides, { method: 'popup', minutes: 30 }] } })}>
            <Plus size={15} />Add notification
          </Button>}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Show as">
          <select value={draft.transparency} className={SELECT} onChange={(change) => set({ transparency: change.target.value === 'transparent' ? 'transparent' : 'opaque' })}>
            <option value="opaque">Busy</option>
            <option value="transparent">Free</option>
          </select>
        </Field>
        <Field label="Visibility">
          <select value={draft.visibility} className={SELECT} onChange={(change) => set({ visibility: change.target.value as CalendarEventDraft['visibility'] })}>
            <option value="default">Calendar default</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={descriptionDraft ?? descriptionText(draft.description)}
          onChange={(change) => setDescriptionDraft(change.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="Add description"
          className={cn(inputClass, 'resize-y text-[15px] leading-6')}
        />
      </Field>
    </div>
  </Sheet>
}
