import React, { useEffect, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Trash2, X } from 'lucide-react-native'
import { useNavigation } from 'expo-router'
import type { MoneyAccount, MoneyCategory, MoneySnapshot, MoneyTransaction, TransactionInput, TransactionKind } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '../../lib/amount-input'
import { isoToday, relativeDayLabel } from '../../lib/dates'
import { AmountKeypad } from './AmountKeypad'
import { DateSheet } from './DatePicker'
import { ConfirmDialog, MoneyIcon } from './Common'
import { moneyTabBarStyle } from './navigation'

const KIND_COLORS: Record<TransactionKind, string> = { expense: '#e84d8a', income: '#2bb3a9', transfer: '#5b6ee1' }
const KINDS: TransactionKind[] = ['expense', 'income', 'transfer']

function Badge({ icon, color, round, className }: { icon: string; color: string; round: boolean; className: string }): React.ReactElement {
  return <View className={`absolute top-0 h-12 w-12 items-center justify-center border-4 border-surface-950 bg-surface-100 ${round ? 'rounded-full' : 'rounded-2xl'} ${className}`}>
    <MoneyIcon name={icon} color={color} size={20} />
  </View>
}

function Tile({ label, name, color, onPress }: { label: string; name: string; color: string; onPress: () => void }): React.ReactElement {
  return <Pressable onPress={onPress} style={{ backgroundColor: color }} className="flex-1 justify-center px-4 py-4">
    <Text className="text-xs text-white/70" style={{ color: '#b1b7c7' }}>{label}</Text>
    <Text numberOfLines={1} className="mt-0.5 text-xl text-white" style={{ color: '#d8dbe3' }}>{name}</Text>
  </Pressable>
}

function OptionSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 justify-end bg-black/70">
      <Pressable onPress={(event) => event.stopPropagation()} className="max-h-[70%] rounded-t-3xl border-t border-surface-700 bg-surface-950 px-5 pb-10 pt-5">
        <Text className="mb-4 text-center text-base font-semibold text-surface-100">{title}</Text>
        <ScrollView>{children}</ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
}

