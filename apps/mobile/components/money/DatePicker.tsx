import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { CalendarDays, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react-native'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, monthGrid, parseIso, shiftIso } from '../../lib/dates'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { BottomSheet, inputClass } from './Common'

function MonthName({ year, month }: { year: number; month: number }): React.ReactElement {
  return <Text className="text-[17px] font-semibold text-foreground">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
}

export function CalendarDialog({ visible, value, onCancel, onConfirm }: { visible: boolean; value: string; onCancel: () => void; onConfirm: (iso: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const [cursor, setCursor] = useState(() => parseIso(value))
  useEffect(() => {
    if (!visible) return
    setDraft(value)
    setCursor(parseIso(value))
  }, [value, visible])
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const today = isoToday()
  const step = (delta: number): void => setCursor(new Date(year, month + delta, 1))
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-5">
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-surface-800 bg-card p-5">
        <Text className="text-[15px] font-medium text-muted-foreground">Select a day</Text>
        <Text className="mt-1 text-[24px] font-bold text-foreground">{formatIso(draft)}</Text>
        <View className="mt-4 flex-row items-center justify-between">
          <MonthName year={year} month={month} />
          <View className="flex-row gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => step(-1)} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-800 active:bg-surface-700"><ChevronLeft color="#fafafa" size={19} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => step(1)} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-800 active:bg-surface-700"><ChevronRight color="#fafafa" size={19} /></Pressable>
          </View>
        </View>
        <View className="mt-4 flex-row">{WEEKDAYS.map((day, index) => <Text key={index} className="flex-1 text-center text-[14px] font-medium text-muted-foreground">{day}</Text>)}</View>
        <View className="mt-1">{monthGrid(year, month).map((week, weekIndex) => <View key={weekIndex} className="flex-row">{week.map((day, dayIndex) => {
          if (day === null) return <View key={dayIndex} className="h-12 flex-1" />
          const iso = isoFromParts(year, month, day)
          const selected = iso === draft
          return <Pressable key={dayIndex} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={parseIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} onPress={() => setDraft(iso)} className="h-12 flex-1 items-center justify-center">
            <View className={`h-10 w-10 items-center justify-center rounded-full ${selected ? 'bg-primary' : iso === today ? 'border border-surface-500' : ''}`}>
              <Text className={selected ? 'text-[16px] font-bold text-primary-foreground' : 'text-[16px] text-surface-100'}>{day}</Text>
            </View>
          </Pressable>
        })}</View>)}</View>
        <View className="mt-4 flex-row gap-3">
          <Button variant="outline" onPress={onCancel} className="flex-1"><UiText>Cancel</UiText></Button>
          <Button onPress={() => onConfirm(draft)} className="flex-1"><UiText>Done</UiText></Button>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
}

/** A form field that shows the date in words and opens the calendar, instead of a YYYY-MM-DD text box. */
export function DateField({ value, onChange, label = 'Date' }: { value: string; onChange: (iso: string) => void; label?: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatIso(value)}`}
      onPress={() => setOpen(true)}
      className={`${inputClass} flex-row items-center justify-between active:bg-surface-800`}
    >
      <Text numberOfLines={1} className="flex-1 text-[17px] text-foreground">{formatIso(value)}</Text>
      <CalendarDays color="#a3a3a3" size={18} />
    </Pressable>
    <CalendarDialog visible={open} value={value} onCancel={() => setOpen(false)} onConfirm={(iso) => { onChange(iso); setOpen(false) }} />
  </>
}

function dayMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function DayTile({ label, detail, active, Icon, onPress }: { label: string; detail: string; active: boolean; Icon: typeof Sun; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    className={`flex-1 items-center rounded-2xl border py-5 ${active ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    <Icon color={active ? '#0a0a0a' : '#fafafa'} size={22} />
    <Text className={`mt-2 text-[17px] font-semibold ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</Text>
    <Text className={`mt-0.5 text-[15px] ${active ? 'text-surface-700' : 'text-muted-foreground'}`}>{detail}</Text>
  </Pressable>
}

export function DateSheet({ visible, value, onClose, onChange }: { visible: boolean; value: string; onClose: () => void; onChange: (iso: string) => void }): React.ReactElement {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const today = isoToday()
  const yesterday = shiftIso(today, -1)
  const pick = (iso: string): void => { onChange(iso); onClose() }
  const other = value !== today && value !== yesterday
  return <BottomSheet visible={visible} title="Date" onClose={onClose} dismissOnBackdrop>
    <View className="flex-row gap-3">
      <DayTile label="Yesterday" detail={dayMonth(yesterday)} active={value === yesterday} Icon={Moon} onPress={() => pick(yesterday)} />
      <DayTile label="Today" detail={dayMonth(today)} active={value === today} Icon={Sun} onPress={() => pick(today)} />
    </View>
    <Pressable
      accessibilityRole="button"
      onPress={() => setCalendarOpen(true)}
      className={`mt-3 min-h-14 flex-row items-center justify-center gap-2.5 rounded-2xl border ${other ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
    >
      <CalendarDays color={other ? '#0a0a0a' : '#fafafa'} size={20} />
      <Text className={`text-[17px] font-semibold ${other ? 'text-primary-foreground' : 'text-foreground'}`}>{other ? formatIso(value) : 'Pick another day'}</Text>
    </Pressable>
    <CalendarDialog visible={calendarOpen} value={value} onCancel={() => setCalendarOpen(false)} onConfirm={(iso) => { setCalendarOpen(false); pick(iso) }} />
  </BottomSheet>
}
