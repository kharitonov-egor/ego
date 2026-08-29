import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { CalendarDays } from 'lucide-react-native'
import type { DateRange } from '@ego/core'
import { formatIso, isoToday } from '../../lib/dates'
import { CalendarDialog } from './DatePicker'

function Edge({ label, value, placeholder, onPress }: {
  label: string
  value: string | null
  placeholder: string
  onPress: () => void
}): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 rounded-xl border border-surface-800 bg-surface-900 px-3 py-2.5">
    <Text className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label}</Text>
    <View className="mt-1 flex-row items-center gap-1.5">
      <CalendarDays color="#b5b5bc" size={14} />
      <Text numberOfLines={1} className={`flex-1 text-[13px] font-semibold ${value ? 'text-surface-100' : 'text-surface-500'}`}>{value ? formatIso(value) : placeholder}</Text>
    </View>
  </Pressable>
}

export function CustomPeriodSheet({ visible, value, onClose, onApply }: {
  visible: boolean
  value: DateRange
  onClose: () => void
  onApply: (range: DateRange) => void
}): React.ReactElement {
  const [from, setFrom] = useState<string | null>(value.from)
  const [to, setTo] = useState<string | null>(value.to)
  const [editing, setEditing] = useState<'from' | 'to' | null>(null)
  useEffect(() => {
    if (!visible) return
    setFrom(value.from)
    setTo(value.to)
    setEditing(null)
  }, [value.from, value.to, visible])
  const invalid = Boolean(from && to && from > to)
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 justify-end bg-black/70">
      <Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-2xl border-t border-surface-700 bg-surface-950 px-4 pb-8 pt-4">
        <Text className="mb-3 text-center text-[15px] font-bold text-surface-100">Custom range</Text>
        <View className="flex-row gap-2">
          <Edge label="From" value={from} placeholder="Earliest" onPress={() => setEditing('from')} />
          <Edge label="To" value={to} placeholder="Today" onPress={() => setEditing('to')} />
        </View>
        {invalid && <Text className="mt-2 text-[12px] text-rose-400">The start date is after the end date.</Text>}
        <View className="mt-3 flex-row justify-end gap-2">
          <Pressable accessibilityRole="button" onPress={() => { setFrom(null); setTo(null) }} className="rounded-lg px-3 py-2.5"><Text className="text-[13px] font-semibold text-surface-400">Clear</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} className="rounded-lg px-3 py-2.5"><Text className="text-[13px] font-semibold text-surface-300">Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={invalid} onPress={() => onApply({ from, to })} className={`rounded-lg px-4 py-2.5 ${invalid ? 'bg-surface-800' : 'bg-accent-600'}`}><Text className={`text-[13px] font-semibold ${invalid ? 'text-surface-500' : 'text-white'}`}>Apply</Text></Pressable>
        </View>
        <CalendarDialog
          visible={editing !== null}
          value={(editing === 'from' ? from : to) ?? isoToday()}
          onCancel={() => setEditing(null)}
          onConfirm={(iso) => { if (editing === 'from') setFrom(iso); else setTo(iso); setEditing(null) }}
        />
      </Pressable>
    </Pressable>
  </Modal>
}