export default function TransactionEntry({ snapshot, transaction, onClose }: { snapshot: MoneySnapshot; transaction?: MoneyTransaction; onClose: () => void }): React.ReactElement {
  const state = useMoney()
  const navigation = useNavigation()
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt || item.id === transaction?.accountId || item.id === transaction?.destinationAccountId)
  const openAccounts = accounts.filter((item) => !item.archivedAt)
  const lastUsedAccount = (): string => {
    const recent = snapshot.transactions.find((item) => openAccounts.some((account) => account.id === item.accountId))
    return recent?.accountId ?? openAccounts[0]?.id ?? ''
  }
  const lastUsedCategory = (value: TransactionKind): string => {
    const open = snapshot.categories.filter((item) => item.kind === value && !item.archivedAt)
    const recent = snapshot.transactions.find((item) => item.kind === value && open.some((category) => category.id === item.categoryId))
    return recent?.categoryId ?? ''
  }
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? 'expense')
  const [accountId, setAccountId] = useState(() => transaction?.accountId ?? lastUsedAccount())
  const [destinationId, setDestinationId] = useState(transaction?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(() => transaction?.categoryId ?? lastUsedCategory(transaction?.kind ?? 'expense'))
  const [expression, setExpression] = useState(transaction ? amountToExpression(transaction.amountCents) : '')
  const [date, setDate] = useState(transaction?.date ?? isoToday())
  const [notes, setNotes] = useState(transaction?.notes ?? '')
  const [picking, setPicking] = useState<'account' | 'target' | null>(null)
  const [datePicking, setDatePicking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [typingNotes, setTypingNotes] = useState(false)

  useEffect(() => {
    navigation.setOptions({ tabBarStyle: { ...moneyTabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle: moneyTabBarStyle })
  }, [navigation])

  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTypingNotes(false))
    return () => hidden.remove()
  }, [])

  const categories = snapshot.categories.filter((item) => item.kind === kind && (!item.archivedAt || item.id === transaction?.categoryId))
  const account = accounts.find((item) => item.id === accountId)
  const destination = accounts.find((item) => item.id === destinationId)
  const category = snapshot.categories.find((item) => item.id === categoryId)
  const target: MoneyAccount | MoneyCategory | undefined = kind === 'transfer' ? destination : category
  const cents = evaluateAmount(expression) ?? 0
  const valid = Boolean(accountId && cents > 0 && date && (kind === 'transfer' ? destinationId && destinationId !== accountId : categoryId))
  const color = KIND_COLORS[kind]

  const changeKind = (value: TransactionKind): void => { setKind(value); setDestinationId(''); setCategoryId(lastUsedCategory(value)) }
  const save = async (): Promise<void> => {
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: kind === 'transfer' ? destinationId : null,
      categoryId: kind === 'transfer' ? null : categoryId, amountCents: cents, date, notes: notes.trim()
    }
    const saved = transaction ? await state.updateTransaction(transaction.id, input) : await state.createTransaction(input)
    if (saved) onClose()
  }
  const remove = async (): Promise<void> => {
    if (!transaction) return
    const saved = await state.deleteTransaction(transaction.id)
    if (saved) onClose()
  }

  return <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View className="flex-1 justify-end bg-black/70">
      <View className="rounded-t-3xl border-t border-surface-700 bg-surface-950 pb-8">
        <View className="flex-row items-center justify-between px-4 py-3">
          <View className="flex-row gap-2">{KINDS.map((item) => <Pressable key={item} onPress={() => changeKind(item)} className={`rounded-full px-3 py-1.5 ${kind === item ? 'bg-surface-700' : 'bg-surface-900'}`}>
            <Text className="text-xs capitalize" style={{ color: kind === item ? KIND_COLORS[item] : '#8a93ab' }}>{item}</Text>
          </Pressable>)}</View>
          <View className="flex-row items-center gap-4">
            {transaction && <Pressable onPress={() => setConfirmingDelete(true)} hitSlop={10}><Trash2 color="#fb7185" size={19} /></Pressable>}
            <Pressable onPress={onClose} hitSlop={10}><X color="#8a93ab" size={21} /></Pressable>
          </View>
        </View>

        <View className="pt-5">
          <View className="flex-row">
            <Tile label="From account" name={account?.name ?? 'Select account'} color={account?.color ?? '#2d3a5c'} onPress={() => setPicking('account')} />
            <Tile label={kind === 'transfer' ? 'To account' : 'To category'} name={target?.name ?? (kind === 'transfer' ? 'Select account' : 'Select category')} color={target?.color ?? '#2d3a5c'} onPress={() => setPicking('target')} />
          </View>
          {account && <Badge icon={account.icon} color={account.color} round={false} className="left-[36%]" />}
          {target && <Badge icon={target.icon} color={target.color} round className="right-5" />}
        </View>

        <Pressable onLongPress={() => setExpression('')} className="items-center py-4">
          <Text className="text-xs capitalize" style={{ color }}>{kind}</Text>
          <Text numberOfLines={1} className="mt-1 text-4xl font-light" style={{ color }}>$ {formatAmountExpression(expression)}</Text>
        </Pressable>

        <TextInput
          value={notes} onChangeText={setNotes} multiline maxLength={500}
          onFocus={() => setTypingNotes(true)} onBlur={() => setTypingNotes(false)}
          placeholder="Notes..." placeholderTextColor="#3c4b73"
          className="mx-4 mb-3 min-h-14 rounded-2xl border border-surface-800 px-4 py-3 text-center text-sm text-surface-100"
        />

        {typingNotes
          ? <Pressable onPress={() => Keyboard.dismiss()} className="items-center py-3"><Text className="text-sm font-semibold" style={{ color }}>Done</Text></Pressable>
          : <>
            <AmountKeypad
              onKey={(key) => setExpression((current) => pressAmountKey(current, key))}
              onOpenDate={() => setDatePicking(true)}
              onConfirm={() => void save()}
              confirmDisabled={!valid || state.busy}
              confirmColor={color}
            />
            <Pressable onPress={() => setDatePicking(true)} className="items-center pt-4">
              <Text className="text-sm text-surface-400">{relativeDayLabel(date)}</Text>
            </Pressable>
          </>}
      </View>
    </View>

    <OptionSheet visible={picking === 'account'} title="From account" onClose={() => setPicking(null)}>
      {accounts.map((item) => <Pressable key={item.id} onPress={() => { setAccountId(item.id); if (item.id === destinationId) setDestinationId(''); setPicking(null) }} className={`mb-2 flex-row items-center rounded-2xl border px-3 py-3 ${accountId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
        <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: item.color }}><MoneyIcon name={item.icon} size={17} /></View>
        <Text className={`ml-3 text-sm ${accountId === item.id ? 'text-accent-300' : 'text-surface-200'}`} style={{ color: accountId === item.id ? '#93c5fd' : '#b1b7c7' }}>{item.name}</Text>
      </Pressable>)}
    </OptionSheet>

    <OptionSheet visible={picking === 'target'} title={kind === 'transfer' ? 'To account' : 'To category'} onClose={() => setPicking(null)}>
      {kind === 'transfer'
        ? accounts.filter((item) => item.id !== accountId).map((item) => <Pressable key={item.id} onPress={() => { setDestinationId(item.id); setPicking(null) }} className={`mb-2 flex-row items-center rounded-2xl border px-3 py-3 ${destinationId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: item.color }}><MoneyIcon name={item.icon} size={17} /></View>
            <Text className={`ml-3 text-sm ${destinationId === item.id ? 'text-accent-300' : 'text-surface-200'}`} style={{ color: destinationId === item.id ? '#93c5fd' : '#b1b7c7' }}>{item.name}</Text>
          </Pressable>)
        : <View className="flex-row flex-wrap gap-2">{categories.map((item) => <Pressable key={item.id} onPress={() => { setCategoryId(item.id); setPicking(null) }} className={`flex-row items-center rounded-full border px-3 py-2.5 ${categoryId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
            <MoneyIcon name={item.icon} color={item.color} size={15} />
            <Text className={`ml-2 text-sm ${categoryId === item.id ? 'text-accent-300' : 'text-surface-300'}`} style={{ color: categoryId === item.id ? '#93c5fd' : '#8a93ab' }}>{item.name}</Text>
          </Pressable>)}</View>}
      {kind !== 'transfer' && categories.length === 0 && <Text className="text-center text-xs text-amber-400">Create an active {kind} category first.</Text>}
    </OptionSheet>

    <DateSheet visible={datePicking} value={date} onClose={() => setDatePicking(false)} onChange={setDate} />

    <ConfirmDialog
      visible={confirmingDelete} title="Delete transaction?" detail="This will update the account balances immediately."
      confirmLabel="Delete" destructive busy={state.busy} hideNavigation={false}
      onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()}
    />
  </Modal>
}
