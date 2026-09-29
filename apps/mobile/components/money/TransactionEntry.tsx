import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native'
import { CalendarDays, Check, ChevronDown, Trash2, X } from 'lucide-react-native'
import { useNavigation } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MoneyAccount, MoneyCategory, MoneySnapshot, MoneyTransaction, TransactionInput, TransactionKind } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '../../lib/amount-input'
import { isoToday, relativeDayLabel } from '../../lib/dates'
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control'
import { Text } from '../ui/text'
import { AmountKeypad } from './AmountKeypad'
import { DateSheet } from './DatePicker'
import { BottomSheet, ConfirmDialog, MoneyIcon, money } from './Common'
import { useMoneyTabBarStyle } from './navigation'
import { color as palette } from './tokens'
import { Blurred } from '../../lib/blur'

const KIND_OPTIONS: SegmentedOption<TransactionKind>[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' }
]

const AMOUNT_COLOR: Record<TransactionKind, string> = { expense: palette.expense, income: palette.positive, transfer: palette.text }

function Field({ label, name, icon, color, placeholder, onPress }: {
  label: string
  name?: string
  icon?: string
  color?: string
  placeholder: string
  onPress: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${name ?? placeholder}`}
    onPress={onPress}
    className="min-h-[68px] flex-1 flex-row items-center rounded-2xl border border-border bg-card px-3 active:bg-surface-900"
  >
    <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#262626' }}>
      <MoneyIcon name={icon ?? 'Tag'} color={icon ? '#ffffff' : '#737373'} size={18} />
    </View>
    <View className="ml-2.5 flex-1">
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text numberOfLines={1} className={`text-[16px] font-semibold ${name ? 'text-foreground' : 'text-surface-500'}`}>{name ?? placeholder}</Text>
    </View>
  </Pressable>
}

function AccountOption({ account, selected, onPress }: { account: MoneyAccount; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    onPress={onPress}
    className={`mb-2 min-h-[68px] flex-row items-center rounded-2xl border px-3 ${selected ? 'border-surface-500 bg-surface-900' : 'border-border bg-card active:bg-surface-900'}`}
  >
    <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} size={21} /></View>
    <View className="ml-3 flex-1">
      <Text numberOfLines={1} className="text-[17px] font-semibold">{account.name}</Text>
      <Blurred tint={palette.textMuted}><Text className="text-[14px] text-muted-foreground">{money(account.balanceCents)}</Text></Blurred>
    </View>
    {selected && <Check color="#fafafa" size={22} />}
  </Pressable>
}

function CategoryOption({ category, selected, onPress }: { category: MoneyCategory; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={category.name}
    accessibilityState={{ selected }}
    onPress={onPress}
    className="mb-4 w-1/4 items-center px-1"
  >
    <View className={`h-16 w-16 items-center justify-center rounded-full ${selected ? 'border-[3px] border-white' : ''}`} style={{ backgroundColor: category.color }}>
      <MoneyIcon name={category.icon} size={26} />
    </View>
    <Text numberOfLines={2} className={`mt-1.5 text-center text-[14px] leading-[18px] ${selected ? 'font-semibold text-foreground' : 'text-surface-300'}`}>{category.name}</Text>
  </Pressable>
}

interface TransactionEntryProps {
  snapshot: MoneySnapshot
  transaction?: MoneyTransaction
  onClose: () => void
  onSave?: (input: TransactionInput) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  busy?: boolean
}

export default function TransactionEntry({ snapshot, transaction, onClose, onSave, onDelete, busy = false }: TransactionEntryProps): React.ReactElement {
  const state = useMoney()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const [saveFailed, setSaveFailed] = useState(false)
  const saving = useRef(false)
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

  const changeKind = (value: TransactionKind): void => {
    if (value === kind) return
    setKind(value)
    setDestinationId('')
    setCategoryId(lastUsedCategory(value))
  }
  const save = async (): Promise<void> => {
    if (saving.current) return
    saving.current = true
    setSaveFailed(false)
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: kind === 'transfer' ? destinationId : null,
      categoryId: kind === 'transfer' ? null : categoryId, amountCents: cents, date, notes: notes.trim()
    }
    try {
      const saved = onSave
        ? await onSave(input)
        : transaction ? await state.updateTransaction(transaction.id, input) : await state.createTransaction(input)
      if (saved) onClose()
      else setSaveFailed(true)
    } finally {
      saving.current = false
    }
  }
  const remove = async (): Promise<void> => {
    if (!transaction) return
    const saved = onDelete ? await onDelete() : await state.deleteTransaction(transaction.id)
    if (saved) onClose()
  }

  return <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View className="flex-1 bg-background">
      <View
        className="flex-1"
        style={typingNotes && Platform.OS === 'android' ? { marginBottom: keyboardOverlap } : undefined}
      >
        <View style={{ paddingTop: insets.top + 6 }} className="flex-row items-center justify-between px-4 pb-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-900 active:bg-surface-800"><X color="#fafafa" size={22} /></Pressable>
          <Text accessibilityRole="header" className="text-[18px] font-semibold">{transaction ? 'Edit transaction' : 'New transaction'}</Text>
          <View className="h-11 w-11">
            {transaction && <Pressable accessibilityRole="button" accessibilityLabel="Delete transaction" onPress={() => setConfirmingDelete(true)} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-900 active:bg-surface-800"><Trash2 color="#fb7185" size={20} /></Pressable>}
          </View>
        </View>

        <SegmentedControl options={KIND_OPTIONS} value={kind} onValueChange={changeKind} className="mx-4 mt-1" />

        {!typingNotes && <View className="flex-1 items-center justify-center px-4" style={{ minHeight: 120 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Amount ${formatAmountExpression(expression)}`}
            accessibilityHint="Hold to clear the amount"
            onLongPress={() => setExpression('')}
            className="w-full items-center"
          >
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} className="text-[60px] font-bold tracking-tight" style={{ color: AMOUNT_COLOR[kind] }}>${formatAmountExpression(expression)}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Date: ${relativeDayLabel(date)}`}
            onPress={() => setDatePicking(true)}
            className="mt-2 min-h-10 flex-row items-center gap-2 rounded-full border border-input bg-surface-900 px-4 active:bg-surface-800"
          >
            <CalendarDays color="#d4d4d4" size={16} />
            <Text className="text-[15px] font-medium text-surface-200">{relativeDayLabel(date)}</Text>
            <ChevronDown color="#a3a3a3" size={16} />
          </Pressable>
        </View>}

        {!typingNotes && <View className="flex-row gap-2.5 px-4">
          <Field
            label={kind === 'transfer' ? 'From' : 'Account'}
            name={account?.name}
            icon={account?.icon}
            color={account?.color}
            placeholder="Choose"
            onPress={() => setPicking('account')}
          />
          <Field
            label={kind === 'transfer' ? 'To' : 'Category'}
            name={target?.name}
            icon={target?.icon}
            color={target?.color}
            placeholder="Choose"
            onPress={() => setPicking('target')}
          />
        </View>}

        {saveFailed && <Text accessibilityLiveRegion="polite" className="mx-4 mt-2 text-center text-[14px] leading-5 text-amber-300">
          Not saved yet. Your entry is kept here, so you can try again.
        </Text>}
        {typingNotes && <Text className="mx-4 mt-4 text-[15px] font-medium text-surface-200">Note</Text>}
        <TextInput
          value={notes} onChangeText={setNotes} multiline maxLength={500}
          onFocus={() => setTypingNotes(true)} onBlur={() => setTypingNotes(false)}
          accessibilityLabel="Note"
          placeholder="Add a note, like Publix"
          placeholderTextColor="#737373"
          className={`mx-4 mb-3 mt-2.5 rounded-2xl border border-border bg-card px-4 py-3.5 text-[17px] text-foreground ${typingNotes ? 'min-h-28' : 'min-h-[52px]'}`}
        />

        {typingNotes
          ? <Pressable onPress={() => Keyboard.dismiss()} className="mx-4 min-h-12 items-center justify-center rounded-xl bg-primary">
            <Text className="font-semibold text-primary-foreground">Done</Text>
          </Pressable>
          : <View style={{ flex: 2, minHeight: 272, paddingBottom: Math.max(insets.bottom, 8) + 6 }}>
            <AmountKeypad
              onKey={(key) => setExpression((current) => pressAmountKey(current, key))}
              onOpenDate={() => setDatePicking(true)}
              onConfirm={() => void save()}
              confirmDisabled={!valid || state.busy || busy}
              busy={state.busy || busy}
            />
          </View>}
      </View>
    </View>
    </KeyboardAvoidingView>

    <BottomSheet visible={picking === 'account'} title={kind === 'transfer' ? 'From account' : 'Account'} onClose={() => setPicking(null)} dismissOnBackdrop>
      {accounts.map((item) => <AccountOption
        key={item.id}
        account={item}
        selected={accountId === item.id}
        onPress={() => { setAccountId(item.id); if (item.id === destinationId) setDestinationId(''); setPicking(null) }}
      />)}
    </BottomSheet>

    <BottomSheet visible={picking === 'target'} title={kind === 'transfer' ? 'To account' : kind === 'income' ? 'Income category' : 'Expense category'} onClose={() => setPicking(null)} dismissOnBackdrop>
      {kind === 'transfer'
        ? accounts.filter((item) => item.id !== accountId).map((item) => <AccountOption
          key={item.id}
          account={item}
          selected={destinationId === item.id}
          onPress={() => { setDestinationId(item.id); setPicking(null) }}
        />)
        : <View className="-mx-1 flex-row flex-wrap">{categories.map((item) => <CategoryOption
          key={item.id}
          category={item}
          selected={categoryId === item.id}
          onPress={() => { setCategoryId(item.id); setPicking(null) }}
        />)}</View>}
      {kind !== 'transfer' && categories.length === 0 && <Text className="py-6 text-center text-amber-400">Create an active {kind} category first.</Text>}
    </BottomSheet>

    <DateSheet visible={datePicking} value={date} onClose={() => setDatePicking(false)} onChange={setDate} />

    <ConfirmDialog
      visible={confirmingDelete} title="Delete transaction?" detail="This will update the account balances immediately."
      confirmLabel="Delete" destructive busy={state.busy || busy} hideNavigation={false}
      onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()}
    />
  </Modal>
}
