import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { CalendarDays, Check, Delete } from 'lucide-react-native'

const ROWS = [['÷', '7', '8', '9'], ['×', '4', '5', '6'], ['-', '1', '2', '3'], ['+', '=', '0', '.']]

function Key({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="h-14 flex-1 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900/70 active:bg-surface-800">
    <Text className="text-3xl font-semibold text-surface-100">{label}</Text>
  </Pressable>
}

function SideKey({ children, onPress, onLongPress, className = '' }: { children: React.ReactNode; onPress: () => void; onLongPress?: () => void; className?: string }): React.ReactElement {
  return <Pressable onPress={onPress} onLongPress={onLongPress} className={`items-center justify-center rounded-2xl ${className}`}>{children}</Pressable>
}

export function AmountKeypad({ onKey, onOpenDate, onConfirm, confirmDisabled, confirmColor, busy = false }: { onKey: (key: string) => void; onOpenDate?: () => void; onConfirm: () => void; confirmDisabled: boolean; confirmColor: string; busy?: boolean }): React.ReactElement {
  return <View className="flex-row gap-2 px-4">
    <View className="flex-1 gap-2">{ROWS.map((row, index) => <View key={index} className="flex-row gap-2">{row.map((key) => <Key key={key} label={key} onPress={() => onKey(key)} />)}</View>)}</View>
    <View className="w-[19%] gap-2">
      <SideKey onPress={() => onKey('back')} onLongPress={() => onKey('clear')} className="h-14 border border-surface-800 bg-surface-900/60 active:bg-surface-800"><Delete color="#b5b5bc" size={22} /></SideKey>
      {onOpenDate
        ? <SideKey onPress={onOpenDate} className="h-14 border border-surface-800 bg-surface-900/60 active:bg-surface-800"><CalendarDays color="#b5b5bc" size={26} /></SideKey>
        : <SideKey onPress={() => onKey('clear')} className="h-14 border border-surface-800 bg-surface-900/60 active:bg-surface-800"><Text className="text-2xl font-semibold text-surface-300">C</Text></SideKey>}
      <Pressable disabled={confirmDisabled} onPress={onConfirm} style={{ backgroundColor: confirmDisabled ? '#2a2a2f' : confirmColor }} className="flex-1 items-center justify-center rounded-2xl">
        {busy ? <ActivityIndicator color="#b5b5bc" /> : <Check color={confirmDisabled ? '#707078' : '#fff'} size={32} />}
      </Pressable>
    </View>
  </View>
}
