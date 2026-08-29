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
import type { MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { isoFromParts, isoToday } from '../../lib/dates'
import { useNavigation, useRouter } from 'expo-router'
import { moneyTabBarStyle } from './navigation'

const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLORS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']
export const inputClass = 'rounded-xl border border-surface-700 bg-surface-900 px-4 py-4 text-lg text-surface-100'

export function MoneyIcon({ name, color = '#fff', size = 20 }: { name: string; color?: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon color={color} size={size} />
}

export function money(cents: number, sign = false): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: sign ? 'always' : 'auto' }).format(cents / 100)
}

export function today(): string {
  return isoToday()
}

export function filteredTransactions(snapshot: MoneySnapshot, period: PeriodPreset): MoneyTransaction[] {
  if (period === 'all' || period === 'custom') return snapshot.transactions
  const now = new Date(`${today()}T00:00:00`)
  const from = new Date(now)
  if (period === 'week') from.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  if (period === 'month') from.setDate(1)
  if (period === 'year') from.setMonth(0, 1)
  const fromText = period === 'today' ? today() : isoFromParts(from.getFullYear(), from.getMonth(), from.getDate())
  return snapshot.transactions.filter((item) => item.date >= fromText && item.date <= today())
}

export function MoneyScreen({ children }: { children: (snapshot: MoneySnapshot) => React.ReactNode }): React.ReactElement {
  const { snapshot, loading, error, readOnly, refresh, alert, dismissAlert } = useMoney()
  const router = useRouter()
  if (loading && !snapshot) return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#91c4ff" /></View>
  if (!snapshot) return <View className="flex-1 items-center justify-center bg-surface-950 px-8"><CircleDollarSign color="#707078" size={46} /><Text className="mt-4 text-center text-2xl font-semibold text-surface-100">Connect Cloudflare D1</Text><Text className="mt-3 text-center text-[17px] leading-7 text-surface-400">{error ?? 'Add the account ID, database ID, and API token in Settings.'}</Text><Pressable onPress={() => router.push('/settings')} className="mt-6 rounded-xl bg-accent-600 px-6 py-4"><Text className="text-lg font-semibold text-white">Open settings</Text></Pressable></View>
  return <View className="flex-1 bg-surface-950">{(readOnly || error) && <Pressable onPress={() => void refresh()} className={`px-4 py-3 ${readOnly ? 'bg-amber-500/10' : 'bg-red-500/10'}`}><Text className={`text-center text-base ${readOnly ? 'text-amber-300' : 'text-red-300'}`}>{error}. Tap to retry.</Text></Pressable>}{alert && <Pressable onPress={dismissAlert} className="flex-row items-start gap-3 border-b border-rose-500/30 bg-rose-500/15 px-4 py-4"><TriangleAlert color="#fb7185" size={20} style={{ marginTop: 1 }} /><Text className="flex-1 text-base leading-6 text-rose-200">{alert}</Text><X color="#fb7185" size={20} /></Pressable>}{children(snapshot)}</View>
}

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  const navigation = useNavigation()
  React.useEffect(() => {
    if (!visible) return
    navigation.setOptions({ tabBarStyle: { ...moneyTabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle: moneyTabBarStyle })
  }, [navigation, visible])
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View className="flex-1 justify-end bg-black/70"><View className="max-h-[92%] rounded-t-3xl border-t border-surface-700 bg-surface-950"><View className="flex-row items-center justify-between border-b border-surface-800 px-5 py-5"><Text className="text-2xl font-semibold text-surface-100">{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}><X color="#909099" size={28} /></Pressable></View><ScrollView className="px-5 py-5" keyboardShouldPersistTaps="handled">{children}<View className="h-8" /></ScrollView></View></View></Modal>
}

export function ConfirmDialog({ visible, title, detail, confirmLabel, destructive = false, busy = false, hideNavigation = true, onCancel, onConfirm }: { visible: boolean; title: string; detail: string; confirmLabel: string; destructive?: boolean; busy?: boolean; hideNavigation?: boolean; onCancel: () => void; onConfirm: () => void }): React.ReactElement {
  const navigation = useNavigation()
  React.useEffect(() => {
    if (!visible || !hideNavigation) return
    navigation.setOptions({ tabBarStyle: { ...moneyTabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle: moneyTabBarStyle })
  }, [hideNavigation, navigation, visible])
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent><Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-6"><Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-surface-700 bg-surface-900 p-5"><Text className="text-2xl font-semibold text-surface-100">{title}</Text><Text className="mt-3 text-base leading-6 text-surface-300">{detail}</Text><View className="mt-6 flex-row gap-3"><Pressable disabled={busy} onPress={onCancel} className="flex-1 rounded-xl border border-surface-700 bg-surface-800 px-4 py-4"><Text className="text-center text-base font-semibold text-surface-200">Cancel</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} className={`flex-1 rounded-xl px-4 py-4 ${destructive ? 'bg-rose-600' : 'bg-accent-600'}`}><Text className="text-center text-base font-semibold text-white">{busy ? 'Saving...' : confirmLabel}</Text></Pressable></View></Pressable></Pressable></Modal>
}

export function Label({ text, children }: { text: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-5"><Text className="mb-2 text-base font-semibold text-surface-300">{text}</Text>{children}</View>
}

export function Chips<T extends string>({ values, value, labels, onChange }: { values: readonly T[]; value: T; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }): React.ReactElement {
  return <View className="flex-row flex-wrap gap-2">{values.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: value === item }} key={item} onPress={() => onChange(item)} className={`rounded-xl border px-4 py-3.5 ${value === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-700 bg-surface-900'}`}><Text className={`text-base ${value === item ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{labels?.[item] ?? item}</Text></Pressable>)}</View>
}

export function PeriodChips({ value, onChange }: { value: PeriodPreset; onChange: (value: PeriodPreset) => void }): React.ReactElement {
  const values: PeriodPreset[] = ['today', 'week', 'month', 'year', 'all']
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, height: 70 }} contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 9 }}>{values.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: value === item }} key={item} onPress={() => onChange(item)} className={`rounded-full border px-4 py-3 ${value === item ? 'border-accent-500/50 bg-accent-500/20' : 'border-surface-800 bg-surface-900'}`}><Text className={`text-base capitalize ${value === item ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{item === 'all' ? 'All time' : item}</Text></Pressable>)}</ScrollView>
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className={`rounded-xl px-4 py-4 ${disabled ? 'bg-surface-800' : 'bg-accent-600 active:bg-accent-500'}`}><Text className={`text-center text-lg font-semibold ${disabled ? 'text-surface-500' : 'text-white'}`}>{label}</Text></Pressable>
}

export function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return <View className="items-center px-8 py-16"><CircleDollarSign color="#707078" size={44} /><Text className="mt-4 text-2xl font-semibold text-surface-100">{title}</Text><Text className="mt-3 text-center text-[17px] leading-7 text-surface-400">{detail}</Text></View>
}

export { TextInput }
