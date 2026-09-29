import React, { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ListChecks, Plus, TriangleAlert, X, type LucideIcon } from 'lucide-react-native'
import type { HabitKind } from '@ego/core'
import { useHabits } from '../../lib/habits/context'
import { useLedger } from '../../lib/ledger-context'
import { BlurBlob, useBlur } from '../../lib/blur'
import { ConflictEntries } from '../ConflictEntries'
import { HeaderIcon } from '../gym/ui'
import { BottomSheet } from '../money/Common'
import { SyncButton } from '../money/SyncButton'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

export function HabitIcon({ icon, size = 44 }: { icon: string; size?: number }): React.ReactElement {
  const { blurred } = useBlur()
  return <View
    className="items-center justify-center rounded-2xl border border-surface-800 bg-surface-900"
    style={{ width: size, height: size }}
  >
    {blurred
      ? <BlurBlob size={Math.round(size * 0.5)} />
      : <Text style={{ fontSize: Math.round(size * 0.5), color: '#fafafa' }}>{icon}</Text>}
  </View>
}

export function HabitsMessage({ Icon = ListChecks, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></View>
    <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><UiText>{action}</UiText></Button>}
  </View>
}

/** Stands in for a Habits screen until the phone has read its list. */
export function HabitsGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const habits = useHabits()
  const router = useRouter()
  if (!ledger.enabled) {
    return <HabitsMessage
      title="Sign in to track habits"
      detail="Sign in once with Google on the start screen. Habits then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <HabitsMessage Icon={TriangleAlert} title="This phone cannot open its database" detail={ledger.error} />
  if (habits.habits) return <>{children}</>
  const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
  if (stopped && ledger.status?.state === 'paused') {
    return <HabitsMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
  }
  if (stopped) {
    return <HabitsMessage
      title="Waiting for a connection"
      detail="The first download needs the internet. After that, Habits works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#fafafa" /></View>
}

export function HabitsError(): React.ReactElement | null {
  const { error, dismissError } = useHabits()
  if (!error) return null
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Dismisses this message"
    onPress={dismissError}
    className="mb-3 flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
  >
    <Text className="flex-1 text-[14px] leading-5 text-red-300">{error}</Text>
    <X color="#fca5a5" size={16} />
  </Pressable>
}

/** Sync state, with the conflict review kept inside Habits, plus an add button when a list is showing. */
export function HabitsHeaderRight({ add }: { add?: HabitKind }): React.ReactElement {
  const ledger = useLedger()
  const habits = useHabits()
  const [reviewing, setReviewing] = useState(false)
  return <View style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
    <SyncButton onReview={() => setReviewing(true)} />
    {add && ledger.enabled && habits.habits && <HeaderIcon
      label={add === 'build' ? 'Add a habit' : 'Add a habit to break'}
      onPress={() => habits.openEditor({ kind: add, habit: null })}
    ><Plus color="#fafafa" size={24} /></HeaderIcon>}
    <BottomSheet visible={reviewing} title="Needs attention" onClose={() => setReviewing(false)}>
      <ConflictEntries
        entries={ledger.conflicts}
        onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
        onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      />
    </BottomSheet>
  </View>
}

export function StatTile({ Icon, label, value, detail }: {
  Icon?: LucideIcon
  label: string
  value: string
  detail?: string
}): React.ReactElement {
  return <View className="flex-1 rounded-2xl bg-surface-900 px-4 py-3.5">
    <View className="flex-row items-center gap-1.5">
      {Icon && <Icon color="#a3a3a3" size={15} />}
      <Text className="text-[13px] font-medium text-muted-foreground">{label}</Text>
    </View>
    <Text className="mt-1 text-[22px] font-bold tracking-tight text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
    {detail && <Text className="text-[13px] text-surface-400">{detail}</Text>}
  </View>
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
