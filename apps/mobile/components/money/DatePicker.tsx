import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { CalendarDays, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react-native'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, monthGrid, parseIso, shiftIso } from '../../lib/dates'

function MonthName({ year, month }: { year: number; month: number }): React.ReactElement {
  return <Text className="text-sm text-surface-200">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
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
  const step = (delta: number): void => setCursor(new Date(year, month + delta, 1))
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-6">
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-surface-700 bg-surface-900 p-5">
        <Text className="text-xs text-surface-400">Select day</Text>
        <Text className="mt-2 text-3xl font-light text-surface-100">{formatIso(draft)}</Text>
        <View className="mt-5 flex-row items-center justify-between">
          <MonthName year={year} month={month} />
          <View className="flex-row gap-2">
            <Pressable onPress={() => step(-1)} hitSlop={10} className="h-9 w-9 items-center justify-center rounded-full bg-surface-800"><ChevronLeft color="#d8dbe3" size={18} /></Pressable>
            <Pressable onPress={() => step(1)} hitSlop={10} className="h-9 w-9 items-center justify-center rounded-full bg-surface-800"><ChevronRight color="#d8dbe3" size={18} /></Pressable>
          </View>
        </View>
        <View className="mt-4 flex-row">{WEEKDAYS.map((day, index) => <Text key={index} className="flex-1 text-center text-xs text-surface-500">{day}</Text>)}</View>
        <View className="mt-1">{monthGrid(year, month).map((week, weekIndex) => <View key={weekIndex} className="flex-row">{week.map((day, dayIndex) => {
          if (day === null) return <View key={dayIndex} className="h-11 flex-1" />
          const iso = isoFromParts(year, month, day)
          const selected = iso === draft
          return <Pressable key={dayIndex} onPress={() => setDraft(iso)} className="h-11 flex-1 items-center justify-center">
            <View className={`h-9 w-9 items-center justify-center rounded-full ${selected ? 'bg-accent-600' : iso === isoToday() ? 'border border-surface-600' : ''}`}>
              <Text className={selected ? 'text-sm font-semibold text-white' : 'text-sm text-surface-200'}>{day}</Text>
            </View>
          </Pressable>
        })}</View>)}</View>
        <View className="mt-4 flex-row justify-end gap-2">
          <Pressable onPress={onCancel} className="rounded-xl px-5 py-3"><Text className="text-sm font-semibold text-surface-300">Cancel</Text></Pressable>
          <Pressable onPress={() => onConfirm(draft)} className="rounded-xl bg-accent-600 px-6 py-3"><Text className="text-sm font-semibold text-white">OK</Text></Pressable>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
}

function dayMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function DayTile({ label, detail, active, icon, onPress }: { label: string; detail: string; active: boolean; icon: React.ReactNode; onPress: () => void }): React.ReactElement {
  return <Pressable onPress={onPress} className={`flex-1 items-center rounded-2xl border py-4 ${active ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
    {icon}
    <Text className={`mt-2 text-sm ${active ? 'text-accent-300' : 'text-surface-200'}`}>{label}</Text>
    <Text className="mt-0.5 text-xs text-surface-500">{detail}</Text>
  </Pressable>
}

export function DateSheet({ visible, value, onClose, onChange }: { visible: boolean; value: string; onClose: () => void; onChange: (iso: string) => void }): React.ReactElement {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const today = isoToday()
  const yesterday = shiftIso(today, -1)
  const pick = (iso: string): void => { onChange(iso); onClose() }
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 justify-end bg-black/70">
      <Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-3xl border-t border-surface-700 bg-surface-950 px-5 pb-10 pt-5">
        <Text className="mb-4 text-center text-base font-semibold text-surface-100">Date</Text>
        <Pressable onPress={() => setCalendarOpen(true)} className="items-center rounded-2xl border border-surface-800 bg-surface-900 py-5">
          <CalendarDays color="#d8dbe3" size={22} />
          <Text className="mt-2 text-sm text-surface-200">Select day</Text>
        </Pressable>
        <View className="mt-3 flex-row gap-3">
          <DayTile label="Yesterday" detail={dayMonth(yesterday)} active={value === yesterday} icon={<Moon color="#d8dbe3" size={20} />} onPress={() => pick(yesterday)} />
          <DayTile label="Today" detail={dayMonth(today)} active={value === today} icon={<Sun color="#d8dbe3" size={20} />} onPress={() => pick(today)} />
        </View>
        <CalendarDialog visible={calendarOpen} value={value} onCancel={() => setCalendarOpen(false)} onConfirm={(iso) => { setCalendarOpen(false); pick(iso) }} />
      </Pressable>
    </Pressable>
  </Modal>
}
