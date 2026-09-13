import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ChevronRight, Trash2, X } from 'lucide-react-native'
import { useNavigation } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MoneyAccount, MoneyCategory, MoneySnapshot, MoneyTransaction, TransactionInput, TransactionKind } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '../../lib/amount-input'
import { isoToday, relativeDayLabel } from '../../lib/dates'
import { AmountKeypad } from './AmountKeypad'
import { DateSheet } from './DatePicker'
import { ConfirmDialog, MoneyIcon } from './Common'
import { useMoneyTabBarStyle } from './navigation'

const KIND_COLORS: Record<TransactionKind, string> = { expense: '#e84d8a', income: '#2bb3a9', transfer: '#5b6ee1' }
const KINDS: TransactionKind[] = ['expense', 'income', 'transfer']

function Field({ label, name, icon, color, onPress }: {
  label: string
  name: string
  icon?: string
  color?: string
  onPress: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${name}`}
    onPress={onPress}
    style={{ minHeight: 60 }}
    className="flex-row items-center rounded-2xl border border-surface-800 bg-surface-900/60 px-4"
  >
    {icon && <View className="mr-3 h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#38383d' }}>
      <MoneyIcon name={icon} size={15} />
    </View>}
    <View className="flex-1">
      <Text className="text-[14px] text-surface-500">{label}</Text>
      <Text numberOfLines={1} className="mt-0.5 text-[16px] font-semibold text-surface-100">{name}</Text>
    </View>
    <ChevronRight color="#8a8a92" size={18} />
  </Pressable>
}

function OptionSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <Pressable onPress={onClose} className="flex-1 justify-end bg-black/70">
      <Pressable onPress={(event) => event.stopPropagation()} className="max-h-[70%] rounded-t-2xl border-t border-surface-700 bg-surface-950 px-4 pb-8 pt-4">
        <Text className="mb-3 text-center text-[18px] font-bold text-surface-100">{title}</Text>
        <ScrollView>{children}</ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
}

interface TransactionEntryProps {
  snapshot: MoneySnapshot
  transaction?: MoneyTransaction
  onClose: () => void
  /** Supplied when Activity reads and writes the phone's own ledger. */
  onSave?: (input: TransactionInput) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  busy?: boolean
}

export default function TransactionEntry({ snapshot, transaction, onClose, onSave, onDelete, busy = false }: TransactionEntryProps): React.ReactElement {
  const state = useMoney()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const [saveFailed, setSaveFailed] = useState(false)
  const tabBarStyle = useMoneyTabBarStyle()
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
  const [keyboardOverlap, setKeyboardOverlap] = useState(0)
  const formScroll = useRef<ScrollView>(null)

  useEffect(() => {
    navigation.setOptions({ tabBarStyle: { ...tabBarStyle, display: 'none' } })
    return () => navigation.setOptions({ tabBarStyle })
  }, [navigation, tabBarStyle])

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const windowHeight = Dimensions.get('window').height
      setKeyboardOverlap(windowHeight <= event.endCoordinates.screenY
        ? 0
        : Math.max(0, Dimensions.get('screen').height - event.endCoordinates.screenY))
      formScroll.current?.scrollToEnd({ animated: true })
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => { setKeyboardOverlap(0); setTypingNotes(false) })
    return () => { shown.remove(); hidden.remove() }
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
    setSaveFailed(false)
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: kind === 'transfer' ? destinationId : null,
      categoryId: kind === 'transfer' ? null : categoryId, amountCents: cents, date, notes: notes.trim()
    }
    const saved = onSave
      ? await onSave(input)
      : transaction ? await state.updateTransaction(transaction.id, input) : await state.createTransaction(input)
    if (saved) onClose()
    else setSaveFailed(true)
  }
  const remove = async (): Promise<void> => {
    if (!transaction) return
    const saved = onDelete ? await onDelete() : await state.deleteTransaction(transaction.id)
    if (saved) onClose()
  }

  return <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View className="flex-1 bg-surface-950">
      <View
        className="flex-1"
        style={typingNotes && Platform.OS === 'android' ? { marginBottom: keyboardOverlap } : undefined}
      >
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-1">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12} className="h-12 w-12 items-start justify-center"><X color="#b5b5bc" size={24} /></Pressable>
          <Text className="text-[16px] font-semibold text-surface-300">{transaction ? 'Edit transaction' : 'New transaction'}</Text>
          <View className="h-12 w-12 items-end justify-center">
            {transaction && <Pressable accessibilityRole="button" accessibilityLabel="Delete transaction" onPress={() => setConfirmingDelete(true)} hitSlop={12} className="h-12 w-12 items-end justify-center"><Trash2 color="#fb7185" size={21} /></Pressable>}
          </View>
        </View>

        <View className="flex-row gap-2 px-4 pb-1 pt-2">{KINDS.map((item) => <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: kind === item }}
          key={item}
          onPress={() => changeKind(item)}
          style={{ minHeight: 44 }}
          className={`flex-1 items-center justify-center rounded-xl ${kind === item ? 'bg-surface-800' : 'bg-surface-900/60'}`}
        >
          <Text className="text-[14px] font-semibold capitalize" style={{ color: kind === item ? KIND_COLORS[item] : '#8a8a92' }}>{item}</Text>
        </Pressable>)}</View>

        <ScrollView
          ref={formScroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
        {!typingNotes && <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Amount ${formatAmountExpression(expression)}`}
          accessibilityHint="Hold to clear the amount"
          onLongPress={() => setExpression('')}
          className="items-center px-4 pb-5 pt-7"
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} className="text-[52px] font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>$ {formatAmountExpression(expression)}</Text>
        </Pressable>}

        {!typingNotes && <View className="gap-2 px-4">
          <Field
            label={kind === 'transfer' ? 'From' : 'Account'}
            name={account?.name ?? 'Choose an account'}
            icon={account?.icon}
            color={account?.color}
            onPress={() => setPicking('account')}
          />
          <Field
            label={kind === 'transfer' ? 'To' : 'Category'}
            name={target?.name ?? (kind === 'transfer' ? 'Choose an account' : 'Choose a category')}
            icon={target?.icon}
            color={target?.color}
            onPress={() => setPicking('target')}
          />
          <Field label="Date" name={relativeDayLabel(date)} onPress={() => setDatePicking(true)} />
        </View>}

        {saveFailed && <Text accessibilityLiveRegion="polite" className="mx-3 mb-1 text-center text-[14px] leading-5 text-amber-300">
          Not saved yet. Your entry is kept here, so you can try again.
        </Text>}
        {typingNotes && <Text className="mx-3 mt-3 text-[14px] font-semibold text-surface-400">Transaction note</Text>}
        <TextInput
          value={notes} onChangeText={setNotes} multiline maxLength={500}
          onFocus={() => { setTypingNotes(true); requestAnimationFrame(() => formScroll.current?.scrollToEnd({ animated: true })) }} onBlur={() => setTypingNotes(false)}
          placeholder="Notes..." placeholderTextColor="#909099"
          className={`mx-4 mb-3 mt-3 rounded-xl border border-surface-800 bg-surface-900/60 px-4 py-3 text-[16px] text-surface-100 ${typingNotes ? 'min-h-24' : 'min-h-12'}`}
        />

        {typingNotes
          ? <Pressable onPress={() => Keyboard.dismiss()} className="items-center py-2.5"><Text className="text-[16px] font-semibold" style={{ color }}>Done</Text></Pressable>
          : <>
            <AmountKeypad
              onKey={(key) => setExpression((current) => pressAmountKey(current, key))}
              onOpenDate={() => setDatePicking(true)}
              onConfirm={() => void save()}
              confirmDisabled={!valid || state.busy || busy}
              confirmColor={color}
              busy={state.busy || busy}
            />
          </>}
        </ScrollView>
      </View>
    </View>
    </KeyboardAvoidingView>

    <OptionSheet visible={picking === 'account'} title="From account" onClose={() => setPicking(null)}>
      {accounts.map((item) => <Pressable key={item.id} onPress={() => { setAccountId(item.id); if (item.id === destinationId) setDestinationId(''); setPicking(null) }} className={`mb-1.5 flex-row items-center rounded-xl border px-2.5 py-2 ${accountId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
        <View className="h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: item.color }}><MoneyIcon name={item.icon} size={15} /></View>
        <Text className={`ml-2 text-[16px] font-semibold ${accountId === item.id ? 'text-accent-300' : 'text-surface-200'}`}>{item.name}</Text>
      </Pressable>)}
    </OptionSheet>

    <OptionSheet visible={picking === 'target'} title={kind === 'transfer' ? 'To account' : 'To category'} onClose={() => setPicking(null)}>
      {kind === 'transfer'
        ? accounts.filter((item) => item.id !== accountId).map((item) => <Pressable key={item.id} onPress={() => { setDestinationId(item.id); setPicking(null) }} className={`mb-1.5 flex-row items-center rounded-xl border px-2.5 py-2 ${destinationId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
            <View className="h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: item.color }}><MoneyIcon name={item.icon} size={15} /></View>
            <Text className={`ml-2 text-[16px] font-semibold ${destinationId === item.id ? 'text-accent-300' : 'text-surface-200'}`}>{item.name}</Text>
          </Pressable>)
        : <View className="flex-row flex-wrap gap-1.5">{categories.map((item) => <Pressable key={item.id} onPress={() => { setCategoryId(item.id); setPicking(null) }} className={`flex-row items-center rounded-full border px-2.5 py-1.5 ${categoryId === item.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}>
            <MoneyIcon name={item.icon} color={item.color} size={12} />
            <Text className={`ml-1.5 text-[14px] ${categoryId === item.id ? 'font-semibold text-accent-300' : 'text-surface-300'}`}>{item.name}</Text>
          </Pressable>)}</View>}
      {kind !== 'transfer' && categories.length === 0 && <Text className="text-center text-[14px] text-amber-400">Create an active {kind} category first.</Text>}
    </OptionSheet>

    <DateSheet visible={datePicking} value={date} onClose={() => setDatePicking(false)} onChange={setDate} />

    <ConfirmDialog
      visible={confirmingDelete} title="Delete transaction?" detail="This will update the account balances immediately."
      confirmLabel="Delete" destructive busy={state.busy || busy} hideNavigation={false}
      onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()}
    />
  </Modal>
}
