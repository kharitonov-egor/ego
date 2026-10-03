import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronRight, Plus, Video, X } from 'lucide-react-native'
import type { CalendarEvent, CalendarEventDraft, CalendarInfo } from '@ego/api-contracts'
import {
  EVENT_COLORS, WEEKDAY_CODES, WEEKDAY_NAMES, describeRecurrence, recurrencePresets, type RecurrenceFrequency, type RecurrenceRule
} from '@ego/core'
import { REMINDER_CHOICES, descriptionText, draftProblem, isWritable, lastDayOf, reminderLabel, withAllDay, withStart } from '@ego/local/calendar/draft'
import { atClock, clockLabel, clockValue, localDayOf } from '@ego/local/calendar/layout'
import { defaultRule, monthlyChoices, presetOf, ruleOf, untilDay, untilFor, withRule } from '@ego/local/calendar/recurrence'
import { formatIso, parseIso, shiftIso } from '@ego/local/dates'
import { KeyboardViewport } from '../ui/keyboard'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { SegmentedControl } from '../ui/segmented-control'
import { ColorDot } from './ui'

const TIMES = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`)
const FREQUENCIES: ReadonlyArray<{ value: RecurrenceFrequency; label: string }> = [
  { value: 'DAILY', label: 'Day' }, { value: 'WEEKLY', label: 'Week' }, { value: 'MONTHLY', label: 'Month' }, { value: 'YEARLY', label: 'Year' }
]

function clockText(clock: string): string {
  return clockLabel(atClock('2026-01-05', clock))
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (on: boolean) => void }): React.ReactElement {
  return <View className="min-h-14 flex-row items-center border-b border-surface-900">
    <Text className="flex-1 text-[17px] text-foreground">{label}</Text>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange}
      trackColor={{ false: '#404040', true: '#fafafa' }} thumbColor={value ? '#0a0a0a' : '#d4d4d4'} ios_backgroundColor="#404040" />
  </View>
}

function LinkRow({ label, value, onPress, children }: { label: string; value?: string; onPress: () => void; children?: React.ReactNode }): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="min-h-14 flex-row items-center gap-3 border-b border-surface-900 active:bg-surface-900">
    {children}
    <Text className="text-[17px] text-foreground">{label}</Text>
    <Text numberOfLines={1} className="ml-auto max-w-[60%] text-right text-[16px] text-surface-300">{value}</Text>
    <ChevronRight color="#737373" size={18} />
  </Pressable>
}

/** A list of times every 15 minutes, opened at the current one, since the app has no native time picker. */
function TimeSheet({ visible, value, onPick, onClose }: { visible: boolean; value: string; onPick: (clock: string) => void; onClose: () => void }): React.ReactElement {
  const list = useRef<ScrollView>(null)
  const index = Math.max(0, TIMES.findIndex((clock) => clock >= value))
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => list.current?.scrollTo({ y: Math.max(0, index - 3) * 52, animated: false }), 50)
    return () => clearTimeout(timer)
  }, [index, visible])
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-black/80 px-8">
      <Pressable onPress={(event) => event.stopPropagation()} className="max-h-[70%] w-full max-w-sm rounded-3xl border border-surface-800 bg-card py-2">
        <ScrollView ref={list}>
          {!TIMES.includes(value) && <Pressable onPress={() => onPick(value)} className="h-[52px] justify-center px-6"><Text className="text-[17px] font-bold text-foreground">{clockText(value)}</Text></Pressable>}
          {TIMES.map((clock) => <Pressable key={clock} accessibilityRole="button" onPress={() => onPick(clock)} className={`h-[52px] justify-center px-6 active:bg-surface-800 ${clock === value ? 'bg-surface-800' : ''}`}>
            <Text className={`text-[17px] ${clock === value ? 'font-bold text-foreground' : 'text-surface-200'}`}>{clockText(clock)}</Text>
          </Pressable>)}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    className={`min-h-10 items-center justify-center rounded-full border px-4 ${selected ? 'border-white bg-white' : 'border-surface-700 active:bg-surface-800'}`}>
    <Text className={`text-[15px] font-medium ${selected ? 'text-black' : 'text-surface-200'}`}>{label}</Text>
  </Pressable>
}

/** Google's repeat choices, with the custom rule builder underneath. */
function RepeatSheet({ visible, draft, startDay, onChange, onClose }: {
  visible: boolean
  draft: CalendarEventDraft
  startDay: string
  onChange: (recurrence: string[]) => void
  onClose: () => void
}): React.ReactElement {
  const presets = recurrencePresets(startDay)
  const preset = presetOf(draft.recurrence, startDay)
  const [custom, setCustom] = useState(preset === 'custom')
  const [until, setUntil] = useState(false)
  useEffect(() => { if (visible) setCustom(preset === 'custom') }, [visible])
  const rule = ruleOf(draft.recurrence) ?? defaultRule(startDay)
  const setRule = (next: RecurrenceRule): void => onChange(withRule(draft.recurrence, next))
  const monthly = monthlyChoices(startDay)
  const endDay = rule.end.kind === 'until' ? untilDay(rule.end.until) : shiftIso(startDay, 90)
  return <BottomSheet visible={visible} title="Repeat" onClose={onClose}>
    {presets.map((item) => <Pressable key={item.preset} onPress={() => { setCustom(false); onChange(item.lines); onClose() }}
      className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900">
      <Text className="flex-1 text-[17px] text-foreground">{item.label}</Text>
      {!custom && preset === item.preset && <Check color="#fafafa" size={18} />}
    </Pressable>)}
    <Pressable onPress={() => { setCustom(true); if (!ruleOf(draft.recurrence)) setRule(defaultRule(startDay)) }} className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900">
      <Text className="flex-1 text-[17px] text-foreground">Custom</Text>
      {custom && <Check color="#fafafa" size={18} />}
    </Pressable>
    {custom && <View className="mt-3 gap-3">
      <View className="flex-row items-center gap-3">
        <Text className="text-[16px] text-foreground">Every</Text>
        <TextInput value={String(rule.interval)} keyboardType="number-pad" maxLength={2} selectTextOnFocus accessibilityLabel="Repeat every"
          onChangeText={(text) => setRule({ ...rule, interval: Math.max(1, Number(text.replace(/\D/g, '')) || 1) })}
          className={`${inputClass} w-16 text-center`} />
        <SegmentedControl className="flex-1" options={FREQUENCIES.map((item) => ({ value: item.value, label: item.label }))} value={rule.frequency}
          onValueChange={(frequency) => setRule({ ...rule, frequency, weekdays: [], monthly: null })} />
      </View>
      {rule.frequency === 'WEEKLY' && <View className="flex-row justify-between">
        {[1, 2, 3, 4, 5, 6, 0].map((index) => {
          const code = WEEKDAY_CODES[index]
          const current = rule.weekdays.length > 0 ? rule.weekdays : [WEEKDAY_CODES[parseIso(startDay).getDay()]]
          const on = current.includes(code)
          return <Pressable key={code} accessibilityRole="button" accessibilityLabel={WEEKDAY_NAMES[code]} accessibilityState={{ selected: on }}
            onPress={() => {
              const next = on ? current.filter((day) => day !== code) : [...current, code]
              if (next.length > 0) setRule({ ...rule, weekdays: next })
            }}
            className={`h-10 w-10 items-center justify-center rounded-full ${on ? 'bg-white' : 'bg-surface-800'}`}>
            <Text className={`text-[14px] font-semibold ${on ? 'text-black' : 'text-surface-300'}`}>{WEEKDAY_NAMES[code].charAt(0)}</Text>
          </Pressable>
        })}
      </View>}
      {rule.frequency === 'MONTHLY' && <View className="flex-row flex-wrap gap-2">
        {monthly.map((item) => <Chip key={item.kind} label={item.label} selected={(rule.monthly?.kind ?? 'day') === item.kind} onPress={() => setRule({ ...rule, monthly: item.rule })} />)}
      </View>}
      <Text className="mt-1 text-[14px] font-semibold text-surface-400">Ends</Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Never" selected={rule.end.kind === 'never'} onPress={() => setRule({ ...rule, end: { kind: 'never' } })} />
        <Chip label={rule.end.kind === 'until' ? `On ${formatIso(endDay)}` : 'On a date'} selected={rule.end.kind === 'until'} onPress={() => setUntil(true)} />
        <Chip label={rule.end.kind === 'count' ? `After ${rule.end.count} times` : 'After N times'} selected={rule.end.kind === 'count'}
          onPress={() => setRule({ ...rule, end: { kind: 'count', count: rule.end.kind === 'count' ? rule.end.count : 10 } })} />
      </View>
      {rule.end.kind === 'count' && <View className="flex-row items-center gap-3">
        <TextInput value={String(rule.end.count)} keyboardType="number-pad" maxLength={3} selectTextOnFocus accessibilityLabel="Occurrences"
          onChangeText={(text) => setRule({ ...rule, end: { kind: 'count', count: Math.max(1, Number(text.replace(/\D/g, '')) || 1) } })}
          className={`${inputClass} w-20 text-center`} />
        <Text className="text-[16px] text-foreground">occurrences</Text>
      </View>}
      <Text className="text-[14px] text-surface-400">{describeRecurrence(draft.recurrence, startDay)}</Text>
    </View>}
    <CalendarDialog visible={until} value={endDay} onCancel={() => setUntil(false)} onConfirm={(day) => {
      setUntil(false)
      setRule({ ...rule, end: { kind: 'until', until: untilFor(day, draft.allDay) } })
    }} />
  </BottomSheet>
}

export interface EditorResult {
  calendar: CalendarInfo
  before: CalendarEventDraft
  after: CalendarEventDraft
}

type Picker = 'startDay' | 'endDay' | 'startTime' | 'endTime' | 'repeat' | 'calendar' | 'reminder' | null

/** The full event editor, as a page over the calendar. */
export function EventEditor({ event, initial, calendars, defaultCalendar, offline, onClose, onSave }: {
  event: CalendarEvent | null
  initial: CalendarEventDraft
  calendars: readonly CalendarInfo[]
  defaultCalendar: CalendarInfo | null
  offline: boolean
  onClose: () => void
  onSave: (result: EditorResult) => Promise<boolean>
}): React.ReactElement {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState(initial)
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null)
  const [calendarKey, setCalendarKey] = useState(defaultCalendar?.key ?? '')
  const [guest, setGuest] = useState('')
  const [picker, setPicker] = useState<Picker>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const writable = useMemo(() => calendars.filter((item) => isWritable(item) && (!event || item.accountId === event.accountId)), [calendars, event])
  const calendar = writable.find((item) => item.key === calendarKey) ?? defaultCalendar
  const startDay = draft.allDay ? draft.start : localDayOf(draft.start)
  const endDay = draft.allDay ? lastDayOf(draft) : localDayOf(draft.end)
  const repeatLabel = describeRecurrence(draft.recurrence, startDay) ?? 'Does not repeat'
  const hasCall = Boolean(event?.conference) && draft.meet !== false
  const set = (patch: Partial<CalendarEventDraft>): void => setDraft((current) => ({ ...current, ...patch }))

  const addGuest = (): void => {
    const emails = guest.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)
    const known = new Set(draft.attendees.map((person) => person.email.toLowerCase()))
    if (emails.length > 0) set({ attendees: [...draft.attendees, ...emails.filter((email) => !known.has(email.toLowerCase())).map((email) => ({ email, optional: false }))] })
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

  return <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardViewport active style={{ backgroundColor: '#0a0a0a' }}>
      <View className="flex-row items-center gap-2 border-b border-surface-900 px-3 pb-2" style={{ paddingTop: insets.top + 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"><X color="#fafafa" size={22} /></Pressable>
        <Text className="flex-1 text-[18px] font-bold text-foreground">{event ? 'Edit event' : 'New event'}</Text>
        <Pressable accessibilityRole="button" disabled={saving || offline} onPress={() => void save()}
          className={`min-h-11 justify-center rounded-full bg-white px-5 active:bg-white/85 ${saving || offline ? 'opacity-40' : ''}`}>
          <Text className="text-[16px] font-semibold text-black">{saving ? 'Saving' : 'Save'}</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {problem && <Text className="mt-3 rounded-2xl bg-destructive/15 px-4 py-3 text-[15px] text-destructive">{problem}</Text>}
        {offline && <Text className="mt-3 rounded-2xl bg-surface-900 px-4 py-3 text-[15px] text-attention">Offline. Calendar is view-only until the connection is back.</Text>}
        <TextInput value={draft.title} onChangeText={(title) => set({ title })} placeholder="Add title" placeholderTextColor="#737373" autoFocus={!event}
          maxLength={1024} className="mt-3 min-h-14 text-[24px] font-semibold text-foreground" />

        <SwitchRow label="All day" value={draft.allDay} onChange={(on) => setDraft(withAllDay(draft, on))} />
        <View className="min-h-14 flex-row items-center border-b border-surface-900">
          <Pressable onPress={() => setPicker('startDay')} className="flex-1 py-3"><Text className="text-[17px] text-foreground">{formatIso(startDay)}</Text></Pressable>
          {!draft.allDay && <Pressable onPress={() => setPicker('startTime')} className="py-3 pl-4"><Text className="text-[17px] text-foreground">{clockLabel(draft.start)}</Text></Pressable>}
        </View>
        <View className="min-h-14 flex-row items-center border-b border-surface-900">
          <Pressable onPress={() => setPicker('endDay')} className="flex-1 py-3"><Text className="text-[17px] text-foreground">{formatIso(endDay)}</Text></Pressable>
          {!draft.allDay && <Pressable onPress={() => setPicker('endTime')} className="py-3 pl-4"><Text className="text-[17px] text-foreground">{clockLabel(draft.end)}</Text></Pressable>}
        </View>
        {!draft.allDay && draft.timeZone && <Text className="pt-1 text-[13px] text-surface-500">{draft.timeZone.replace(/_/g, ' ')}</Text>}
        <LinkRow label="Repeat" value={repeatLabel} onPress={() => setPicker('repeat')} />
        <LinkRow label="Calendar" value={calendar?.name} onPress={() => setPicker('calendar')}>
          {calendar && <ColorDot color={calendar.color} size={12} />}
        </LinkRow>

        <Text className="mb-2 mt-5 text-[14px] font-semibold text-surface-400">Color</Text>
        <View className="flex-row flex-wrap gap-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Calendar color" onPress={() => set({ colorId: null })}
            className={`h-9 w-9 items-center justify-center rounded-full ${draft.colorId === null ? 'border-2 border-white' : ''}`}>
            <ColorDot color={calendar?.color ?? '#039be5'} size={26} />
          </Pressable>
          {Object.entries(EVENT_COLORS).map(([id, named]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={named.name} onPress={() => set({ colorId: id })}
            className={`h-9 w-9 items-center justify-center rounded-full ${draft.colorId === id ? 'border-2 border-white' : ''}`}>
            <ColorDot color={named.hex} size={26} />
          </Pressable>)}
        </View>

        <TextInput value={draft.location ?? ''} onChangeText={(location) => set({ location: location || null })} placeholder="Add location" placeholderTextColor="#737373"
          maxLength={1024} className={`${inputClass} mt-5`} />

        {(calendar?.meet || hasCall) && <View className="mt-3 flex-row items-center gap-3">
          <Video color="#a3a3a3" size={19} />
          {hasCall || draft.meet === true
            ? <>
              <Text className="flex-1 text-[15px] text-foreground">{draft.meet === true ? 'A Google Meet link is added when you save' : `${event?.conference?.name ?? 'Video call'} attached`}</Text>
              <Pressable onPress={() => set({ meet: event?.conference ? false : null })} hitSlop={6}><Text className="text-[15px] font-semibold text-sky-300">Remove</Text></Pressable>
            </>
            : <Pressable onPress={() => set({ meet: true })} hitSlop={6}><Text className="text-[16px] font-semibold text-sky-300">Add Google Meet video conferencing</Text></Pressable>}
        </View>}

        <Text className="mb-2 mt-6 text-[14px] font-semibold text-surface-400">Guests</Text>
        <View className="flex-row gap-2">
          <TextInput value={guest} onChangeText={setGuest} onSubmitEditing={addGuest} editable={!event?.attendeesOmitted} autoCapitalize="none" keyboardType="email-address"
            placeholder={event?.attendeesOmitted ? 'Google hides this guest list' : 'Add guests by email'} placeholderTextColor="#737373" className={`${inputClass} flex-1`} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add guest" onPress={addGuest} className="h-[52px] w-[52px] items-center justify-center rounded-xl bg-surface-800 active:bg-surface-700"><Plus color="#fafafa" size={20} /></Pressable>
        </View>
        {draft.attendees.map((person) => <View key={person.email} className="min-h-12 flex-row items-center gap-2 border-b border-surface-900">
          <Text numberOfLines={1} className="flex-1 text-[16px] text-foreground">{person.email}</Text>
          <Pressable onPress={() => set({ attendees: draft.attendees.map((item) => item.email === person.email ? { ...item, optional: !item.optional } : item) })} hitSlop={6}>
            <Text className={`text-[13px] ${person.optional ? 'font-semibold text-foreground' : 'text-surface-500'}`}>Optional</Text>
          </Pressable>
          <Pressable accessibilityLabel={`Remove ${person.email}`} onPress={() => set({ attendees: draft.attendees.filter((item) => item.email !== person.email) })} hitSlop={8} className="p-2"><X color="#a3a3a3" size={17} /></Pressable>
        </View>)}
        {draft.attendees.length > 0 && <>
          <SwitchRow label="Guests can modify event" value={draft.guestsCanModify} onChange={(guestsCanModify) => set({ guestsCanModify })} />
          <SwitchRow label="Guests can invite others" value={draft.guestsCanInviteOthers} onChange={(guestsCanInviteOthers) => set({ guestsCanInviteOthers })} />
          <SwitchRow label="Guests can see the guest list" value={draft.guestsCanSeeOtherGuests} onChange={(guestsCanSeeOtherGuests) => set({ guestsCanSeeOtherGuests })} />
        </>}

        <Text className="mb-1 mt-6 text-[14px] font-semibold text-surface-400">Notifications</Text>
        <SwitchRow label="Use the calendar's notifications" value={draft.reminders.useDefault}
          onChange={(on) => set({ reminders: { useDefault: on, overrides: on ? [] : calendar?.defaultReminders ?? [] } })} />
        {!draft.reminders.useDefault && draft.reminders.overrides.map((reminder, index) => <View key={index} className="min-h-12 flex-row items-center border-b border-surface-900">
          <Text className="flex-1 text-[16px] text-foreground">{reminderLabel(reminder.minutes, reminder.method)}</Text>
          <Pressable accessibilityLabel="Remove notification" onPress={() => set({ reminders: { useDefault: false, overrides: draft.reminders.overrides.filter((_, at) => at !== index) } })} hitSlop={8} className="p-2"><X color="#a3a3a3" size={17} /></Pressable>
        </View>)}
        {!draft.reminders.useDefault && draft.reminders.overrides.length < 5 && <Pressable onPress={() => setPicker('reminder')} className="min-h-12 justify-center">
          <Text className="text-[16px] font-semibold text-sky-300">Add notification</Text>
        </Pressable>}

        <Text className="mb-2 mt-6 text-[14px] font-semibold text-surface-400">Show as</Text>
        <SegmentedControl options={[{ value: 'opaque', label: 'Busy' }, { value: 'transparent', label: 'Free' }]} value={draft.transparency} onValueChange={(transparency) => set({ transparency })} />
        <Text className="mb-2 mt-4 text-[14px] font-semibold text-surface-400">Visibility</Text>
        <SegmentedControl options={[{ value: 'default', label: 'Default' }, { value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]}
          value={draft.visibility === 'confidential' ? 'private' : draft.visibility} onValueChange={(visibility) => set({ visibility })} />

        <TextInput value={descriptionDraft ?? descriptionText(draft.description)} onChangeText={setDescriptionDraft} placeholder="Add description" placeholderTextColor="#737373"
          multiline textAlignVertical="top" maxLength={8000} className={`${inputClass} mt-6 min-h-[140px]`} />
      </ScrollView>
    </KeyboardViewport>

    <CalendarDialog visible={picker === 'startDay'} value={startDay} onCancel={() => setPicker(null)} onConfirm={(day) => {
      setPicker(null)
      setDraft(withStart(draft, draft.allDay ? day : atClock(day, clockValue(draft.start))))
    }} />
    <CalendarDialog visible={picker === 'endDay'} value={endDay} onCancel={() => setPicker(null)} onConfirm={(day) => {
      setPicker(null)
      set({ end: draft.allDay ? shiftIso(day, 1) : atClock(day, clockValue(draft.end)) })
    }} />
    <TimeSheet visible={picker === 'startTime'} value={draft.allDay ? '09:00' : clockValue(draft.start)} onClose={() => setPicker(null)} onPick={(clock) => {
      setPicker(null)
      setDraft(withStart(draft, atClock(startDay, clock)))
    }} />
    <TimeSheet visible={picker === 'endTime'} value={draft.allDay ? '10:00' : clockValue(draft.end)} onClose={() => setPicker(null)} onPick={(clock) => {
      setPicker(null)
      set({ end: atClock(endDay, clock) })
    }} />
    <RepeatSheet visible={picker === 'repeat'} draft={draft} startDay={startDay} onChange={(recurrence) => set({ recurrence })} onClose={() => setPicker(null)} />
    <BottomSheet visible={picker === 'calendar'} title="Calendar" onClose={() => setPicker(null)} dismissOnBackdrop>
      {[...new Set(writable.map((item) => item.accountId))].map((account) => <View key={account}>
        <Text className="mt-2 text-[13px] font-semibold text-surface-400">{account}</Text>
        {writable.filter((item) => item.accountId === account).map((item) => <Pressable key={item.key} onPress={() => { setCalendarKey(item.key); setPicker(null) }}
          className="min-h-14 flex-row items-center gap-3 border-b border-surface-900 active:bg-surface-900">
          <ColorDot color={item.color} size={14} />
          <Text className="flex-1 text-[17px] text-foreground">{item.name}</Text>
          {item.key === calendar?.key && <Check color="#fafafa" size={18} />}
        </Pressable>)}
      </View>)}
    </BottomSheet>
    <BottomSheet visible={picker === 'reminder'} title="Add notification" onClose={() => setPicker(null)} dismissOnBackdrop>
      {REMINDER_CHOICES.map((choice) => <Pressable key={choice.minutes} onPress={() => {
        setPicker(null)
        set({ reminders: { useDefault: false, overrides: [...draft.reminders.overrides, { method: 'popup', minutes: choice.minutes }] } })
      }} className="min-h-14 justify-center border-b border-surface-900 active:bg-surface-900"><Text className="text-[17px] text-foreground">{choice.label}</Text></Pressable>)}
    </BottomSheet>
  </Modal>
}
