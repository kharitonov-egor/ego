import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlignLeft, Bell, CalendarDays, Check, CircleHelp, ExternalLink, Lock, MapPin, Palette, Paperclip, Pencil, Phone, Repeat,
  Trash2, Users, Video, X
} from 'lucide-react'
import type { CalendarAnswer, CalendarEvent, CalendarInfo, CalendarSeries } from '@ego/api-contracts'
import { EVENT_COLORS, describeRecurrence } from '@ego/core'
import { RESPONSE_LABELS, descriptionParts, permissionsFor, reminderLabel } from '@ego/local/calendar/draft'
import { localDayOf, whenLabel } from '@ego/local/calendar/layout'
import { overlaySourceOf } from '@ego/local/calendar/overlay'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { cardPath } from '../../screens/tasks/nav'
import { Button, IconButton } from '../ui/button'
import { PopupMenu, anchorBelow, type MenuAnchor } from '../ui/menu'
import { inputClass } from '../ui/input'
import { ColorDot, colorOf } from './ui'

function open(url: string): void {
  void window.api.openExternalUrl(url)
}

function Row({ Icon, children }: { Icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }): React.ReactElement {
  return <div className="flex gap-4 py-2">
    <Icon size={18} className="mt-0.5 shrink-0 text-surface-400" />
    <div className="min-w-0 flex-1 text-[15px] leading-6">{children}</div>
  </div>
}

function ResponseIcon({ response }: { response: CalendarEvent['attendees'][number]['response'] }): React.ReactElement | null {
  if (response === 'accepted') return <Check size={14} className="text-emerald-400" />
  if (response === 'declined') return <X size={14} className="text-rose-400" />
  if (response === 'tentative') return <CircleHelp size={14} className="text-surface-300" />
  return null
}

function guestSummary(event: CalendarEvent): string {
  const count = (response: string): number => event.attendees.filter((person) => person.response === response).length
  const parts = [
    count('accepted') && `${count('accepted')} yes`, count('tentative') && `${count('tentative')} maybe`,
    count('declined') && `${count('declined')} no`, count('needsAction') && `${count('needsAction')} awaiting`
  ].filter(Boolean)
  return parts.join(', ')
}

const ANSWERS: ReadonlyArray<{ answer: CalendarAnswer; label: string }> = [
  { answer: 'accepted', label: 'Yes' },
  { answer: 'tentative', label: 'Maybe' },
  { answer: 'declined', label: 'No' }
]

