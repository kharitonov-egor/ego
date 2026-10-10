import React from 'react'
import { ActivityIndicator, Pressable, Switch, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Dumbbell, MessageSquare, Trophy, X, type LucideIcon } from 'lucide-react-native'
import type { ExerciseType, GymSetLike, WeightUnit } from '@ego/core'
import { useGym } from '../../lib/gym-context'
import { useLedger } from '../../lib/ledger-context'
import { setParts } from '@ego/local/gym/format'
import { BottomSheet } from '../money/Common'
import { color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Text } from '../ui/text'

/** FitNotes' section heading: small capitals over a rule, drawn in the money palette's gray. */
export function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }): React.ReactElement {
  return <View className="border-b border-border pb-1.5">
    <View className="flex-row items-end justify-between">
      <Text accessibilityRole="header" className="text-[14px] font-bold tracking-wide text-muted-foreground">{children}</Text>
      {right}
    </View>
  </View>
}

export function HeaderIcon({ label, onPress, children }: {
  label: string
  onPress: () => void
  children: React.ReactNode
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={6}
    className="h-10 min-w-10 flex-row items-center justify-center rounded-full px-1 active:bg-surface-800"
  >{children}</Pressable>
}

export function Dot({ color: fill, size = 10 }: { color: string; size?: number }): React.ReactElement {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill }} />
}

/**
 * One set as FitNotes lays it out: values right-aligned in fixed columns so weights and reps line
 * up down the card.
 */
export function SetValues({ set, type, unit, size = 'regular' }: {
  set: GymSetLike
  type: ExerciseType
  unit: WeightUnit
  size?: 'regular' | 'large'
}): React.ReactElement {
  const parts = setParts(set, type, unit)
  const valueClass = size === 'large' ? 'text-[20px] font-bold' : 'text-[18px] font-bold'
  return <View className="flex-row items-baseline">
    {parts.map((part, index) => <View key={part.field} className={`flex-row items-baseline justify-end ${index === parts.length - 1 ? 'w-[92px]' : 'w-[118px]'}`}>
      <Text className={valueClass} style={tabular}>{part.value}</Text>
      {part.unit !== '' && <Text className="ml-1 text-[14px] text-muted-foreground">{part.unit}</Text>}
    </View>)}
  </View>
}

export function SetMarks({ record, comment }: { record: boolean; comment: string }): React.ReactElement | null {
  if (!record && !comment) return null
  return <View className="flex-row items-center gap-1.5">
    {record && <Trophy color={color.attention} size={15} accessibilityLabel="Personal record" />}
    {comment !== '' && <MessageSquare color={color.textMuted} size={14} accessibilityLabel="Has a comment" />}
  </View>
}

export interface MenuItem {
  label: string
  Icon?: LucideIcon
  destructive?: boolean
  disabled?: boolean
  /** Makes the row a switch, which flips in place and leaves the sheet open. */
  checked?: boolean
  onPress: () => void
}

export function MenuSheet({ visible, title, items, onClose }: {
  visible: boolean
  title: string
  items: MenuItem[]
  onClose: () => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title={title} onClose={onClose} dismissOnBackdrop>
    {items.map((item) => <Pressable
      key={item.label}
      accessibilityRole={item.checked === undefined ? 'button' : 'switch'}
      accessibilityState={{ disabled: Boolean(item.disabled), checked: item.checked }}
      disabled={item.disabled}
      onPress={() => {
        if (item.checked === undefined) onClose()
        item.onPress()
      }}
      className={`min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900 ${item.disabled ? 'opacity-40' : ''}`}
    >
      {item.Icon && <item.Icon color={item.destructive ? color.destructive : color.textSecondary} size={20} />}
      <Text className={`ml-3 flex-1 text-[17px] ${item.destructive ? 'text-destructive' : ''}`}>{item.label}</Text>
      {item.checked !== undefined && <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Switch
          value={item.checked}
          trackColor={{ false: '#404040', true: '#fafafa' }}
          thumbColor={item.checked ? '#0a0a0a' : '#d4d4d4'}
          ios_backgroundColor="#404040"
        />
      </View>}
    </Pressable>)}
  </BottomSheet>
}

export function GymError(): React.ReactElement | null {
  const { error, dismissError } = useGym()
  if (!error) return null
  return <Pressable accessibilityRole="button" accessibilityHint="Dismisses this message" onPress={dismissError} className="min-h-11 flex-row items-center gap-2 bg-red-500/10 px-4 py-2">
    <Text className="flex-1 text-[14px] leading-5 text-red-300">{error}</Text>
    <X color="#fca5a5" size={16} />
  </Pressable>
}

function Centered({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <Dumbbell color={color.textFaint} size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

/** Shows the gym screens once the local copy is readable, and says why when it is not. */
export function GymGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  if (!ledger.enabled) {
    return <Centered title="Sign in to see your workouts" detail="Sign in once with Google on the start screen." action="Go to sign in" onAction={() => router.dismissTo('/')} />
  }
  if (ledger.error) return <Centered title="This phone cannot open its log" detail={ledger.error} />
  if (!ledger.current) {
    const stopped = Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <Centered title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
    }
    if (stopped) {
      return <Centered
        title={ledger.status?.state === 'offline' ? 'Waiting for a connection' : 'The download did not finish'}
        detail={ledger.status?.state === 'offline'
          ? 'The first download needs the internet. After that, the gym log works offline.'
          : ledger.status?.message ?? 'Try again in a moment.'}
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator color={color.text} />
      <Text className="mt-3 text-[14px] text-muted-foreground">Downloading your workouts</Text>
    </View>
  }
  return <View className="flex-1 bg-background"><GymError />{children}</View>
}
