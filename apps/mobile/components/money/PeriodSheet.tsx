import React, { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CalendarDays } from 'lucide-react-native'
import type { DateRange } from '@ego/core'
import { formatIso, isoToday } from '../../lib/dates'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'
import { BottomSheet } from './Common'
import { CalendarDialog } from './DatePicker'

function Edge({ label, value, placeholder, onPress }: {
  label: string
  value: string | null
  placeholder: string
  onPress: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${value ? formatIso(value) : placeholder}`}
    onPress={onPress}
    className="min-h-[76px] flex-1 justify-center rounded-2xl border border-input bg-surface-900 px-4 active:bg-surface-800"
  >
    <Text className="text-[14px] text-muted-foreground">{label}</Text>
    <View className="mt-1 flex-row items-center gap-2">
      <CalendarDays color="#d4d4d4" size={16} />
      <Text numberOfLines={1} className={`flex-1 text-[17px] font-semibold ${value ? 'text-foreground' : 'text-surface-500'}`}>{value ? formatIso(value) : placeholder}</Text>
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
  return <BottomSheet visible={visible} title="Custom range" onClose={onClose} dismissOnBackdrop>
    <View className="flex-row gap-3">
      <Edge label="From" value={from} placeholder="Earliest" onPress={() => setEditing('from')} />
      <Edge label="To" value={to} placeholder="Today" onPress={() => setEditing('to')} />
    </View>
    {invalid && <Text className="mt-3 text-[15px] text-destructive">The start date is after the end date.</Text>}
    <View className="mt-5 flex-row gap-3">
      <Button variant="outline" size="lg" onPress={() => { setFrom(null); setTo(null) }} className="flex-1"><UiText>Clear</UiText></Button>
      <Button size="lg" disabled={invalid} onPress={() => onApply({ from, to })} className="flex-1"><UiText>Apply</UiText></Button>
    </View>
    <CalendarDialog
      visible={editing !== null}
      value={(editing === 'from' ? from : to) ?? isoToday()}
      onCancel={() => setEditing(null)}
      onConfirm={(iso) => { if (editing === 'from') setFrom(iso); else setTo(iso); setEditing(null) }}
    />
  </BottomSheet>
}
