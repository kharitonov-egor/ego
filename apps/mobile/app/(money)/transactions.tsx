import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
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
        ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-3 py-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={10} className="h-11 w-11 items-center justify-center"><X color="#b5b5bc" size={18} /></Pressable>
          <Text className="text-[16px] font-semibold text-surface-100">{selected.length} selected</Text>
          <Pressable accessibilityRole="button" onPress={() => setSelected(allSelected ? [] : visibleIds)} className="ml-auto min-h-11 justify-center rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5"><Text className="text-[14px] font-semibold text-surface-300">{allSelected ? 'Clear page' : 'Select page'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete selected" disabled={selected.length === 0 || state.readOnly} onPress={() => setConfirmingBulk(true)} className={`min-h-11 min-w-11 items-center justify-center rounded-full px-3 py-1.5 ${selected.length === 0 || state.readOnly ? 'bg-surface-800' : 'bg-rose-600'}`}><Trash2 color={selected.length === 0 || state.readOnly ? '#707078' : '#fff'} size={16} /></Pressable>
        </View>
        : <View className="mx-3 mt-2 flex-row items-center rounded-lg border border-surface-700 bg-surface-900 px-3">
          <Search color="#b5b5bc" size={15} />
          <TextInput value={search} onChangeText={setSearch} accessibilityLabel="Search transactions" placeholder="Search activity" placeholderTextColor="#909099" className="ml-2 flex-1 py-2 text-[16px] text-surface-100" />
        </View>}

      <PeriodChips />

      <ScrollView ref={scrollRef} className="flex-1 px-3" keyboardShouldPersistTaps="handled">
        {transactions.length > 0 && <Text accessibilityLiveRegion="polite" className="mb-3 text-[14px] text-surface-400">{pagination.start + 1}-{pagination.end} of {transactions.length} transactions</Text>}
        {transactions.length === 0
          ? <Empty title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail={snapshot.transactions.length ? 'Try another search or choose a wider period.' : 'Add income, an expense, or a transfer between two accounts.'} />
          : <View className="gap-3">{Array.from(groups.entries()).map(([date, items]) => <View key={date}>
            <View className="mb-1 flex-row justify-between px-0.5">
              <Text className="text-[14px] font-semibold uppercase tracking-wide text-surface-400">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
              <Text className="text-[14px] font-bold text-surface-300" style={{ fontVariant: ['tabular-nums'] }}>{pagination.items.length < transactions.length ? 'Shown ' : ''}{money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}</Text>
            </View>
            <View className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900/70">{items.map((item, index) => {
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
                className={`min-h-16 flex-row items-center px-3 py-3 ${index > 0 ? 'border-t border-surface-800' : ''} ${checked ? 'bg-accent-500/15' : ''}`}
              >
                {selecting && <View className={`mr-2 h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>{checked && <Check color="#fff" size={11} strokeWidth={3} />}</View>}
                <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#707078' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={14} /></View>
                <View className="ml-2 flex-1">
                  <Text numberOfLines={1} className="text-[16px] font-semibold text-surface-100">{purchase?.merchant ?? title(item, snapshot)}</Text>
                  <View className="flex-row items-center">
                    <Text numberOfLines={1} className="text-[14px] text-surface-400">{account?.name ?? 'Archived account'}</Text>
                    {item.kind === 'transfer' && <><ArrowRight color="#909099" size={10} style={{ marginHorizontal: 3 }} /><Text numberOfLines={1} className="text-[14px] text-surface-400">{title(item, snapshot)}</Text></>}
                    {item.notes && !purchase && <Text numberOfLines={1} className="ml-1 flex-1 text-[14px] italic text-surface-400">· {item.notes}</Text>}
                  </View>
                </View>
                <Text className={`ml-2 text-[16px] font-bold ${item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}</Text>
              </Pressable>
            })}</View>
          </View>)}</View>}
        {pagination.pageCount > 1 && <View className="mt-4 flex-row items-center justify-between gap-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous transaction page" disabled={pagination.page === 0} onPress={() => changePage(pagination.page - 1)} className={`min-h-11 justify-center rounded-xl border border-surface-700 px-4 ${pagination.page === 0 ? 'opacity-40' : 'bg-surface-900'}`}><Text className="text-[16px] text-surface-100">Previous</Text></Pressable>
          <Text className="text-[14px] text-surface-400">{pagination.page + 1} / {pagination.pageCount}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next transaction page" disabled={pagination.page + 1 >= pagination.pageCount} onPress={() => changePage(pagination.page + 1)} className={`min-h-11 justify-center rounded-xl border border-surface-700 px-4 ${pagination.page + 1 >= pagination.pageCount ? 'opacity-40' : 'bg-surface-900'}`}><Text className="text-[16px] text-surface-100">Next</Text></Pressable>
        </View>}
        <View className="h-24" />
      </ScrollView>

      {!editing && !selecting && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Open money agent" disabled={state.readOnly} onPress={() => router.push('/transaction-image')} className="absolute bottom-4 right-[68px] h-11 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3"><ScanLine color="#b5b5bc" size={16} /><Text className="ml-1.5 text-[14px] font-semibold text-surface-200">Money agent</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Add transaction" disabled={state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0} onPress={() => setEditing('new')} className="absolute bottom-4 right-3 h-11 w-11 items-center justify-center rounded-xl bg-accent-600"><Plus color="#fff" size={21} /></Pressable>
      </>}

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
