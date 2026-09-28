import React from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View
} from 'react-native'
import {
  ArrowRight, Banknote, Bitcoin, BriefcaseBusiness, Car, CircleDollarSign,
  CreditCard, Gift, GraduationCap, HandCoins, Heart, Home, Landmark, PiggyBank,
  Check, Receipt, ShoppingBag, ShoppingBasket, Tag, TriangleAlert, Utensils, WalletCards, X,
  type LucideIcon
} from 'lucide-react-native'
import type { DateRange, MoneySnapshot, MoneyTransaction } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { useLedger } from '../../lib/ledger-context'
import { isoToday } from '../../lib/dates'
import { transactionsInRange } from '../../lib/period-context'
import { useNavigation, useRouter } from 'expo-router'
import { useMoneyTabBarStyle } from './navigation'
import { sheetAnimation, useReducedMotion } from './tokens'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLORS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']
export const inputClass = 'min-h-[52px] rounded-xl border border-input bg-surface-900 px-4 py-3 text-[17px] text-foreground'

export function MoneyIcon({ name, color = '#fff', size = 16 }: { name: string; color?: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon color={color} size={size} />
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const SIGNED_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'always' })

/** Hermes builds a formatter slowly, and list rows call this several times each. */
export function money(cents: number, sign = false): string {
  return (sign ? SIGNED_USD : USD).format(cents / 100)
}

export function today(): string {
  return isoToday()
}

export function filteredTransactions(snapshot: MoneySnapshot, range: DateRange): MoneyTransaction[] {
  return transactionsInRange(snapshot, range)
}

function CenteredMessage({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <CircleDollarSign color="#737373" size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><UiText>{action}</UiText></Button>}
  </View>
}

export function SignInPrompt(): React.ReactElement {
  const router = useRouter()
  return <CenteredMessage
    title="Sign in to see your money"
    detail="Sign in once with Google. The ledger downloads to this phone and keeps working offline."
    action="Open settings"
    onAction={() => router.push('/settings')}
  />
}

