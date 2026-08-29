import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { CalendarDays, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react-native'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, monthGrid, parseIso, shiftIso } from '../../lib/dates'

function MonthName({ year, month }: { year: number; month: number }): React.ReactElement {
  return <Text className="text-[13px] font-semibold text-surface-100">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
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
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-surface-700 bg-surface-900 p-4">
        <Text className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Select day</Text>
        <Text className="mt-1 text-[19px] font-bold text-surface-100">{formatIso(draft)}</Text>
        <View className="mt-3 flex-row items-center justify-between">
          <MonthName year={year} month={month} />
          <View className="flex-row gap-2">
            <Pressable onPress={() => step(-1)} hitSlop={10} className="h-8 w-8 items-center justify-center rounded-full bg-surface-800"><ChevronLeft color="#e6e6e8" size={16} /></Pressable>
            <Pressable onPress={() => step(1)} hitSlop={10} className="h-8 w-8 items-center justify-center rounded-full bg-surface-800"><ChevronRight color="#e6e6e8" size={16} /></Pressable>
          </View>
        </View>
        <View className="mt-3 flex-row">{WEEKDAYS.map((day, index) => <Text key={index} className="flex-1 text-center text-[11px] font-medium text-surface-500">{day}</Text>)}</View>
        <View className="mt-1">{monthGrid(year, month).map((week, weekIndex) => <View key={weekIndex} className="flex-row">{week.map((day, dayIndex) => {
          if (day === null) return <View key={dayIndex} className="h-9 flex-1" />
          const iso = isoFromParts(year, month, day)
          const selected = iso === draft
          return <Pressable key={dayIndex} onPress={() => setDraft(iso)} className="h-9 flex-1 items-center justify-center">
            <View className={`h-7 w-7 items-center justify-center rounded-full ${selected ? 'bg-accent-600' : iso === isoToday() ? 'border border-surface-600' : ''}`}>
              <Text className={selected ? 'text-[12px] font-semibold text-white' : 'text-[12px] text-surface-200'}>{day}</Text>
            </View>
          </Pressable>
        })}</View>)}</View>
        <View className="mt-3 flex-row justify-end gap-2">
          <Pressable onPress={onCancel} className="rounded-lg px-4 py-2.5"><Text className="text-[13px] font-semibold text-surface-300">Cancel</Text></Pressable>
          <Pressable onPress={() => onConfirm(draft)} className="rounded-lg bg-accent-600 px-5 py-2.5"><Text className="text-[13px] font-semibold text-white">OK</Text></Pressable>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
}

function dayMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function DayTile({ label, detail, active, icon, onPress }: { label: string; detail: string; active: boolean; icon: React.ReactNode; onPress: () => void }): React.ReactElement {
  return <Pressable onPress={onPress} className={`flex-1 items-center rounded-xl border py-3.5 ${active ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
    {icon}
    <Text className={`mt-2 text-[13px] font-semibold ${active ? 'text-accent-300' : 'text-surface-100'}`}>{label}</Text>
    <Text className="mt-0.5 text-[11px] text-surface-400">{detail}</Text>
  </Pressable>
}

export function DateSheet({ visible, value, onClose, onChange }: { visible: boolean; value: string; onClose: () => void; onChange: (iso: string) => void }): React.ReactElement {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const today = isoToday()
  const yesterday = shiftIso(today, -1)
  const pick = (iso: string): void => { onChange(iso); onClose() }
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 justify-end bg-black/70">
      <Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-2xl border-t border-surface-700 bg-surface-950 px-4 pb-8 pt-4">
        <Text className="mb-3 text-center text-[15px] font-bold text-surface-100">Date</Text>
        <Pressable onPress={() => setCalendarOpen(true)} className="items-center rounded-xl border border-surface-800 bg-surface-900 py-4">
          <CalendarDays color="#e6e6e8" size={20} />
          <Text className="mt-2 text-[13px] font-semibold text-surface-100">Select day</Text>
        </Pressable>
        <View className="mt-2 flex-row gap-2">
          <DayTile label="Yesterday" detail={dayMonth(yesterday)} active={value === yesterday} icon={<Moon color="#e6e6e8" size={18} />} onPress={() => pick(yesterday)} />
          <DayTile label="Today" detail={dayMonth(today)} active={value === today} icon={<Sun color="#e6e6e8" size={18} />} onPress={() => pick(today)} />
        </View>
        <CalendarDialog visible={calendarOpen} value={value} onCancel={() => setCalendarOpen(false)} onConfirm={(iso) => { setCalendarOpen(false); pick(iso) }} />
      </Pressable>
    </Pressable>
  </Modal>
}
