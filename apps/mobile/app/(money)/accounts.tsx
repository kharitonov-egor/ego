import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Archive, Plus, RotateCcw } from 'lucide-react-native'
import type { AccountInput, AccountKind, MoneyAccount } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import {
  Chips, COLORS, ConfirmDialog, Empty, ICON_OPTIONS, Label, MoneyIcon, MoneyScreen,
  PrimaryButton, Sheet, inputClass, money, today
} from '../../components/money/Common'

const KINDS: AccountKind[] = ['checking', 'savings', 'cash', 'credit-card', 'investment', 'crypto', 'other']

function AccountForm({ account, onClose }: { account?: MoneyAccount; onClose: () => void }): React.ReactElement {
  const moneyState = useMoney()
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'checking')
  const [icon, setIcon] = useState(account?.icon ?? 'Landmark')
  const [color, setColor] = useState(account?.color ?? COLORS[0])
  const [balance, setBalance] = useState(account ? String(account.openingBalanceCents / 100) : '0')
  const [date, setDate] = useState(account?.openingDate ?? today())
  const valid = Boolean(name.trim() && date && Number.isFinite(Number(balance)))
  const save = async (): Promise<void> => {
    const input: AccountInput = { name: name.trim(), kind, icon, color, openingBalanceCents: Math.round(Number(balance) * 100), openingDate: date }
    const saved = account ? await moneyState.updateAccount(account.id, input) : await moneyState.createAccount(input)
    if (saved) onClose()
  }
  return <View><Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Chase checking" placeholderTextColor="#707078" className={inputClass} /></Label><Label text="Account type"><Chips values={KINDS} value={kind} onChange={setKind} /></Label><Label text="Opening balance in USD"><TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" className={inputClass} /></Label><Label text="Opening date"><TextInput value={date} onChangeText={setDate} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor="#707078" className={inputClass} /></Label><Label text="Icon"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{ICON_OPTIONS.slice(0, 7).map((item) => <Pressable key={item} onPress={() => setIcon(item)} className={`rounded-xl border p-3 ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#91c4ff' : '#b5b5bc'} /></Pressable>)}</ScrollView></Label><Label text="Color"><View className="flex-row flex-wrap gap-3">{COLORS.map((item) => <Pressable key={item} onPress={() => setColor(item)} className={`h-8 w-8 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label><PrimaryButton label={account ? 'Save account' : 'Create account'} disabled={!valid || moneyState.busy} onPress={() => void save()} /></View>
}

export default function Accounts(): React.ReactElement {
  const moneyState = useMoney()
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null)
  const [archived, setArchived] = useState(false)
  const [confirming, setConfirming] = useState<MoneyAccount | null>(null)
  return <MoneyScreen>{(snapshot) => {
    const accounts = snapshot.accounts.filter((item) => Boolean(item.archivedAt) === archived)
    const active = snapshot.accounts.filter((item) => !item.archivedAt)
    const total = active.reduce((sum, item) => sum + item.balanceCents, 0)
    const toggleArchive = (account: MoneyAccount): void => setConfirming(account)
    const confirmArchive = async (): Promise<void> => {
      if (!confirming) return
      const saved = await moneyState.archiveAccount(confirming.id, !confirming.archivedAt)
      if (saved) setConfirming(null)
    }
    return <View className="flex-1"><View className="border-b border-surface-800 px-5 pb-6 pt-5"><Text className="text-lg font-semibold text-surface-200">Total balance</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className={`mt-1 text-6xl font-bold tracking-tight ${total < 0 ? 'text-rose-400' : 'text-surface-50'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(total)}</Text><Pressable accessibilityRole="button" onPress={() => setArchived(!archived)} className="mt-4 self-start rounded-full border border-surface-700 bg-surface-900 px-4 py-3"><Text className="text-[17px] font-semibold text-surface-200">{archived ? 'Show active' : 'Show archived'}</Text></Pressable></View><ScrollView className="flex-1 px-5 pt-4" refreshControl={undefined}>{accounts.length === 0 ? <Empty title={archived ? 'No archived accounts' : 'Create your first account'} detail="Add the accounts you want to track, then record income, expenses, and transfers." /> : <View className="gap-3">{accounts.map((account) => <Pressable accessibilityRole="button" key={account.id} onPress={() => setEditing(account)} className="min-h-[100px] flex-row items-center rounded-2xl border border-surface-800 bg-surface-900/70 p-4"><View className="items-center justify-center rounded-xl" style={{ width: 56, height: 56, backgroundColor: account.color }}><MoneyIcon name={account.icon} size={24} /></View><View className="ml-3 flex-1"><Text className="text-xl font-semibold text-surface-100">{account.name}</Text><Text className="mt-1 text-base capitalize text-surface-400">{account.kind.replace('-', ' ')}</Text></View><View className="ml-3 items-end"><Text numberOfLines={1} adjustsFontSizeToFit className={`text-xl font-bold ${account.balanceCents < 0 ? 'text-rose-400' : 'text-surface-100'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(account.balanceCents)}</Text><Pressable accessibilityRole="button" accessibilityLabel={account.archivedAt ? `Restore ${account.name}` : `Archive ${account.name}`} hitSlop={8} onPress={() => toggleArchive(account)} className="mt-1 h-9 w-9 items-end justify-center">{account.archivedAt ? <RotateCcw color="#b5b5bc" size={21} /> : <Archive color="#b5b5bc" size={21} />}</Pressable></View></Pressable>)}</View>}<View className="h-24" /></ScrollView>{!editing && !confirming && <Pressable accessibilityRole="button" accessibilityLabel="Add account" disabled={moneyState.readOnly} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600 shadow-lg"><Plus color="#fff" size={29} /></Pressable>}<Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)}>{editing && <AccountForm key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet><ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore account?' : 'Archive account?'} detail="Transaction history will stay intact." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={moneyState.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} /></View>
  }}</MoneyScreen>
}