/** The click-through card for one event, on the right of the calendar, like Google's popover. */
export function EventPanel({ event, calendar, calendars, today, multipleAccounts, offline, loadSeries, onClose, onEdit, onDelete, onRespond, onRecolor }: {
  event: CalendarEvent
  calendar: CalendarInfo | undefined
  calendars: ReadonlyMap<string, CalendarInfo>
  today: string
  multipleAccounts: boolean
  offline: boolean
  loadSeries: (event: CalendarEvent) => Promise<CalendarSeries | null>
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onRespond: (answer: CalendarAnswer, comment: string | null) => void
  onRecolor: (colorId: string | null) => void
}): React.ReactElement {
  const navigate = useNavigate()
  const [series, setSeries] = useState<CalendarSeries | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [colors, setColors] = useState<MenuAnchor | null>(null)
  const permissions = permissionsFor(event, calendar)
  const source = overlaySourceOf(event)
  const color = colorOf(event, calendars)
  const own = event.attendees.find((person) => person.self)

  useEffect(() => {
    setSeries(null)
    setNote(null)
    if (!event.recurringEventId) return
    let active = true
    void loadSeries(event).then((loaded) => { if (active) setSeries(loaded) })
    return () => { active = false }
  }, [event.key])

  const repeat = series ? describeRecurrence(series.recurrence, series.allDay ? series.start : localDayOf(series.start)) : event.recurringEventId ? 'Repeats' : null
  const reminders = event.reminders.useDefault ? calendar?.defaultReminders ?? [] : event.reminders.overrides
  const description = event.description ? descriptionParts(event.description) : []

  return <aside aria-label="Event" className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-background">
    <div className="flex items-center justify-end gap-1 px-3 pt-3">
      {!source && permissions.edit && <IconButton label="Edit event" disabled={offline} onClick={onEdit}><Pencil size={18} /></IconButton>}
      {!source && permissions.edit && <IconButton label="Delete event" disabled={offline} onClick={onDelete}><Trash2 size={18} /></IconButton>}
      {!source && permissions.personal && <IconButton label="Event color" disabled={offline} onClick={(click) => setColors(anchorBelow(click.currentTarget))}><Palette size={18} /></IconButton>}
      {event.htmlLink && <IconButton label="Open in Google Calendar" onClick={() => open(event.htmlLink ?? '')}><ExternalLink size={18} /></IconButton>}
      <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <div className="flex gap-4 pt-1">
        <span className="mt-2 h-4 w-4 shrink-0 rounded" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <Blurred><h2 className={cn('break-words text-[22px] font-bold leading-snug', event.response === 'declined' && 'line-through opacity-70')}>{event.title || '(No title)'}</h2></Blurred>
          <p className="mt-1 text-[15px] text-surface-300">{whenLabel(event, today)}</p>
          {repeat && <p className="flex items-center gap-1.5 text-[14px] text-surface-400"><Repeat size={13} />{repeat}</p>}
        </div>
      </div>

      <div className="mt-3">
        {event.conference?.url && <Row Icon={Video}>
          <Button size="sm" onClick={() => open(event.conference?.url ?? '')}>Join {event.conference.name ?? 'the call'}</Button>
          <div className="mt-1 truncate text-[13px] text-surface-400">{event.conference.url.replace(/^https?:\/\//, '')}</div>
        </Row>}
        {event.conference?.phone && <Row Icon={Phone}>
          <span>{event.conference.phone}{event.conference.pin ? ` · PIN ${event.conference.pin}` : ''}</span>
        </Row>}
        {event.location && <Row Icon={MapPin}>
          <Blurred><button
            type="button"
            className="text-left underline-offset-2 hover:underline"
            onClick={() => open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location ?? '')}`)}
          >{event.location}</button></Blurred>
        </Row>}
        {event.attendees.length > 0 && <Row Icon={Users}>
          <div className="font-medium">{event.attendees.length} guest{event.attendees.length === 1 ? '' : 's'}</div>
          <div className="text-[13px] text-surface-400">{guestSummary(event)}</div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {event.attendees.map((person) => <li key={person.email} className="flex items-center gap-2.5">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-800 text-[12px] font-semibold uppercase">
                {(person.name ?? person.email).charAt(0)}
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background"><ResponseIcon response={person.response} /></span>
              </span>
              <Blurred><span className="min-w-0 flex-1 truncate text-[14px]">
                {person.name ?? person.email}
                {person.organizer && <span className="ml-1.5 text-[12px] text-surface-400">Organizer</span>}
                {person.optional && <span className="ml-1.5 text-[12px] text-surface-400">Optional</span>}
              </span></Blurred>
            </li>)}
          </ul>
          {event.attendeesOmitted && <div className="mt-1 text-[13px] text-surface-500">Google left out the rest of the guest list.</div>}
        </Row>}
        {description.length > 0 && <Row Icon={AlignLeft}>
          <Blurred><div className="whitespace-pre-wrap break-words text-[14px] text-surface-200">
            {description.map((part, index) => part.href
              ? <button key={index} type="button" className="break-all text-left text-sky-300 underline-offset-2 hover:underline" onClick={() => open(part.href ?? '')}>{part.text}</button>
              : <span key={index} className={part.bold ? 'font-semibold' : undefined}>{part.text}</span>)}
          </div></Blurred>
        </Row>}
        {event.attachments.length > 0 && <Row Icon={Paperclip}>
          {event.attachments.map((file) => <button key={file.url} type="button" className="block truncate text-left text-sky-300 hover:underline" onClick={() => open(file.url)}>{file.title}</button>)}
        </Row>}
        {!source && reminders.length > 0 && <Row Icon={Bell}>
          {reminders.map((reminder, index) => <div key={index}>{reminderLabel(reminder.minutes, reminder.method)}</div>)}
        </Row>}
        {calendar && <Row Icon={CalendarDays}>
          <span className="flex items-center gap-2"><ColorDot color={calendar.color} />{calendar.name}</span>
          {multipleAccounts && !source && <div className="text-[13px] text-surface-400">{calendar.accountId}</div>}
          {event.organizer.email && !event.organizer.self && <div className="text-[13px] text-surface-400">Organized by {event.organizer.name ?? event.organizer.email}</div>}
        </Row>}
        {(event.visibility === 'private' || event.transparency === 'transparent') && !source && <Row Icon={Lock}>
          {[event.visibility === 'private' ? 'Private' : null, event.transparency === 'transparent' ? 'Shows as free' : null].filter(Boolean).join(' · ')}
        </Row>}
        {permissions.reason && !source && <p className="mt-2 rounded-2xl bg-surface-900 px-4 py-3 text-[14px] text-surface-300">{permissions.reason}</p>}
        {source === 'tasks' && <Button className="mt-3" variant="secondary" onClick={() => navigate(cardPath(event.id), { state: { back: '/calendar' } })}>Open in Tasks</Button>}
        {source === 'study' && <Button className="mt-3" variant="secondary" onClick={() => navigate('/study/assignments')}>Open in Study</Button>}
        {source === 'gym' && <Button className="mt-3" variant="secondary" onClick={() => navigate('/gym')}>Open in Gym</Button>}
      </div>
    </div>

    {permissions.respond && <div className="border-t border-border px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="mr-auto text-[14px] font-semibold">Going?</span>
        {ANSWERS.map((item) => <Button
          key={item.answer}
          size="sm"
          variant={event.response === item.answer ? 'default' : 'outline'}
          disabled={offline}
          aria-pressed={event.response === item.answer}
          onClick={() => onRespond(item.answer, note?.trim() ? note.trim() : null)}
        >{item.label}</Button>)}
      </div>
      {event.response && <p className="mt-1 text-[12px] text-surface-500">{RESPONSE_LABELS[event.response]}{own?.comment ? ` · "${own.comment}"` : ''}</p>}
      {note === null
        ? <button type="button" className="mt-1 text-[13px] text-surface-400 hover:text-foreground" onClick={() => setNote(own?.comment ?? '')}>Add a note</button>
        : <input autoFocus value={note} onChange={(change) => setNote(change.target.value)} placeholder="A note for the organizer" maxLength={1000} className={cn(inputClass, 'mt-2 min-h-9 py-1.5 text-[14px]')} />}
    </div>}

    <PopupMenu
      anchor={colors}
      title="Event color"
      onClose={() => setColors(null)}
      items={[
        { label: `Calendar color${event.colorId === null ? ' ✓' : ''}`, swatch: calendar?.color, onPress: () => onRecolor(null) },
        ...Object.entries(EVENT_COLORS).map(([id, named]) => ({
          label: `${named.name}${event.colorId === id ? ' ✓' : ''}`,
          swatch: named.hex,
          onPress: () => onRecolor(id)
        }))
      ]}
    />
  </aside>
}
