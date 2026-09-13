import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { CalendarDays, Check, Delete } from 'lucide-react-native'

const ROWS = [['÷', '7', '8', '9'], ['×', '4', '5', '6'], ['-', '1', '2', '3'], ['+', '=', '0', '.']]

/** Keys divide whatever height the screen has left, so the pad never sits marooned mid-screen. */
function Key({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    android_ripple={{ color: 'rgba(255, 255, 255, 0.10)', borderless: false }}
    className="flex-1 items-center justify-center rounded-2xl bg-surface-900 active:bg-surface-800"
  >
    <Text className="text-[26px] font-semibold text-surface-100">{label}</Text>
  </Pressable>
}

function SideKey({ children, onPress, onLongPress, accessibilityLabel, className = '' }: {
  children: React.ReactNode
  onPress: () => void
  onLongPress?: () => void
  accessibilityLabel: string
  className?: string
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    onPress={onPress}
    onLongPress={onLongPress}
    android_ripple={{ color: 'rgba(255, 255, 255, 0.10)', borderless: false }}
    className={`items-center justify-center rounded-2xl ${className}`}
  >{children}</Pressable>
}

export function AmountKeypad({ onKey, onOpenDate, onConfirm, confirmDisabled, confirmColor, busy = false }: {
  onKey: (key: string) => void
  onOpenDate?: () => void
  onConfirm: () => void
  confirmDisabled: boolean
  confirmColor: string
  busy?: boolean
}): React.ReactElement {
  return <View className="flex-1 flex-row gap-2.5 px-4">
    <View className="flex-1 gap-2.5">{ROWS.map((row, index) => <View key={index} className="flex-1 flex-row gap-2.5">
      {row.map((key) => <Key key={key} label={key} onPress={() => onKey(key)} />)}
    </View>)}</View>
    <View className="w-[21%] gap-2.5">
      <SideKey
        accessibilityLabel="Delete the last digit"
        onPress={() => onKey('back')}
        onLongPress={() => onKey('clear')}
        className="flex-1 bg-surface-900 active:bg-surface-800"
      ><Delete color="#b5b5bc" size={22} /></SideKey>
      {onOpenDate
        ? <SideKey accessibilityLabel="Choose a date" onPress={onOpenDate} className="flex-1 bg-surface-900 active:bg-surface-800">
          <CalendarDays color="#b5b5bc" size={22} />
        </SideKey>
        : <SideKey accessibilityLabel="Clear the amount" onPress={() => onKey('clear')} className="flex-1 bg-surface-900 active:bg-surface-800">
          <Text className="text-[22px] font-semibold text-surface-300">C</Text>
        </SideKey>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save transaction"
        accessibilityState={{ disabled: confirmDisabled }}
        disabled={confirmDisabled}
        onPress={onConfirm}
        style={{ flex: 2, backgroundColor: confirmDisabled ? '#232426' : confirmColor }}
        className="items-center justify-center rounded-2xl"
      >
        {busy ? <ActivityIndicator color="#e6e6e8" /> : <Check color={confirmDisabled ? '#707078' : '#fff'} size={30} strokeWidth={2.5} />}
      </Pressable>
    </View>
  </View>
}
