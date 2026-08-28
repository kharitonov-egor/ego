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
  return <View><Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Chase checking" placeholderTextColor="#3c4b73" className={inputClass} /></Label><Label text="Account type"><Chips values={KINDS} value={kind} onChange={setKind} /></Label><Label text="Opening balance in USD"><TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" className={inputClass} /></Label><Label text="Opening date"><TextInput value={date} onChangeText={setDate} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor="#3c4b73" className={inputClass} /></Label><Label text="Icon"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{ICON_OPTIONS.slice(0, 7).map((item) => <Pressable key={item} onPress={() => setIcon(item)} className={`rounded-xl border p-3 ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#60a5fa' : '#8a93ab'} /></Pressable>)}</ScrollView></Label><Label text="Color"><View className="flex-row flex-wrap gap-3">{COLORS.map((item) => <Pressable key={item} onPress={() => setColor(item)} className={`h-8 w-8 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label><PrimaryButton label={account ? 'Save account' : 'Create account'} disabled={!valid || moneyState.busy} onPress={() => void save()} /></View>
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
    return <View className="flex-1"><View className="border-b border-surface-800 px-5 py-5"><Text className="text-xs uppercase tracking-widest text-surface-500">All accounts</Text><Text className={`mt-1 text-3xl font-light ${total < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{money(total)}</Text><Pressable onPress={() => setArchived(!archived)} className="mt-3 self-start rounded-full bg-surface-900 px-3 py-1.5"><Text className="text-xs text-surface-400">{archived ? 'Show active' : 'Show archived'}</Text></Pressable></View><ScrollView className="flex-1 px-5 pt-4" refreshControl={undefined}>{accounts.length === 0 ? <Empty title={archived ? 'No archived accounts' : 'Create your first account'} detail="Add the accounts you want to track, then record income, expenses, and transfers." /> : <View className="gap-3">{accounts.map((account) => <Pressable key={account.id} onPress={() => setEditing(account)} className="flex-row items-center rounded-2xl border border-surface-800 bg-surface-900/70 p-4"><View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} /></View><View className="ml-3 flex-1"><Text className="text-base text-surface-100">{account.name}</Text><Text className="mt-0.5 text-xs capitalize text-surface-500">{account.kind.replace('-', ' ')}</Text></View><View className="items-end"><Text className={account.balanceCents < 0 ? 'text-rose-400' : 'text-emerald-400'}>{money(account.balanceCents)}</Text><Pressable hitSlop={8} onPress={() => toggleArchive(account)} className="mt-2">{account.archivedAt ? <RotateCcw color="#636f8f" size={15} /> : <Archive color="#636f8f" size={15} />}</Pressable></View></Pressable>)}</View>}<View className="h-24" /></ScrollView>{!editing && !confirming && <Pressable disabled={moneyState.readOnly} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600 shadow-lg"><Plus color="#fff" size={25} /></Pressable>}<Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)}>{editing && <AccountForm key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet><ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore account?' : 'Archive account?'} detail="Transaction history will stay intact." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={moneyState.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} /></View>
  }}</MoneyScreen>
}
