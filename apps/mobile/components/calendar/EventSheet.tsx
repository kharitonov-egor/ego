import React, { useEffect, useState } from 'react'
import { Linking, Pressable, Text, TextInput, View } from 'react-native'
import {
  AlignLeft, Bell, CalendarDays, Check, CircleHelp, ExternalLink, Lock, MapPin, Palette, Paperclip, Pencil, Phone, Repeat, Trash2, Users,
  Video, X, type LucideIcon
} from 'lucide-react-native'
import type { CalendarAnswer, CalendarEvent, CalendarInfo, CalendarSeries } from '@ego/api-contracts'
import { EVENT_COLORS, describeRecurrence } from '@ego/core'
import { RESPONSE_LABELS, descriptionParts, permissionsFor, reminderLabel } from '@ego/local/calendar/draft'
import { localDayOf, whenLabel } from '@ego/local/calendar/layout'
import { overlaySourceOf } from '@ego/local/calendar/overlay'
import { Blurred } from '../../lib/blur'
import { BottomSheet, inputClass } from '../money/Common'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { ColorDot, colorOf } from './ui'

function open(url: string): void {
  void Linking.openURL(url).catch(() => undefined)
}

function Row({ Icon, children }: { Icon: LucideIcon; children: React.ReactNode }): React.ReactElement {
  return <View className="flex-row gap-4 py-2">
    <View className="pt-0.5"><Icon color="#a3a3a3" size={19} /></View>
    <View className="flex-1">{children}</View>
  </View>
}

