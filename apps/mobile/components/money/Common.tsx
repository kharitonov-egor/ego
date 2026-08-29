import React from 'react'
import {
  ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View
} from 'react-native'
import {
  ArrowRight, Banknote, Bitcoin, BriefcaseBusiness, Car, CircleDollarSign,
  CreditCard, Gift, GraduationCap, HandCoins, Heart, Home, Landmark, PiggyBank,
  Receipt, ShoppingBag, ShoppingBasket, Tag, TriangleAlert, Utensils, WalletCards, X,
  type LucideIcon
} from 'lucide-react-native'
import type { DateRange, MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { isoToday } from '../../lib/dates'
import { PERIOD_PRESETS, transactionsInRange, usePeriod } from '../../lib/period-context'
import { useNavigation, useRouter } from 'expo-router'
import { useMoneyTabBarStyle } from './navigation'
import { CustomPeriodSheet } from './PeriodSheet'

const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLORS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']
export const inputClass = 'rounded-lg border border-surface-700 bg-surface-900 px-3 py-2.5 text-[14px] text-surface-100'

export function MoneyIcon({ name, color = '#fff', size = 16 }: { name: string; color?: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon color={color} size={size} />
}

export function money(cents: number, sign = false): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: sign ? 'always' : 'auto' }).format(cents / 100)
}

export function today(): string {
  return isoToday()
}

export function filteredTransactions(snapshot: MoneySnapshot, range: DateRange): MoneyTransaction[] {
  return transactionsInRange(snapshot, range)
}

export function MoneyScreen({ children }: { children: (snapshot: MoneySnapshot) => React.ReactNode }): React.ReactElement {
  const { snapshot, loading, error, readOnly, refresh, alert, dismissAlert } = useMoney()
  const router = useRouter()
  if (loading && !snapshot) return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#91c4ff" /></View>
  if (!snapshot) return <View className="flex-1 items-center justify-center bg-surface-950 px-8"><CircleDollarSign color="#707078" size={34} /><Text className="mt-3 text-center text-[16px] font-semibold text-surface-100">Connect Cloudflare D1</Text><Text className="mt-2 text-center text-[13px] leading-5 text-surface-400">{error ?? 'Add the account ID, database ID, and API token in Settings.'}</Text><Pressable onPress={() => router.push('/settings')} className="mt-4 rounded-lg bg-accent-600 px-4 py-2.5"><Text className="text-[14px] font-semibold text-white">Open settings</Text></Pressable></View>
  return <View className="flex-1 bg-surface-950">{(readOnly || error) && <Pressable onPress={() => void refresh()} className={`px-4 py-2 ${readOnly ? 'bg-amber-500/10' : 'bg-red-500/10'}`}><Text className={`text-center text-[12px] ${readOnly ? 'text-amber-300' : 'text-red-300'}`}>{error}. Tap to retry.</Text></Pressable>}{alert && <Pressable onPress={dismissAlert} className="flex-row items-start gap-2 border-b border-rose-500/30 bg-rose-500/15 px-4 py-2.5"><TriangleAlert color="#fb7185" size={15} style={{ marginTop: 1 }} /><Text className="flex-1 text-[12px] leading-4 text-rose-200">{alert}</Text><X color="#fb7185" size={15} /></Pressable>}{children(snapshot)}</View>
}

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  const navigation = useNavigation()
  const tabBarStyle = useMoneyTabBarStyle()
  React.useEffect(() => {
    if (!visible) return
    navigation.setOptions({ tabBarStyle: { ...tabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle })
  }, [navigation, tabBarStyle, visible])
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View className="flex-1 justify-end bg-black/70"><View className="max-h-[92%] rounded-t-2xl border-t border-surface-700 bg-surface-950"><View className="flex-row items-center justify-between border-b border-surface-800 px-4 py-3"><Text className="text-[15px] font-semibold text-surface-100">{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}><X color="#909099" size={20} /></Pressable></View><ScrollView className="px-4 py-4" keyboardShouldPersistTaps="handled">{children}<View className="h-6" /></ScrollView></View></View></Modal>
}