export function MoneyScreen({ children }: { children: (snapshot: MoneySnapshot) => React.ReactNode }): React.ReactElement {
  const { snapshot, error, dismissError, alert, dismissAlert } = useMoney()
  const ledger = useLedger()
  const router = useRouter()
  if (!ledger.enabled) return <SignInPrompt />
  if (ledger.error) return <CenteredMessage title="This phone cannot open its ledger" detail={ledger.error} />
  if (!snapshot) {
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <CenteredMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
    }
    if (stopped && ledger.status?.state === 'offline') {
      return <CenteredMessage
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, this screen works offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    if (stopped || (ledger.ready && error)) {
      return <CenteredMessage
        title={stopped ? 'The download did not finish' : 'This phone could not read its ledger'}
        detail={error ?? ledger.status?.message ?? 'Try again in a moment.'}
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <View className="flex-1 items-center justify-center bg-surface-950">
      <ActivityIndicator color="#fafafa" />
      {!ledger.ready && <Text className="mt-3 text-[14px] text-surface-400">Downloading your ledger</Text>}
    </View>
  }
  return <View className="flex-1 bg-surface-950">
    {error && <Pressable accessibilityRole="button" accessibilityHint="Dismisses this message" onPress={dismissError} className="min-h-11 flex-row items-center gap-2 bg-red-500/10 px-4 py-2">
      <Text className="flex-1 text-[14px] leading-5 text-red-300">{error}</Text>
      <X color="#fca5a5" size={16} />
    </Pressable>}
    {alert && <Pressable onPress={dismissAlert} className="min-h-11 flex-row items-start gap-2 border-b border-rose-500/30 bg-rose-500/15 px-4 py-2.5"><TriangleAlert color="#fb7185" size={15} style={{ marginTop: 2 }} /><Text className="flex-1 text-[14px] leading-5 text-rose-200">{alert}</Text><X color="#fb7185" size={17} /></Pressable>}
    {children(snapshot)}
  </View>
}

/** A bottom sheet with no navigation side effects, so it can open on top of a full-screen modal. */
export function BottomSheet({ visible, title, onClose, dismissOnBackdrop = false, children }: {
  visible: boolean
  title: string
  onClose: () => void
  dismissOnBackdrop?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const reducedMotion = useReducedMotion()
  return <Modal visible={visible} transparent animationType={sheetAnimation(reducedMotion)} onRequestClose={onClose}>
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View className="flex-1 justify-end bg-black/70">
        {dismissOnBackdrop && <Pressable accessibilityLabel="Close" onPress={onClose} className="absolute inset-0" />}
        <View className="max-h-[92%] rounded-t-[28px] border-t border-surface-800 bg-background">
          <View className="items-center pt-2.5"><View className="h-1.5 w-10 rounded-full bg-surface-700" /></View>
          <View className="flex-row items-center justify-between px-5 pb-1 pt-2">
            <Text accessibilityRole="header" className="flex-1 pr-3 text-[22px] font-bold text-foreground">{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-900 active:bg-surface-800"><X color="#d4d4d4" size={20} /></Pressable>
          </View>
          <ScrollView className="px-5 pt-3" keyboardShouldPersistTaps="handled">{children}<View className="h-10" /></ScrollView>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

export function Sheet(props: { visible: boolean; title: string; onClose: () => void; dismissOnBackdrop?: boolean; children: React.ReactNode }): React.ReactElement {
  const navigation = useNavigation()
  const tabBarStyle = useMoneyTabBarStyle()
  const { visible } = props
  React.useEffect(() => {
    if (!visible) return
    navigation.setOptions({ tabBarStyle: { ...tabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle })
  }, [navigation, tabBarStyle, visible])
  return <BottomSheet {...props} />
}

export function ConfirmDialog({ visible, title, detail, confirmLabel, destructive = false, busy = false, hideNavigation = true, onCancel, onConfirm }: { visible: boolean; title: string; detail: string; confirmLabel: string; destructive?: boolean; busy?: boolean; hideNavigation?: boolean; onCancel: () => void; onConfirm: () => void }): React.ReactElement {
  const navigation = useNavigation()
  const tabBarStyle = useMoneyTabBarStyle()
  React.useEffect(() => {
    if (!visible || !hideNavigation) return
    navigation.setOptions({ tabBarStyle: { ...tabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle })
  }, [hideNavigation, navigation, tabBarStyle, visible])
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onCancel} className="flex-1 items-center justify-center bg-black/80 px-6">
      <Pressable onPress={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-surface-800 bg-card p-5">
        <Text className="text-[22px] font-bold text-foreground">{title}</Text>
        <Text className="mt-2 text-[16px] leading-6 text-muted-foreground">{detail}</Text>
        <View className="mt-5 flex-row gap-3">
          <Button variant="outline" size="lg" disabled={busy} onPress={onCancel} className="flex-1"><UiText>Cancel</UiText></Button>
          <Button variant={destructive ? 'destructive' : 'default'} size="lg" disabled={busy} onPress={onConfirm} className="flex-1"><UiText>{busy ? 'Saving...' : confirmLabel}</UiText></Button>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
}

export function Label({ text, children }: { text: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-5"><Text className="mb-2 text-[15px] font-medium text-surface-200">{text}</Text>{children}</View>
}

/** Stored values stay lowercase ("credit-card"); what the eye sees starts with a capital ("Credit card"). */
export function sentenceCase(value: string): string {
  const words = value.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function Chips<T extends string>({ values, value, labels, onChange }: { values: readonly T[]; value: T; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }): React.ReactElement {
  return <View className="flex-row flex-wrap gap-2">{values.map((item) => {
    const selected = value === item
    return <Pressable
      key={item}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onChange(item)}
      className={`min-h-12 justify-center rounded-xl border px-4 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
    ><Text className={`text-[16px] ${selected ? 'font-semibold text-primary-foreground' : 'text-surface-200'}`}>{labels?.[item] ?? sentenceCase(item)}</Text></Pressable>
  })}</View>
}

/** A single choice among accounts or categories, with the record's own icon and color beside its name. */
export function ChoicePill({ label, icon, color, selected, onPress }: {
  label: string
  icon?: string
  color?: string
  selected: boolean
  onPress: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    className={`min-h-12 flex-row items-center rounded-full border px-4 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    {icon && <View className="mr-2 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#404040' }}><MoneyIcon name={icon} size={13} /></View>}
    <Text className={`text-[15px] ${selected ? 'font-semibold text-primary-foreground' : 'text-surface-200'}`}>{label}</Text>
  </Pressable>
}

/** The selected tile takes the chosen color, so icon and color read as one choice. */
export function IconPicker({ icons = ICON_OPTIONS, value, color, onChange }: {
  icons?: readonly string[]
  value: string
  color: string
  onChange: (icon: string) => void
}): React.ReactElement {
  return <View className="flex-row flex-wrap gap-2.5">{icons.map((item) => {
    const selected = value === item
    return <Pressable
      key={item}
      accessibilityRole="button"
      accessibilityLabel={`Use ${item} icon`}
      accessibilityState={{ selected }}
      onPress={() => onChange(item)}
      className={`h-14 w-14 items-center justify-center rounded-2xl ${selected ? '' : 'border border-input bg-surface-900 active:bg-surface-800'}`}
      style={selected ? { backgroundColor: color } : undefined}
    ><MoneyIcon name={item} color={selected ? '#ffffff' : '#d4d4d4'} size={23} /></Pressable>
  })}</View>
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }): React.ReactElement {
  return <View className="flex-row flex-wrap gap-3">{COLORS.map((item) => {
    const selected = value === item
    return <Pressable
      key={item}
      accessibilityRole="button"
      accessibilityLabel={`Use color ${item}`}
      accessibilityState={{ selected }}
      onPress={() => onChange(item)}
      className="h-12 w-12 items-center justify-center rounded-full"
      style={{ backgroundColor: item }}
    >{selected && <Check color="#ffffff" size={22} strokeWidth={3} />}</Pressable>
  })}</View>
}

/** What the account or category will look like in lists, drawn while the form is filled in. */
export function EntityPreview({ name, placeholder, icon, color, detail, shape }: {
  name: string
  placeholder: string
  icon: string
  color: string
  detail: string
  shape: 'circle' | 'square'
}): React.ReactElement {
  return <View className="mb-6 items-center">
    <View className={`h-20 w-20 items-center justify-center ${shape === 'circle' ? 'rounded-full' : 'rounded-3xl'}`} style={{ backgroundColor: color }}>
      <MoneyIcon name={icon} size={34} />
    </View>
    <Text numberOfLines={1} className={`mt-3 text-[20px] font-bold ${name.trim() ? 'text-foreground' : 'text-surface-500'}`}>{name.trim() || placeholder}</Text>
    <Text className="mt-0.5 text-[15px] text-muted-foreground">{detail}</Text>
  </View>
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.ReactElement {
  return <Button size="lg" disabled={disabled} onPress={onPress}><UiText>{label}</UiText></Button>
}

export function Empty({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return <View className="items-center px-8 py-14">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><CircleDollarSign color="#a3a3a3" size={30} /></View>
    <Text className="mt-4 text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
  </View>
}

export { TextInput }
