import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Archive, Plus, RotateCcw } from 'lucide-react-native'
import type { AccountInput, AccountKind, MoneyAccount } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import {
  Chips, COLORS, ConfirmDialog, Empty, ICON_OPTIONS, Label, MoneyIcon, MoneyScreen,
  PrimaryButton, Sheet, inputClass, money, today
} from '../../components/money/Common'
import { CARD, CARD_PADDING, HERO_AMOUNT, tabular } from '../../components/money/tokens'

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
  return <View><Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Chase checking" placeholderTextColor="#909099" className={inputClass} /></Label><Label text="Account type"><Chips values={KINDS} value={kind} onChange={setKind} /></Label><Label text="Opening balance in USD"><TextInput value={balance} onChangeText={setBalance} keyboardType="decimal-pad" className={inputClass} /></Label><Label text="Opening date"><TextInput value={date} onChangeText={setDate} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor="#909099" className={inputClass} /></Label><Label text="Icon"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{ICON_OPTIONS.slice(0, 7).map((item) => <Pressable accessibilityRole="button" accessibilityLabel={`Use ${item} icon`} accessibilityState={{ selected: icon === item }} key={item} onPress={() => setIcon(item)} className={`h-11 w-11 items-center justify-center rounded-lg border ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#91c4ff' : '#b5b5bc'} /></Pressable>)}</ScrollView></Label><Label text="Color"><View className="flex-row flex-wrap gap-2">{COLORS.map((item) => <Pressable accessibilityRole="button" accessibilityLabel={`Use color ${item}`} accessibilityState={{ selected: color === item }} key={item} onPress={() => setColor(item)} className={`h-11 w-11 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label><PrimaryButton label={account ? 'Save account' : 'Create account'} disabled={!valid || moneyState.busy} onPress={() => void save()} /></View>
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
    return <View className="flex-1">
      <View className="px-4 pb-4 pt-5">
        <View className="overflow-hidden rounded-3xl bg-accent-600 px-5 pb-5 pt-6">
          <Text className="text-[14px] font-semibold uppercase tracking-wider text-white/70">Total balance</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            className={`mt-1.5 ${HERO_AMOUNT} text-white`}
            style={tabular}
          >{money(total)}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setArchived(!archived)}
            style={{ minHeight: 44 }}
            className="mt-5 self-start justify-center rounded-full bg-black/20 px-4"
          ><Text className="text-[14px] font-semibold text-white">{archived ? 'Show active' : 'Show archived'}</Text></Pressable>
        </View>
      </View>

      <ScrollView className="flex-1 px-4">
        {accounts.length === 0
          ? <Empty title={archived ? 'No archived accounts' : 'Create your first account'} detail="Add the accounts you want to track, then record income, expenses, and transfers." />
          : <View className="gap-3">{accounts.map((account) => <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${account.name}, ${money(account.balanceCents)}`}
            accessibilityHint="Opens the account editor"
            key={account.id}
            onPress={() => setEditing(account)}
            android_ripple={{ color: 'rgba(145, 196, 255, 0.12)' }}
            className={`${CARD} ${CARD_PADDING}`}
          >
            <View className="flex-row items-center">
              <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: account.color }}>
                <MoneyIcon name={account.icon} size={20} />
              </View>
              <View className="ml-3 flex-1">
                <Text numberOfLines={1} className="text-[16px] font-semibold text-surface-100">{account.name}</Text>
                <Text className="mt-0.5 text-[14px] capitalize text-surface-500">{account.kind.replace('-', ' ')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={account.archivedAt ? `Restore ${account.name}` : `Archive ${account.name}`}
                hitSlop={10}
                onPress={() => toggleArchive(account)}
                className="h-12 w-12 items-end justify-center"
              >{account.archivedAt ? <RotateCcw color="#8a8a92" size={17} /> : <Archive color="#8a8a92" size={17} />}</Pressable>
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className={`mt-4 text-[28px] font-bold ${account.balanceCents < 0 ? 'text-destructive' : 'text-surface-50'}`}
              style={tabular}
            >{money(account.balanceCents)}</Text>
          </Pressable>)}</View>}
        <View className="h-28" />
      </ScrollView>

      {!editing && !confirming && <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add account"
        disabled={moneyState.readOnly}
        onPress={() => setEditing('new')}
        style={{ minHeight: 48 }}
        className="absolute bottom-5 right-4 flex-row items-center rounded-2xl bg-accent-600 px-5"
      ><Plus color="#fff" size={19} /><Text className="ml-1.5 text-[16px] font-semibold text-white">Account</Text></Pressable>}

      <Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)}>{editing && <AccountForm key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet>
      <ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore account?' : 'Archive account?'} detail="Transaction history will stay intact." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={moneyState.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} />
    </View>
  }}</MoneyScreen>
}