export function ConfirmDialog({ visible, title, detail, confirmLabel, destructive = false, busy = false, hideNavigation = true, onCancel, onConfirm }: { visible: boolean; title: string; detail: string; confirmLabel: string; destructive?: boolean; busy?: boolean; hideNavigation?: boolean; onCancel: () => void; onConfirm: () => void }): React.ReactElement {
  const navigation = useNavigation()
  const tabBarStyle = useMoneyTabBarStyle()
  React.useEffect(() => {
    if (!visible || !hideNavigation) return
    navigation.setOptions({ tabBarStyle: { ...tabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle })
  }, [hideNavigation, navigation, tabBarStyle, visible])
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent><Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-6"><Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-surface-700 bg-surface-900 p-4"><Text className="text-[15px] font-semibold text-surface-100">{title}</Text><Text className="mt-1.5 text-[13px] leading-5 text-surface-300">{detail}</Text><View className="mt-4 flex-row gap-2"><Pressable disabled={busy} onPress={onCancel} className="flex-1 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2.5"><Text className="text-center text-[13px] font-semibold text-surface-200">Cancel</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} className={`flex-1 rounded-lg px-3 py-2.5 ${destructive ? 'bg-rose-600' : 'bg-accent-600'}`}><Text className="text-center text-[13px] font-semibold text-white">{busy ? 'Saving...' : confirmLabel}</Text></Pressable></View></Pressable></Pressable></Modal>
}

export function Label({ text, children }: { text: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-3.5"><Text className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-surface-400">{text}</Text>{children}</View>
}

export function Chips<T extends string>({ values, value, labels, onChange }: { values: readonly T[]; value: T; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }): React.ReactElement {
  return <View className="flex-row flex-wrap gap-1.5">{values.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: value === item }} key={item} onPress={() => onChange(item)} className={`rounded-lg border px-3 py-2 ${value === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-700 bg-surface-900'}`}><Text className={`text-[13px] ${value === item ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{labels?.[item] ?? item}</Text></Pressable>)}</View>
}

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Today', week: 'Week', month: 'Month', year: 'Year', all: 'All time', custom: 'Custom'
}

export function PeriodChips(): React.ReactElement {
  const { period, custom, label, setPeriod, setCustom } = usePeriod()
  const [picking, setPicking] = React.useState(false)
  return <>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}
    >{PERIOD_PRESETS.map((item) => {
      const active = period === item
      const text = item === 'custom' && active && (custom.from || custom.to) ? label : PERIOD_LABELS[item]
      return <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={item}
        onPress={() => item === 'custom' ? setPicking(true) : setPeriod(item)}
        className={`rounded-full border px-2.5 py-1.5 ${active ? 'border-accent-500/50 bg-accent-500/20' : 'border-surface-800 bg-surface-900'}`}
      ><Text className={`text-[12px] ${active ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{text}</Text></Pressable>
    })}</ScrollView>
    <CustomPeriodSheet
      visible={picking}
      value={custom}
      onClose={() => setPicking(false)}
      onApply={(range) => { setCustom(range); setPicking(false) }}
    />
  </>
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className={`rounded-lg px-3 py-2.5 ${disabled ? 'bg-surface-800' : 'bg-accent-600 active:bg-accent-500'}`}><Text className={`text-center text-[14px] font-semibold ${disabled ? 'text-surface-500' : 'text-white'}`}>{label}</Text></Pressable>
}

export function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return <View className="items-center px-8 py-10"><CircleDollarSign color="#707078" size={32} /><Text className="mt-3 text-[15px] font-semibold text-surface-100">{title}</Text><Text className="mt-1.5 text-center text-[13px] leading-5 text-surface-400">{detail}</Text></View>
}

export { TextInput }
