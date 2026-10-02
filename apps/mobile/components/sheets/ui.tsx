import React, { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  AlignLeft, Calendar, CaseSensitive, Hash, Link, Mail, Phone, Sheet, SquareCheck, SquareChevronDown, Tags, TriangleAlert,
  X, type LucideIcon
} from 'lucide-react-native'
import type { SheetColumnType, SheetOption, SheetShade } from '@ego/core'
import { useLedger } from '../../lib/ledger-context'
import { useSheets } from '../../lib/sheets/context'
import { ConflictEntries } from '../ConflictEntries'
import { BottomSheet } from '../money/Common'
import { SyncButton } from '../money/SyncButton'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

/** The only color in Sheets: a value that does not fit its column. */
export const UNFIT = '#f87171'

export const SHADES: Record<SheetShade, { background: string; text: string; border: string }> = {
  0: { background: '#f5f5f5', text: '#0a0a0a', border: '#f5f5f5' },
  1: { background: '#bdbdbd', text: '#0a0a0a', border: '#bdbdbd' },
  2: { background: '#737373', text: '#ffffff', border: '#737373' },
  3: { background: '#404040', text: '#f5f5f5', border: '#404040' },
  4: { background: '#141414', text: '#e5e5e5', border: '#525252' }
}

export const COLUMN_TYPE_ICONS: Record<SheetColumnType, LucideIcon> = {
  text: CaseSensitive,
  longText: AlignLeft,
  number: Hash,
  date: Calendar,
  checkbox: SquareCheck,
  dropdown: SquareChevronDown,
  tags: Tags,
  phone: Phone,
  email: Mail,
  link: Link
}

export function OptionPill({ option, large = false }: { option: SheetOption; large?: boolean }): React.ReactElement {
  const shade = SHADES[option.shade]
  return <View
    style={{ backgroundColor: shade.background, borderColor: shade.border, borderWidth: 1 }}
    className={`max-w-full rounded-full ${large ? 'px-3 py-1' : 'px-2 py-px'}`}
  >
    <Text numberOfLines={1} style={{ color: shade.text }} className={`${large ? 'text-[15px]' : 'text-[13px]'} font-semibold`}>{option.name}</Text>
  </View>
}

export function SheetIcon({ icon, size = 40 }: { icon: string; size?: number }): React.ReactElement {
  return <View className="items-center justify-center rounded-xl border border-surface-800 bg-surface-900" style={{ width: size, height: size }}>
    {icon
      ? <Text style={{ fontSize: Math.round(size * 0.5), color: '#fafafa' }}>{icon}</Text>
      : <Sheet color="#a3a3a3" size={Math.round(size * 0.5)} />}
  </View>
}

export function SheetsMessage({ Icon = Sheet, title, detail, action, onAction }: {
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

/** Stands in for a Sheets screen until the phone has read its sheets. */
export function SheetsGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const sheets = useSheets()
  const router = useRouter()
  if (!ledger.enabled) {
    return <SheetsMessage
      title="Sign in to use Sheets"
      detail="Sign in once with Google on the start screen. Sheets then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <SheetsMessage Icon={TriangleAlert} title="This phone cannot open its database" detail={ledger.error} />
  if (sheets.data && ledger.current) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  if (stopped && ledger.status?.state === 'paused') {
    return <SheetsMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
  }
  if (stopped && !ledger.current) {
    return <SheetsMessage
      title="Waiting for a connection"
      detail="Sheets needs one download first. After that it works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#fafafa" /></View>
}

export function SheetsError(): React.ReactElement | null {
  const { error, dismissError } = useSheets()
  if (!error) return null
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Dismisses this message"
    onPress={dismissError}
    className="mx-4 my-2 flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
  >
    <Text className="flex-1 text-[14px] leading-5 text-red-300">{error}</Text>
    <X color="#fca5a5" size={16} />
  </Pressable>
}

/** Sync state with the conflict review kept inside Sheets, followed by the screen's own buttons. */
export function SheetsHeaderRight({ children }: { children?: React.ReactNode }): React.ReactElement {
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

export function FieldLabel({ type, name }: { type: SheetColumnType; name: string }): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[type]
  return <View className="mb-2 flex-row items-center">
    <Icon color="#737373" size={14} />
    <Text numberOfLines={1} className="ml-1.5 flex-1 text-[13px] font-semibold uppercase tracking-wide text-surface-500">{name}</Text>
  </View>
}
