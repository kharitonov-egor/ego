import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowRight, Check, Plus, ScanLine, Search, Trash2, X } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot, MoneyTransaction } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { usePeriod } from '../../lib/period-context'
import { ConfirmDialog, Empty, MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money } from '../../components/money/Common'
import TransactionEntry from '../../components/money/TransactionEntry'

function title(transaction: MoneyTransaction, snapshot: MoneySnapshot): string {
  if (transaction.kind === 'transfer') return snapshot.accounts.find((item) => item.id === transaction.destinationAccountId)?.name ?? 'Transfer'
  return snapshot.categories.find((item) => item.id === transaction.categoryId)?.name ?? 'Archived category'
}

export default function Transactions(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const { range } = usePeriod()
  const params = useLocalSearchParams<{ new?: string }>()
  const [search, setSearch] = useState('')
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
      return !query || item.notes.toLowerCase().includes(query) || title(item, snapshot).toLowerCase().includes(query) || account.toLowerCase().includes(query)
    })
    const groups = new Map<string, MoneyTransaction[]>()
    transactions.forEach((item) => groups.set(item.date, [...(groups.get(item.date) ?? []), item]))
    const allSelected = transactions.length > 0 && selected.length === transactions.length

    return <View className="flex-1">
      {selecting
        ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-3 py-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={10} className="p-1"><X color="#b5b5bc" size={18} /></Pressable>
          <Text className="text-[13px] font-semibold text-surface-100">{selected.length} selected</Text>
          <Pressable accessibilityRole="button" onPress={() => setSelected(allSelected ? [] : transactions.map((item) => item.id))} className="ml-auto rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5"><Text className="text-[12px] font-semibold text-surface-300">{allSelected ? 'Clear all' : 'Select all'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete selected" disabled={selected.length === 0 || state.readOnly} onPress={() => setConfirmingBulk(true)} className={`rounded-full px-3 py-1.5 ${selected.length === 0 || state.readOnly ? 'bg-surface-800' : 'bg-rose-600'}`}><Trash2 color={selected.length === 0 || state.readOnly ? '#707078' : '#fff'} size={16} /></Pressable>
        </View>
        : <View className="mx-3 mt-2 flex-row items-center rounded-lg border border-surface-700 bg-surface-900 px-3">
          <Search color="#b5b5bc" size={15} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search activity" placeholderTextColor="#707078" className="ml-2 flex-1 py-2 text-[13px] text-surface-100" />
        </View>}

      <PeriodChips />

      <ScrollView className="flex-1 px-3">
        {transactions.length === 0
          ? <Empty title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail="Add income, an expense, or a transfer between two accounts." />
          : <View className="gap-3">{Array.from(groups.entries()).map(([date, items]) => <View key={date}>
            <View className="mb-1 flex-row justify-between px-0.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
              <Text className="text-[11px] font-bold text-surface-300" style={{ fontVariant: ['tabular-nums'] }}>{money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}</Text>
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
                className={`flex-row items-center px-2.5 py-2 ${index > 0 ? 'border-t border-surface-800' : ''} ${checked ? 'bg-accent-500/15' : ''}`}
              >
                {selecting && <View className={`mr-2 h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>{checked && <Check color="#fff" size={11} strokeWidth={3} />}</View>}
                <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#707078' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={14} /></View>
                <View className="ml-2 flex-1">
                  <Text numberOfLines={1} className="text-[13px] font-semibold text-surface-100">{purchase?.merchant ?? title(item, snapshot)}</Text>
                  <View className="flex-row items-center">
                    <Text numberOfLines={1} className="text-[11px] text-surface-400">{account?.name ?? 'Archived account'}</Text>
                    {item.kind === 'transfer' && <><ArrowRight color="#909099" size={10} style={{ marginHorizontal: 3 }} /><Text numberOfLines={1} className="text-[11px] text-surface-400">{title(item, snapshot)}</Text></>}
                    {item.notes && !purchase && <Text numberOfLines={1} className="ml-1 flex-1 text-[11px] italic text-surface-500">· {item.notes}</Text>}
                  </View>
                </View>
                <Text className={`ml-2 text-[13px] font-bold ${item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}</Text>
              </Pressable>
            })}</View>
          </View>)}</View>}
        <View className="h-20" />
      </ScrollView>

      {!editing && !selecting && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Open money agent" disabled={state.readOnly} onPress={() => router.push('/transaction-image')} className="absolute bottom-4 right-[68px] h-11 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3"><ScanLine color="#b5b5bc" size={16} /><Text className="ml-1.5 text-[12px] font-semibold text-surface-200">Money agent</Text></Pressable>
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
