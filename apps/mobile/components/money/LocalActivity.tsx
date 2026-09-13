import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowRight, Check, Plus, Search, Trash2, X } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { NO_TRANSACTION_FILTERS, type TransactionFilters } from '@ego/api-contracts'
import type { MoneySnapshot } from '@ego/core'
import { syncLabel, useLedger } from '../../lib/ledger-context'
import type { LocalFeedTransaction } from '../../lib/repositories/transactions'
import type { OutboxEntry } from '../../lib/sync/outbox'
import { usePeriod } from '../../lib/period-context'
import { ConfirmDialog, Empty, MoneyIcon, PeriodChips, Sheet, money } from './Common'
import TransactionEntry from './TransactionEntry'

const PAGE_SIZE = 50

function pendingLabel(state: LocalFeedTransaction['pending']): string | null {
  if (state === 'pending') return 'Pending'
  if (state === 'conflict') return 'Needs attention'
  if (state === 'failed') return 'Needs attention'
  return null
}

function title(row: LocalFeedTransaction): string {
  if (row.merchant) return row.merchant
  if (row.kind === 'transfer') return row.destinationAccountName ?? 'Transfer'
  return row.categoryName ?? 'Archived category'
}

function ConflictReview({ entries, onKeepMine, onUseSaved, onClose }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => void
  onUseSaved: (entry: OutboxEntry) => void
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible title="Needs attention" onClose={onClose}>
    {entries.map((entry) => <View key={entry.operationId} className="mb-4 rounded-xl border border-surface-700 bg-surface-900 p-3">
      <Text className="text-[16px] font-semibold text-surface-100">{entry.lastError ?? 'This record changed on another device'}</Text>
      <Text className="mt-1 text-[14px] text-surface-400">{entry.entity} · {entry.commandType}</Text>
      {entry.status === 'conflict'
        ? <View className="mt-3 flex-row gap-2">
          <Pressable accessibilityRole="button" onPress={() => onKeepMine(entry)} className="min-h-11 flex-1 items-center justify-center rounded-lg bg-accent-600 px-3">
            <Text className="text-[16px] font-semibold text-white">Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} className="min-h-11 flex-1 items-center justify-center rounded-lg border border-surface-600 px-3">
            <Text className="text-[16px] font-semibold text-surface-200">Use saved version</Text>
          </Pressable>
        </View>
        : <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} className="mt-3 min-h-11 items-center justify-center rounded-lg border border-surface-600 px-3">
          <Text className="text-[16px] font-semibold text-surface-200">Discard this change</Text>
        </Pressable>}
    </View>)}
  </Sheet>
}

