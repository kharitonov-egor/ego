import React, { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { Barcode, Refrigerator, TriangleAlert, UtensilsCrossed, X, type LucideIcon } from 'lucide-react-native'
import {
  formatCalories, formatGrams,
  type FoodEntryInput, type FoodGoalInput, type FoodMacros, type FoodPhoto
} from '@ego/core'
import { useBlur } from '../../lib/blur'
import { mediaSource } from '../../lib/diary/media'
import { useFood } from '../../lib/food/context'
import { useLedger } from '../../lib/ledger-context'
import { ConflictEntries } from '../ConflictEntries'
import { BottomSheet } from '../money/Common'
import { SyncButton } from '../money/SyncButton'
import { color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Text } from '../ui/text'

export function macroText(macros: Pick<FoodMacros, 'protein' | 'carbs' | 'fat'>): string {
  return `P ${formatGrams(macros.protein)} · C ${formatGrams(macros.carbs)} · F ${formatGrams(macros.fat)}`
}

export function FoodMessage({ Icon = UtensilsCrossed, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={30} /></View>
    <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

/** Stands in for a Food screen until the phone has read its log. */
export function FoodGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const food = useFood()
  const router = useRouter()
  if (!ledger.enabled) {
    return <FoodMessage
      title="Sign in to use Food"
      detail="Sign in once with Google on the start screen. Meals and the fridge then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <FoodMessage Icon={TriangleAlert} title="This phone cannot open its database" detail={ledger.error} />
  if (food.data && ledger.current) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  if (stopped && ledger.status?.state === 'paused') {
    return <FoodMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
  }
  if (stopped && !ledger.current) {
    return <FoodMessage
      title="Waiting for a connection"
      detail="Food needs one download first. After that it works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color={color.text} /></View>
}

/** Sync state, with the conflict review kept inside Food, followed by the screen's own buttons. */
export function FoodHeaderRight({ children }: { children?: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const [reviewing, setReviewing] = useState(false)
  return <View style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
    <SyncButton onReview={() => setReviewing(true)} />
    {children}
    <BottomSheet visible={reviewing} title="Needs attention" onClose={() => setReviewing(false)}>
      <ConflictEntries
        entries={ledger.conflicts}
        onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
        onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      />
    </BottomSheet>
  </View>
}

export function FoodError(): React.ReactElement | null {
  const { error, dismissError } = useFood()
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

/** The list's small copy when there is one, from this phone if it still has the file, otherwise from the Worker. */
export function FoodPhotoView({ photo, uri, size = 'small', style }: {
  photo: FoodPhoto | null
  /** A local file to show instead, like a draft not yet saved. */
  uri?: string | null
  size?: 'small' | 'large'
  style: { width: number | `${number}%`; height: number; borderRadius?: number }
}): React.ReactElement | null {
  const { api } = useLedger()
  const { localPhotos } = useFood()
  const { blurred } = useBlur()
  if (blurred) return <View style={[style, { backgroundColor: color.surfaceRaised }]} />
  const id = photo ? (size === 'small' ? photo.previewId ?? photo.mediaId : photo.mediaId) : null
  const source = uri ? { uri } : id ? mediaSource(api, localPhotos, id, 'food') : null
  if (!source) return null
  return <Image source={source} style={style} contentFit="cover" transition={120} recyclingKey={uri ?? id ?? undefined} accessibilityIgnoresInvertColors />
}

export function FoodThumb({ entry, size = 56 }: { entry: Pick<FoodEntryInput, 'photo' | 'source'>; size?: number }): React.ReactElement {
  const style = { width: size, height: size, borderRadius: 14 }
  if (entry.photo) return <FoodPhotoView photo={entry.photo} style={style} />
  const Icon = entry.source === 'barcode' ? Barcode : UtensilsCrossed
  return <View style={style} className="items-center justify-center bg-surface-900"><Icon color={color.textFaint} size={size * 0.4} /></View>
}

export function FridgeIcon({ icon, size = 44 }: { icon: string; size?: number }): React.ReactElement {
  return <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-surface-900">
    {icon ? <Text style={{ fontSize: size * 0.48 }}>{icon}</Text> : <Refrigerator color={color.textMuted} size={size * 0.45} />}
  </View>
}

function Bar({ share }: { share: number }): React.ReactElement {
  const over = share > 1
  return <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-800">
    <View style={{ width: `${Math.min(share, 1) * 100}%`, height: '100%', backgroundColor: over ? color.attention : color.text }} />
  </View>
}

function MacroColumn({ label, value, target }: { label: string; value: number; target: number | null }): React.ReactElement {
  return <View className="flex-1">
    <Text className="text-[13px] font-medium text-muted-foreground">{label}</Text>
    <View className="mt-0.5 flex-row items-baseline">
      <Text className="text-[17px] font-semibold" style={tabular}>{formatGrams(value)}</Text>
      <Text className="ml-0.5 text-[13px] text-muted-foreground" style={tabular}>{target ? ` / ${formatGrams(target)} g` : ' g'}</Text>
    </View>
    {target ? <Bar share={value / target} /> : null}
  </View>
}

/** Today against the daily targets. Tapping it opens the targets. */
export function TodayCard({ totals, goal, onPress }: {
  totals: FoodMacros
  goal: FoodGoalInput
  onPress: () => void
}): React.ReactElement {
  const left = goal.calories === null ? null : goal.calories - totals.calories
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Today, ${formatCalories(totals.calories)} calories${goal.calories ? ` of ${formatCalories(goal.calories)}` : ''}`}
    accessibilityHint="Opens the daily targets"
    onPress={onPress}
    className="rounded-3xl border border-border bg-card p-4 active:bg-surface-900"
  >
    <View className="flex-row items-baseline">
      <Text className="text-[30px] font-bold tracking-tight" style={tabular}>{formatCalories(totals.calories)}</Text>
      <Text className="ml-1.5 text-[15px] text-muted-foreground" style={tabular}>
        {goal.calories ? `/ ${formatCalories(goal.calories)} kcal` : 'kcal today'}
      </Text>
      <View className="flex-1" />
      {left !== null && <Text className={`text-[14px] font-medium ${left < 0 ? 'text-attention' : 'text-muted-foreground'}`} style={tabular}>
        {left < 0 ? `${formatCalories(-left)} over` : `${formatCalories(left)} left`}
      </Text>}
    </View>
    {goal.calories ? <Bar share={totals.calories / goal.calories} /> : null}
    <View className="mt-4 flex-row gap-4">
      <MacroColumn label="Protein" value={totals.protein} target={goal.protein} />
      <MacroColumn label="Carbs" value={totals.carbs} target={goal.carbs} />
      <MacroColumn label="Fat" value={totals.fat} target={goal.fat} />
    </View>
    {goal.calories === null && goal.protein === null && goal.carbs === null && goal.fat === null &&
      <Text className="mt-3 text-[13px] text-surface-400">Tap to set daily targets.</Text>}
  </Pressable>
}