function Action({ Icon, label, disabled = false, onPress }: { Icon: LucideIcon; label: string; disabled?: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    className={`h-12 flex-1 items-center justify-center rounded-2xl bg-surface-900 active:bg-surface-800 ${disabled ? 'opacity-40' : ''}`}>
    <Icon color="#e5e5e5" size={19} />
    <Text className="mt-0.5 text-[11px] text-surface-300">{label}</Text>
  </Pressable>
}

const ANSWERS: ReadonlyArray<{ answer: CalendarAnswer; label: string }> = [
  { answer: 'accepted', label: 'Yes' },
  { answer: 'tentative', label: 'Maybe' },
  { answer: 'declined', label: 'No' }
]

function guestSummary(event: CalendarEvent): string {
  const count = (response: string): number => event.attendees.filter((person) => person.response === response).length
  return [
    count('accepted') && `${count('accepted')} yes`, count('tentative') && `${count('tentative')} maybe`,
    count('declined') && `${count('declined')} no`, count('needsAction') && `${count('needsAction')} awaiting`
  ].filter(Boolean).join(', ')
}

/** One event, opened from the grid: what Google's event page shows, plus the RSVP row. */
export function EventSheet({ event, calendar, calendars, today, multipleAccounts, offline, loadSeries, onClose, onEdit, onDelete, onRespond, onColor, onOpenSource }: {
  event: CalendarEvent | null
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
  onColor: () => void
  onOpenSource: (event: CalendarEvent) => void
}): React.ReactElement {
  const [series, setSeries] = useState<CalendarSeries | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setSeries(null)
    setNote(null)
    if (!event?.recurringEventId) return
    let active = true
    void loadSeries(event).then((loaded) => { if (active) setSeries(loaded) })
    return () => { active = false }
  }, [event?.key])

  if (!event) return <BottomSheet visible={false} title="" onClose={onClose}><View /></BottomSheet>
  const permissions = permissionsFor(event, calendar)
  const source = overlaySourceOf(event)
  const color = colorOf(event, calendars)
  const own = event.attendees.find((person) => person.self)
  const repeat = series ? describeRecurrence(series.recurrence, series.allDay ? series.start : localDayOf(series.start)) : event.recurringEventId ? 'Repeats' : null
  const reminders = event.reminders.useDefault ? calendar?.defaultReminders ?? [] : event.reminders.overrides
  const description = event.description ? descriptionParts(event.description) : []

  return <BottomSheet visible title={event.title || '(No title)'} privateTitle onClose={onClose} dismissOnBackdrop>
    <View className="flex-row items-start gap-3">
      <View className="mt-1.5 h-4 w-4 rounded" style={{ backgroundColor: color }} />
      <View className="flex-1">
        <Text className="text-[16px] text-surface-200">{whenLabel(event, today)}</Text>
        {repeat && <View className="mt-0.5 flex-row items-center gap-1.5"><Repeat color="#a3a3a3" size={13} /><Text className="text-[14px] text-surface-400">{repeat}</Text></View>}
      </View>
    </View>

    {!source && <View className="mt-4 flex-row gap-2">
      {permissions.edit && <Action Icon={Pencil} label="Edit" disabled={offline} onPress={onEdit} />}
      {permissions.edit && <Action Icon={Trash2} label="Delete" disabled={offline} onPress={onDelete} />}
      {permissions.personal && <Action Icon={Palette} label="Color" disabled={offline} onPress={onColor} />}
      {event.htmlLink && <Action Icon={ExternalLink} label="Google" onPress={() => open(event.htmlLink ?? '')} />}
    </View>}

    {permissions.respond && <View className="mt-4 rounded-2xl bg-surface-900 p-3">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-[15px] font-semibold text-foreground">Going?</Text>
        {ANSWERS.map((item) => <Button
          key={item.answer}
          size="sm"
          variant={event.response === item.answer ? 'default' : 'outline'}
          disabled={offline}
          accessibilityState={{ selected: event.response === item.answer }}
          onPress={() => onRespond(item.answer, note?.trim() ? note.trim() : null)}
        ><UiText>{item.label}</UiText></Button>)}
      </View>
      {event.response && <Text className="mt-1 text-[12px] text-surface-500">{RESPONSE_LABELS[event.response]}{own?.comment ? ` · "${own.comment}"` : ''}</Text>}
      {note === null
        ? <Pressable onPress={() => setNote(own?.comment ?? '')} hitSlop={6}><Text className="mt-1 text-[13px] text-surface-400">Add a note</Text></Pressable>
        : <TextInput autoFocus value={note} onChangeText={setNote} placeholder="A note for the organizer" placeholderTextColor="#737373" maxLength={1000} className={`${inputClass} mt-2 min-h-11 py-2 text-[15px]`} />}
    </View>}

    <View className="mt-3">
      {event.conference?.url && <Row Icon={Video}>
        <Button size="sm" className="self-start" onPress={() => open(event.conference?.url ?? '')}><UiText>Join {event.conference.name ?? 'the call'}</UiText></Button>
        <Text numberOfLines={1} className="mt-1 text-[13px] text-surface-400">{event.conference.url.replace(/^https?:\/\//, '')}</Text>
      </Row>}
      {event.conference?.phone && <Row Icon={Phone}>
        <Pressable onPress={() => open(`tel:${(event.conference?.phone ?? '').replace(/[^\d+]/g, '')}`)}>
          <Text className="text-[15px] text-foreground">{event.conference.phone}{event.conference.pin ? ` · PIN ${event.conference.pin}` : ''}</Text>
        </Pressable>
      </Row>}
      {event.location && <Row Icon={MapPin}>
        <Pressable onPress={() => open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location ?? '')}`)}>
          <Blurred><Text className="text-[15px] text-foreground underline">{event.location}</Text></Blurred>
        </Pressable>
      </Row>}
      {event.attendees.length > 0 && <Row Icon={Users}>
        <Text className="text-[15px] font-medium text-foreground">{event.attendees.length} guest{event.attendees.length === 1 ? '' : 's'}</Text>
        <Text className="text-[13px] text-surface-400">{guestSummary(event)}</Text>
        <View className="mt-2 gap-1.5">
          {event.attendees.map((person) => <View key={person.email} className="flex-row items-center gap-2.5">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-800">
              <Text className="text-[12px] font-semibold uppercase text-foreground">{(person.name ?? person.email).charAt(0)}</Text>
              <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background">
                {person.response === 'accepted' ? <Check color="#34d399" size={12} />
                  : person.response === 'declined' ? <X color="#fb7185" size={12} />
                    : person.response === 'tentative' ? <CircleHelp color="#d4d4d4" size={12} /> : null}
              </View>
            </View>
            <Blurred><Text numberOfLines={1} className="flex-1 text-[14px] text-foreground">
              {person.name ?? person.email}{person.organizer ? '  Organizer' : ''}{person.optional ? '  Optional' : ''}
            </Text></Blurred>
          </View>)}
        </View>
      </Row>}
      {description.length > 0 && <Row Icon={AlignLeft}>
        <Blurred><Text className="text-[14px] leading-5 text-surface-200">
          {description.map((part, index) => part.href
            ? <Text key={index} className="text-sky-300 underline" onPress={() => open(part.href ?? '')}>{part.text}</Text>
            : <Text key={index} className={part.bold ? 'font-semibold' : undefined}>{part.text}</Text>)}
        </Text></Blurred>
      </Row>}
      {event.attachments.length > 0 && <Row Icon={Paperclip}>
        {event.attachments.map((file) => <Pressable key={file.url} onPress={() => open(file.url)}><Text numberOfLines={1} className="text-[15px] text-sky-300">{file.title}</Text></Pressable>)}
      </Row>}
      {!source && reminders.length > 0 && <Row Icon={Bell}>
        {reminders.map((reminder, index) => <Text key={index} className="text-[15px] text-foreground">{reminderLabel(reminder.minutes, reminder.method)}</Text>)}
      </Row>}
      {calendar && <Row Icon={CalendarDays}>
        <View className="flex-row items-center gap-2"><ColorDot color={calendar.color} /><Text className="text-[15px] text-foreground">{calendar.name}</Text></View>
        {multipleAccounts && !source && <Text className="text-[13px] text-surface-400">{calendar.accountId}</Text>}
        {event.organizer.email && !event.organizer.self && <Text className="text-[13px] text-surface-400">Organized by {event.organizer.name ?? event.organizer.email}</Text>}
      </Row>}
      {!source && (event.visibility === 'private' || event.transparency === 'transparent') && <Row Icon={Lock}>
        <Text className="text-[15px] text-foreground">{[event.visibility === 'private' ? 'Private' : null, event.transparency === 'transparent' ? 'Shows as free' : null].filter(Boolean).join(' · ')}</Text>
      </Row>}
    </View>
    {permissions.reason && !source && <Text className="mt-2 rounded-2xl bg-surface-900 px-4 py-3 text-[14px] leading-5 text-surface-300">{permissions.reason}</Text>}
    {source && <Button variant="secondary" className="mt-3" onPress={() => onOpenSource(event)}>
      <UiText>Open in {source === 'tasks' ? 'Tasks' : source === 'study' ? 'Tasks' : 'Gym'}</UiText>
    </Button>}
    {event.colorId && <Text className="mt-3 text-[12px] text-surface-500">Color: {EVENT_COLORS[event.colorId]?.name ?? 'Custom'}</Text>}
  </BottomSheet>
}
