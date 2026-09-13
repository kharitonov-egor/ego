import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, Check, Plus, ScanLine, Search, Trash2, X } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot, MoneyTransaction } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { usePeriod } from '../../lib/period-context'
import { ConfirmDialog, Empty, MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money } from '../../components/money/Common'
import { transactionPage } from '../../lib/transaction-page'
import TransactionEntry from '../../components/money/TransactionEntry'
import LocalActivity from '../../components/money/LocalActivity'
import { useLedger } from '../../lib/ledger-context'
import { ROW_MIN_HEIGHT, TOUCH, amountColor, amountSign, tabular } from '../../components/money/tokens'

function title(transaction: MoneyTransaction, snapshot: MoneySnapshot): string {
  if (transaction.kind === 'transfer') return snapshot.accounts.find((item) => item.id === transaction.destinationAccountId)?.name ?? 'Transfer'
  return snapshot.categories.find((item) => item.id === transaction.categoryId)?.name ?? 'Archived category'
}

export default function Transactions(): React.ReactElement {
  const ledger = useLedger()
  if (ledger.enabled) return <LocalActivity />
  return <LegacyTransactions />
}

function LegacyTransactions(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { range } = usePeriod()
  const params = useLocalSearchParams<{ new?: string }>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    setPage(0)
    setSelecting(false)
    setSelected([])
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [search, range.from, range.to])
  const [editing, setEditing] = useState<MoneyTransaction | 'new' | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  useEffect(() => {
    if (params.new !== 'true') return
    setEditing('new')
    router.setParams({ new: undefined })
  }, [params.new, router])

  const exitSelection = (): void => { setSelecting(false); setSelected([]) }
  const toggle = (id: string): void => setSelected((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const startSelection = (id: string): void => { setSelecting(true); setSelected([id]) }
  const removeSelected = async (): Promise<void> => {
    const deleted = await state.deleteTransactions(selected)
    setConfirmingBulk(false)
    if (deleted) exitSelection()
  }

  return <MoneyScreen>{(snapshot) => {
    const query = search.trim().toLowerCase()
    const transactions = filteredTransactions(snapshot, range).filter((item) => {
      const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)?.name ?? ''
      const merchant = snapshot.purchases.find((purchase) => purchase.transactionId === item.id)?.merchant ?? ''
      const destination = snapshot.accounts.find((accountItem) => accountItem.id === item.destinationAccountId)?.name ?? ''
      return !query || merchant.toLowerCase().includes(query) || destination.toLowerCase().includes(query) || item.notes.toLowerCase().includes(query) || title(item, snapshot).toLowerCase().includes(query) || account.toLowerCase().includes(query)
    })
    const pagination = transactionPage(transactions, page)
    const visibleIds = pagination.items.map((item) => item.id)
    const changePage = (next: number): void => {
      setPage(next)
      exitSelection()
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    }
    const groups = new Map<string, MoneyTransaction[]>()
    pagination.items.forEach((item) => groups.set(item.date, [...(groups.get(item.date) ?? []), item]))
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))

    return <View className="flex-1">
      {selecting
        ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-2 py-1.5">
          <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={8} className="h-12 w-12 items-center justify-center"><X color="#b5b5bc" size={19} /></Pressable>
          <Text className="text-[16px] font-semibold text-surface-100">{selected.length} selected</Text>
          <Pressable accessibilityRole="button" onPress={() => setSelected(allSelected ? [] : visibleIds)} style={{ minHeight: TOUCH }} className="ml-auto justify-center rounded-full border border-surface-700 bg-surface-900 px-3"><Text className="text-[14px] font-semibold text-surface-300">{allSelected ? 'Clear page' : 'Select page'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${selected.length} selected`} disabled={selected.length === 0 || state.readOnly} onPress={() => setConfirmingBulk(true)} style={{ minHeight: TOUCH, minWidth: TOUCH }} className={`items-center justify-center rounded-full ${selected.length === 0 || state.readOnly ? 'bg-surface-800' : 'bg-destructive'}`}><Trash2 color={selected.length === 0 || state.readOnly ? '#707078' : '#1c1d1f'} size={17} /></Pressable>
        </View>
        : <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3">
          <Search color="#8a8a92" size={16} />
          <TextInput value={search} onChangeText={setSearch} accessibilityLabel="Search transactions" placeholder="Search activity" placeholderTextColor="#8a8a92" returnKeyType="search" className="ml-2 flex-1 py-2.5 text-[16px] text-surface-100" />
          {search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} hitSlop={8} className="h-12 w-10 items-center justify-center"><X color="#8a8a92" size={16} /></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Select transactions" disabled={pagination.items.length === 0} onPress={() => setSelecting(true)} style={{ minHeight: TOUCH }} className="justify-center pl-2"><Text className={`text-[14px] font-semibold ${pagination.items.length === 0 ? 'text-surface-600' : 'text-accent-400'}`}>Select</Text></Pressable>
        </View>}

      <PeriodChips />

      <ScrollView ref={scrollRef} className="flex-1 px-4" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {transactions.length > 0 && <Text accessibilityLiveRegion="polite" className="mb-1 pt-3 text-[14px] text-surface-500">{pagination.start + 1}-{pagination.end} of {transactions.length} transactions</Text>}
        {transactions.length === 0
          ? <Empty title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail={snapshot.transactions.length ? 'Try another search or choose a wider period.' : 'Add income, an expense, or a transfer between two accounts.'} />
          : <View>{Array.from(groups.entries()).map(([date, items]) => <View key={date}>
            <View className="flex-row items-end justify-between pb-2 pt-5">
              <Text className="text-[14px] font-semibold uppercase tracking-wider text-surface-400">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
              <Text accessibilityLabel={`${pagination.items.length < transactions.length ? 'Net of the shown rows' : 'Net'} ${money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}`} className="text-[14px] font-semibold text-surface-400" style={tabular}>{pagination.items.length < transactions.length ? 'Shown ' : ''}{money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}</Text>
            </View>
            <View className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/70">{items.map((item, index) => {
              const category = snapshot.categories.find((categoryItem) => categoryItem.id === item.categoryId)
              const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)
              const purchase = snapshot.purchases.find((purchaseItem) => purchaseItem.transactionId === item.id)
              const checked = selected.includes(item.id)
              const open = (): void => {
                if (selecting) { toggle(item.id); return }
                if (purchase) router.push({ pathname: '/(money)/purchases', params: { purchaseId: purchase.id } })
                else setEditing(item)
              }
              return <Pressable
                accessibilityRole="button"
                accessibilityState={selecting ? { selected: checked } : undefined}
                accessibilityHint={selecting ? undefined : 'Hold to select several transactions'}
                key={item.id}
                onPress={open}
                onLongPress={() => selecting ? toggle(item.id) : startSelection(item.id)}
                delayLongPress={350}
                android_ripple={{ color: 'rgba(145, 196, 255, 0.12)' }}
                style={{ minHeight: ROW_MIN_HEIGHT }}
                className={`flex-row items-center px-4 py-3 ${index > 0 ? 'border-t border-surface-800' : ''} ${checked ? 'bg-accent-500/15' : ''}`}
              >
                {selecting && <View className={`mr-3 h-6 w-6 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>{checked && <Check color="#fff" size={13} strokeWidth={3} />}</View>}
                <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#38383d' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={15} /></View>
                <View className="ml-3 flex-1">
                  <Text numberOfLines={2} className="text-[16px] font-semibold text-surface-100">{purchase?.merchant ?? title(item, snapshot)}</Text>
                  <View className="mt-0.5 flex-row flex-wrap items-center">
                    <Text className="text-[14px] text-surface-400">{account?.name ?? 'Archived account'}</Text>
                    {item.kind === 'transfer' && <><ArrowRight color="#8a8a92" size={11} style={{ marginHorizontal: 4 }} /><Text className="text-[14px] text-surface-400">{title(item, snapshot)}</Text></>}
                    {purchase && <Text className="text-[14px] text-surface-400"> · {title(item, snapshot)}</Text>}
                    {item.notes && !purchase && <Text numberOfLines={1} className="flex-1 text-[14px] text-surface-400"> · {item.notes}</Text>}
                  </View>
                </View>
                <Text className="ml-3 text-[16px] font-semibold" style={{ ...tabular, color: amountColor(item.kind) }}>{amountSign(item.kind)}{money(item.amountCents)}</Text>
              </Pressable>
            })}</View>
          </View>)}</View>}
        {pagination.pageCount > 1 && <View className="mt-6 flex-row items-center justify-between gap-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous transaction page" disabled={pagination.page === 0} onPress={() => changePage(pagination.page - 1)} style={{ minHeight: TOUCH }} className={`justify-center rounded-xl border border-surface-700 px-5 ${pagination.page === 0 ? 'opacity-40' : 'bg-surface-900'}`}><Text className="text-[16px] text-surface-100">Previous</Text></Pressable>
          <Text className="text-[14px] text-surface-400" style={tabular}>{pagination.page + 1} / {pagination.pageCount}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next transaction page" disabled={pagination.page + 1 >= pagination.pageCount} onPress={() => changePage(pagination.page + 1)} style={{ minHeight: TOUCH }} className={`justify-center rounded-xl border border-surface-700 px-5 ${pagination.page + 1 >= pagination.pageCount ? 'opacity-40' : 'bg-surface-900'}`}><Text className="text-[16px] text-surface-100">Next</Text></Pressable>
        </View>}
        <View style={{ height: 96 + insets.bottom }} />
      </ScrollView>

      {!editing && !selecting && <View
        style={{ bottom: Math.max(insets.bottom, 12) + 4 }}
        className="absolute left-4 right-4 flex-row items-center justify-between"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan receipt"
          disabled={state.readOnly}
          onPress={() => router.push('/transaction-image')}
          style={{ minHeight: TOUCH }}
          className="flex-row items-center rounded-2xl border border-surface-700 bg-surface-900/95 px-4"
        >
          <ScanLine color="#b5b5bc" size={16} />
          <Text className="ml-2 text-[14px] font-semibold text-surface-200">Scan receipt</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          disabled={state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0}
          onPress={() => setEditing('new')}
          style={{ minHeight: TOUCH }}
          className={`flex-row items-center rounded-2xl px-5 ${state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0 ? 'bg-surface-800' : 'bg-accent-600'}`}
        >
          <Plus color={state.readOnly ? '#707078' : '#fff'} size={19} />
          <Text className={`ml-1.5 text-[16px] font-semibold ${state.readOnly ? 'text-surface-500' : 'text-white'}`}>Add</Text>
        </Pressable>
      </View>}

      {editing && <TransactionEntry key={editing === 'new' ? 'new' : editing.id} snapshot={snapshot} transaction={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        visible={confirmingBulk}
        title={`Delete ${selected.length} ${selected.length === 1 ? 'transaction' : 'transactions'}?`}
        detail="Account balances update immediately. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={state.busy}
        onCancel={() => setConfirmingBulk(false)}
        onConfirm={() => void removeSelected()}
      />
    </View>
  }}</MoneyScreen>
}
