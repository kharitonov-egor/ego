import React from 'react'
import {
  ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View
} from 'react-native'
import {
  ArrowRight, Banknote, Bitcoin, BriefcaseBusiness, Car, CircleDollarSign,
  CreditCard, Gift, GraduationCap, HandCoins, Heart, Home, Landmark, PiggyBank,
  Receipt, ShoppingBag, ShoppingBasket, Tag, Utensils, WalletCards, X,
  type LucideIcon
} from 'lucide-react-native'
import type { MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { useNavigation, useRouter } from 'expo-router'
import { moneyTabBarStyle } from './navigation'

const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLORS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']
export const inputClass = 'rounded-xl border border-surface-800 bg-surface-900 px-3 py-3 text-sm text-surface-100'

export function MoneyIcon({ name, color = '#fff', size = 20 }: { name: string; color?: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon color={color} size={size} />
}

export function money(cents: number, sign = false): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: sign ? 'always' : 'auto' }).format(cents / 100)
}

export function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10)
}

export function filteredTransactions(snapshot: MoneySnapshot, period: PeriodPreset): MoneyTransaction[] {
  if (period === 'all' || period === 'custom') return snapshot.transactions
  const now = new Date(`${today()}T00:00:00`)
  const from = new Date(now)
  if (period === 'week') from.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  if (period === 'month') from.setDate(1)
  if (period === 'year') from.setMonth(0, 1)
  const fromText = period === 'today' ? today() : localIso(from)
  return snapshot.transactions.filter((item) => item.date >= fromText && item.date <= today())
}

function localIso(date: Date): string {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

export function MoneyScreen({ children }: { children: (snapshot: MoneySnapshot) => React.ReactNode }): React.ReactElement {
  const { snapshot, loading, error, readOnly, refresh } = useMoney()
  const router = useRouter()
  if (loading && !snapshot) return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#60a5fa" /></View>
  if (!snapshot) return <View className="flex-1 items-center justify-center bg-surface-950 px-8"><CircleDollarSign color="#636f8f" size={38} /><Text className="mt-4 text-center text-base font-medium text-surface-100">Connect Cloudflare D1</Text><Text className="mt-2 text-center text-sm text-surface-500">{error ?? 'Add the account ID, database ID, and API token in Settings.'}</Text><Pressable onPress={() => router.push('/settings')} className="mt-5 rounded-xl bg-accent-600 px-5 py-3"><Text className="font-medium text-white">Open settings</Text></Pressable></View>
  return <View className="flex-1 bg-surface-950">{(readOnly || error) && <Pressable onPress={() => void refresh()} className={`px-4 py-2 ${readOnly ? 'bg-amber-500/10' : 'bg-red-500/10'}`}><Text className={`text-center text-xs ${readOnly ? 'text-amber-300' : 'text-red-300'}`}>{error}. Tap to retry.</Text></Pressable>}{children(snapshot)}</View>
}

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  const navigation = useNavigation()
  React.useEffect(() => {
    if (!visible) return
    navigation.setOptions({ tabBarStyle: { ...moneyTabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle: moneyTabBarStyle })
  }, [navigation, visible])
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View className="flex-1 justify-end bg-black/70"><View className="max-h-[92%] rounded-t-3xl border-t border-surface-700 bg-surface-950"><View className="flex-row items-center justify-between border-b border-surface-800 px-5 py-4"><Text className="text-base font-semibold text-surface-100">{title}</Text><Pressable onPress={onClose} hitSlop={10}><X color="#8a93ab" size={20} /></Pressable></View><ScrollView className="px-5 py-5" keyboardShouldPersistTaps="handled">{children}<View className="h-8" /></ScrollView></View></View></Modal>
}

export function ConfirmDialog({ visible, title, detail, confirmLabel, destructive = false, busy = false, hideNavigation = true, onCancel, onConfirm }: { visible: boolean; title: string; detail: string; confirmLabel: string; destructive?: boolean; busy?: boolean; hideNavigation?: boolean; onCancel: () => void; onConfirm: () => void }): React.ReactElement {
  const navigation = useNavigation()
  React.useEffect(() => {
    if (!visible || !hideNavigation) return
    navigation.setOptions({ tabBarStyle: { ...moneyTabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle: moneyTabBarStyle })
  }, [hideNavigation, navigation, visible])
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent><Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-6"><Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-surface-700 bg-surface-900 p-5"><Text className="text-lg font-semibold text-surface-100">{title}</Text><Text className="mt-2 text-sm leading-5 text-surface-300">{detail}</Text><View className="mt-6 flex-row gap-3"><Pressable disabled={busy} onPress={onCancel} className="flex-1 rounded-xl border border-surface-700 bg-surface-800 px-4 py-3"><Text className="text-center text-sm font-semibold text-surface-200">Cancel</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} className={`flex-1 rounded-xl px-4 py-3 ${destructive ? 'bg-rose-600' : 'bg-accent-600'}`}><Text className="text-center text-sm font-semibold text-white">{confirmLabel}</Text></Pressable></View></Pressable></Pressable></Modal>
}

export function Label({ text, children }: { text: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-4"><Text className="mb-1.5 text-xs text-surface-400">{text}</Text>{children}</View>
}

export function Chips<T extends string>({ values, value, labels, onChange }: { values: readonly T[]; value: T; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }): React.ReactElement {
  return <View className="flex-row flex-wrap gap-2">{values.map((item) => <Pressable key={item} onPress={() => onChange(item)} className={`rounded-xl border px-3 py-2 ${value === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={`text-xs ${value === item ? 'text-accent-400' : 'text-surface-400'}`}>{labels?.[item] ?? item}</Text></Pressable>)}</View>
}

export function PeriodChips({ value, onChange }: { value: PeriodPreset; onChange: (value: PeriodPreset) => void }): React.ReactElement {
  const values: PeriodPreset[] = ['today', 'week', 'month', 'year', 'all']
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, height: 52 }} contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 }}>{values.map((item) => <Pressable key={item} onPress={() => onChange(item)} className={`rounded-full px-3 py-1.5 ${value === item ? 'bg-surface-600' : 'bg-surface-900'}`}><Text className={`text-xs capitalize ${value === item ? 'text-white' : 'text-surface-500'}`}>{item === 'all' ? 'All time' : item}</Text></Pressable>)}</ScrollView>
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return <Pressable disabled={disabled} onPress={onPress} className={`rounded-xl px-4 py-3 ${disabled ? 'bg-surface-800' : 'bg-accent-600 active:bg-accent-500'}`}><Text className={`text-center text-sm font-semibold ${disabled ? 'text-surface-500' : 'text-white'}`}>{label}</Text></Pressable>
}

export function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return <View className="items-center px-8 py-16"><CircleDollarSign color="#3c4b73" size={34} /><Text className="mt-4 text-base font-medium text-surface-200">{title}</Text><Text className="mt-2 text-center text-sm text-surface-500">{detail}</Text></View>
}

export { TextInput }