export default function LocalActivity(): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const { range } = usePeriod()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<LocalFeedTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<LocalFeedTransaction | 'new' | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const filters: TransactionFilters = {
    ...NO_TRANSACTION_FILTERS,
    from: range.from,
    to: range.to,
    search: search.trim()
  }
  const filterKey = `${range.from ?? ''}|${range.to ?? ''}|${search.trim()}`

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setLoading(true)
    const page = await ledger.feed(filters, null, PAGE_SIZE)
    setRows(page.items)
    setTotal(page.totalCount)
    setCursor(page.nextCursor)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, ledger.version, ledger.feed])

  useEffect(() => {
    setSelecting(false)
    setSelected([])
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    void loadFirstPage()
  }, [loadFirstPage])

  const loadOlder = async (): Promise<void> => {
    if (!cursor) return
    const decoded = rows[rows.length - 1]
    if (!decoded) return
    const page = await ledger.feed(filters, {
      date: decoded.date, createdAt: decoded.createdAt, id: decoded.id
    }, PAGE_SIZE)
    const seen = new Set(rows.map((row) => row.id))
    setRows([...rows, ...page.items.filter((item) => !seen.has(item.id))])
    setCursor(page.nextCursor)
  }

  const exitSelection = (): void => {
    setSelecting(false)
    setSelected([])
  }
  const toggle = (id: string): void => setSelected((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const removeSelected = async (): Promise<void> => {
    const chosen = rows.filter((row) => selected.includes(row.id))
    await ledger.removeTransactions(chosen)
    setConfirmingBulk(false)
    exitSelection()
  }

  const reference = ledger.reference
  const editorSnapshot: MoneySnapshot = {
    accounts: (reference?.accounts ?? []).map((account) => ({
      ...account,
      balanceCents: ledger.balances.find((balance) => balance.accountId === account.id)?.balanceCents
        ?? account.openingBalanceCents
    })),
    categories: reference?.categories ?? [],
    transactions: rows,
    purchases: [],
    budgets: [],
    syncedAt: new Date().toISOString()
  }

  const groups = new Map<string, LocalFeedTransaction[]>()
  rows.forEach((row) => groups.set(row.date, [...(groups.get(row.date) ?? []), row]))
  const visibleIds = rows.map((row) => row.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const openAccounts = editorSnapshot.accounts.filter((account) => !account.archivedAt)

  if (!ledger.ready && loading) {
    return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#91c4ff" /></View>
  }

  return <View className="flex-1 bg-surface-950">
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${syncLabel(ledger.status)}`}
      onPress={() => ledger.conflicts.length > 0 ? setReviewing(true) : void ledger.sync()}
      className={`min-h-11 flex-row items-center justify-between px-4 py-2 ${ledger.conflicts.length > 0 ? 'bg-amber-500/15' : 'bg-surface-900'}`}
    >
      <Text className={`text-[14px] ${ledger.conflicts.length > 0 ? 'text-amber-300' : 'text-surface-400'}`}>{syncLabel(ledger.status)}</Text>
      <Text className="text-[14px] text-surface-500">{ledger.conflicts.length > 0 ? 'Review' : 'Sync now'}</Text>
    </Pressable>

    {selecting
      ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-3 py-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={10} className="h-11 w-11 items-center justify-center"><X color="#b5b5bc" size={18} /></Pressable>
        <Text className="text-[16px] font-semibold text-surface-100">{selected.length} selected</Text>
        <Pressable accessibilityRole="button" onPress={() => setSelected(allSelected ? [] : visibleIds)} className="ml-auto min-h-11 justify-center rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5">
          <Text className="text-[14px] font-semibold text-surface-300">{allSelected ? 'Clear loaded' : 'Select loaded'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete selected" disabled={selected.length === 0} onPress={() => setConfirmingBulk(true)} className={`min-h-11 min-w-11 items-center justify-center rounded-full px-3 py-1.5 ${selected.length === 0 ? 'bg-surface-800' : 'bg-rose-600'}`}>
          <Trash2 color={selected.length === 0 ? '#707078' : '#fff'} size={16} />
        </Pressable>
      </View>
      : <View className="mx-3 mt-2 flex-row items-center rounded-lg border border-surface-700 bg-surface-900 px-3">
        <Search color="#b5b5bc" size={15} />
        <TextInput value={search} onChangeText={setSearch} accessibilityLabel="Search transactions" placeholder="Search activity" placeholderTextColor="#909099" className="ml-2 flex-1 py-2 text-[16px] text-surface-100" />
        <Pressable accessibilityRole="button" accessibilityLabel="Select transactions" onPress={() => setSelecting(true)} className="min-h-11 justify-center pl-2">
          <Text className="text-[14px] font-semibold text-accent-400">Select</Text>
        </Pressable>
      </View>}

    <PeriodChips />

    <ScrollView ref={scrollRef} className="flex-1 px-3" keyboardShouldPersistTaps="handled">
      {rows.length > 0 && <Text accessibilityLiveRegion="polite" className="mb-3 text-[14px] text-surface-400">
        {rows.length === total ? `${total} ${total === 1 ? 'transaction' : 'transactions'}` : `1-${rows.length} of ${total} transactions`}
      </Text>}
      {rows.length === 0
        ? <Empty
          title={search.trim() ? 'No matching transactions' : 'Record your first transaction'}
          detail={search.trim() ? 'Try another search or choose a wider period.' : 'Add income, an expense, or a transfer between two accounts.'} />
        : <View className="gap-3">{Array.from(groups.entries()).map(([date, items]) => <View key={date}>
          <View className="mb-1 flex-row justify-between px-0.5">
            <Text className="text-[14px] font-semibold uppercase tracking-wide text-surface-400">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            <Text className="text-[14px] font-bold text-surface-300" style={{ fontVariant: ['tabular-nums'] }}>
              {rows.length < total ? 'Shown ' : ''}
              {money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}
            </Text>
          </View>
          <View className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900/70">{items.map((item, index) => {
            const checked = selected.includes(item.id)
            const state = pendingLabel(item.pending)
            const open = (): void => {
              if (selecting) {
                toggle(item.id)
                return
              }
              if (item.purchaseId) {
                router.push({ pathname: '/(money)/purchases', params: { purchaseId: item.purchaseId } })
                return
              }
              setEditing(item)
            }
            return <Pressable
              accessibilityRole="button"
              accessibilityState={selecting ? { selected: checked } : undefined}
              accessibilityLabel={`${item.kind} ${money(item.amountCents)} ${title(item)}${state ? `, ${state}` : ''}`}
              key={item.id}
              onPress={open}
              onLongPress={() => selecting ? toggle(item.id) : (setSelecting(true), setSelected([item.id]))}
              delayLongPress={350}
              className={`min-h-16 flex-row items-center px-3 py-3 ${index > 0 ? 'border-t border-surface-800' : ''} ${checked ? 'bg-accent-500/15' : ''}`}
            >
              {selecting && <View className={`mr-2 h-4 w-4 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>{checked && <Check color="#fff" size={11} strokeWidth={3} />}</View>}
              <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: item.categoryColor ?? '#707078' }}>
                <MoneyIcon name={item.categoryIcon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={14} />
              </View>
              <View className="ml-2 flex-1">
                <Text numberOfLines={1} className="text-[16px] font-semibold text-surface-100">{title(item)}</Text>
                <View className="flex-row items-center">
                  <Text numberOfLines={1} className="text-[14px] text-surface-400">{item.accountName}</Text>
                  {item.kind === 'transfer' && <><ArrowRight color="#909099" size={10} style={{ marginHorizontal: 3 }} /><Text numberOfLines={1} className="text-[14px] text-surface-400">{item.destinationAccountName}</Text></>}
                  {state && <Text className={`ml-1.5 text-[14px] ${item.pending === 'pending' ? 'text-surface-400' : 'text-amber-300'}`}>{state}</Text>}
                </View>
              </View>
              <Text className={`ml-2 text-[16px] font-bold ${item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`} style={{ fontVariant: ['tabular-nums'] }}>
                {item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}
              </Text>
            </Pressable>
          })}</View>
        </View>)}</View>}

      {cursor && <Pressable accessibilityRole="button" onPress={() => void loadOlder()} className="mt-4 min-h-11 items-center justify-center rounded-xl border border-surface-700 bg-surface-900">
        <Text className="text-[16px] text-surface-100">Load older activity</Text>
      </Pressable>}
      <View className="h-24" />
    </ScrollView>

    {!editing && !selecting && <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add transaction"
      disabled={openAccounts.length === 0}
      onPress={() => setEditing('new')}
      className="absolute bottom-4 right-3 h-11 w-11 items-center justify-center rounded-xl bg-accent-600"
    ><Plus color="#fff" size={21} /></Pressable>}

    {editing && <TransactionEntry
      key={editing === 'new' ? 'new' : editing.id}
      snapshot={editorSnapshot}
      transaction={editing === 'new' ? undefined : editing}
      onSave={async (input) => {
        const saved = await ledger.saveTransaction(input, editing === 'new' ? undefined : editing)
        return saved
      }}
      onDelete={editing === 'new' ? undefined : () => ledger.removeTransaction(editing)}
      onClose={() => setEditing(null)}
    />}

    {reviewing && <ConflictReview
      entries={ledger.conflicts}
      onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
      onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      onClose={() => setReviewing(false)}
    />}

    <ConfirmDialog
      visible={confirmingBulk}
      title={`Delete ${selected.length} ${selected.length === 1 ? 'transaction' : 'transactions'}?`}
      detail="The rows leave this device now and the deletion syncs when the server is reachable."
      confirmLabel="Delete"
      destructive
      onCancel={() => setConfirmingBulk(false)}
      onConfirm={() => void removeSelected()}
    />
  </View>
}
