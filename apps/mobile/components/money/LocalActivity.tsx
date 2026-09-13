import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { ArrowRight, Check, ListFilter, Plus, ScanLine, Search, Trash2, X } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { MoneySnapshot } from '@ego/core'
import { syncLabel, useLedger } from '../../lib/ledger-context'
import type { LocalFeedTransaction } from '../../lib/repositories/transactions'
import type { OutboxEntry } from '../../lib/sync/outbox'
import {
  DEFAULT_ACTIVITY_VIEW, activityChips, activityFilters, hasFilters, parsePreferences,
  searchAllTime, storedPreferences, viewIdentity, type ActivityView
} from '../../lib/activity-view'
import { periodLabel } from '../../lib/period-context'
import { ConfirmDialog, Empty, MoneyIcon, Sheet, money } from './Common'
import FilterSheet from './FilterSheet'
import TransactionEntry from './TransactionEntry'

const PAGE_SIZE = 50
const PREFERENCES_KEY = 'ego.activity.view'

interface Section {
  date: string
  data: LocalFeedTransaction[]
}

/**
 * Query, filters, loaded pages, and the scroll offset survive a trip to a detail screen, so
 * coming back lands where the user left off.
 */
interface SessionState {
  identity: string
  rows: LocalFeedTransaction[]
  cursor: string | null
  total: number
  offset: number
}

let session: SessionState | null = null

function pendingLabel(state: LocalFeedTransaction['pending']): string | null {
  if (state === 'pending') return 'Pending'
  return state === 'none' ? null : 'Needs attention'
}

function title(row: LocalFeedTransaction): string {
  if (row.merchant) return row.merchant
  if (row.kind === 'transfer') return row.destinationAccountName ?? 'Transfer'
  return row.categoryName ?? 'Archived category'
}

function netOf(items: LocalFeedTransaction[]): number {
  return items.reduce((sum, item) =>
    sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0)
}

function TransactionRow({ item, selecting, checked, onOpen, onToggle, onSelect }: {
  item: LocalFeedTransaction
  selecting: boolean
  checked: boolean
  onOpen: () => void
  onToggle: () => void
  onSelect: () => void
}): React.ReactElement {
  const state = pendingLabel(item.pending)
  const sign = item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''
  return <Pressable
    accessibilityRole="button"
    accessibilityState={selecting ? { selected: checked } : undefined}
    accessibilityLabel={`${item.kind} ${sign}${money(item.amountCents)}, ${title(item)}, ${item.accountName}${state ? `, ${state}` : ''}`}
    onPress={selecting ? onToggle : onOpen}
    onLongPress={selecting ? onToggle : onSelect}
    delayLongPress={350}
    className={`min-h-16 flex-row items-center border-t border-surface-800 px-3 py-3 ${checked ? 'bg-accent-500/15' : 'bg-surface-900/70'}`}
  >
    {selecting && <View className={`mr-2 h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>
      {checked && <Check color="#fff" size={12} strokeWidth={3} />}
    </View>}
    <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: item.categoryColor ?? '#707078' }}>
      <MoneyIcon name={item.categoryIcon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={14} />
    </View>
    <View className="ml-2 flex-1">
      <Text className="text-[16px] font-semibold text-surface-100">{title(item)}</Text>
      <View className="flex-row flex-wrap items-center">
        <Text className="text-[14px] text-surface-400">{item.accountName}</Text>
        {item.kind === 'transfer' && <>
          <ArrowRight color="#909099" size={10} style={{ marginHorizontal: 3 }} />
          <Text className="text-[14px] text-surface-400">{item.destinationAccountName}</Text>
        </>}
        {item.categoryName && item.kind !== 'transfer' && item.merchant &&
          <Text className="ml-1.5 text-[14px] text-surface-400">{item.categoryName}</Text>}
        {state && <Text className={`ml-1.5 text-[14px] ${item.pending === 'pending' ? 'text-surface-400' : 'text-amber-300'}`}>{state}</Text>}
      </View>
    </View>
    <Text
      className={`ml-2 text-[16px] font-bold ${item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`}
      style={{ fontVariant: ['tabular-nums'] }}
    >{sign}{money(item.amountCents)}</Text>
  </Pressable>
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
  const [view, setView] = useState<ActivityView>(DEFAULT_ACTIVITY_VIEW)
  const [restored, setRestored] = useState(false)
  const [rows, setRows] = useState<LocalFeedTransaction[]>(session?.rows ?? [])
  const [total, setTotal] = useState(session?.total ?? 0)
  const [cursor, setCursor] = useState<string | null>(session?.cursor ?? null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [adding, setAdding] = useState(false)
  const listRef = useRef<SectionList<LocalFeedTransaction, Section>>(null)
  const offset = useRef(session?.offset ?? 0)
  const loadingOlder = useRef(false)

  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(PREFERENCES_KEY).catch(() => null)
      setView(parsePreferences(stored))
      setRestored(true)
    })()
  }, [])

  const identity = viewIdentity(view)

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setLoading(true)
    const page = await ledger.feed(activityFilters(view), null, PAGE_SIZE)
    setRows(page.items)
    setTotal(page.totalCount)
    setCursor(page.nextCursor)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, ledger.version, ledger.feed])

  useEffect(() => {
    if (!restored) return
    setSelecting(false)
    setSelected([])
    void loadFirstPage()
  }, [loadFirstPage, restored])

  useEffect(() => {
    if (!restored) return
    void SecureStore.setItemAsync(PREFERENCES_KEY, storedPreferences(view)).catch(() => undefined)
  }, [restored, view])

  useEffect(() => {
    session = { identity, rows, cursor, total, offset: offset.current }
  }, [cursor, identity, rows, total])

  const loadOlder = async (): Promise<void> => {
    const last = rows[rows.length - 1]
    if (!cursor || !last || loadingOlder.current) return
    loadingOlder.current = true
    const page = await ledger.feed(activityFilters(view), {
      date: last.date, createdAt: last.createdAt, id: last.id
    }, PAGE_SIZE)
    const seen = new Set(rows.map((row) => row.id))
    setRows((current) => [...current, ...page.items.filter((item) => !seen.has(item.id))])
    setCursor(page.nextCursor)
    loadingOlder.current = false
  }

  const changeView = (next: ActivityView): void => {
    setView(next)
    setSelecting(false)
    setSelected([])
    offset.current = 0
  }

  const exitSelection = (): void => {
    setSelecting(false)
    setSelected([])
  }
  const toggle = (id: string): void => setSelected((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const removeSelected = async (): Promise<void> => {
    await ledger.removeTransactions(rows.filter((row) => selected.includes(row.id)))
    setConfirmingBulk(false)
    exitSelection()
  }

  const reference = ledger.reference
  const accounts = reference?.accounts ?? []
  const categories = reference?.categories ?? []
  const editorSnapshot: MoneySnapshot = {
    accounts: accounts.map((account) => ({
      ...account,
      balanceCents: ledger.balances.find((balance) => balance.accountId === account.id)?.balanceCents
        ?? account.openingBalanceCents
    })),
    categories,
    transactions: rows,
    purchases: [],
    budgets: [],
    syncedAt: new Date().toISOString()
  }
  const chips = activityChips(view, {
    account: (id) => accounts.find((account) => account.id === id)?.name ?? 'Account',
    category: (id) => categories.find((category) => category.id === id)?.name ?? 'Category'
  })

  const sections: Section[] = []
  rows.forEach((row) => {
    const current = sections[sections.length - 1]
    if (current && current.date === row.date) current.data.push(row)
    else sections.push({ date: row.date, data: [row] })
  })
  const partial = rows.length < total
  const visibleIds = rows.map((row) => row.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const openAccounts = accounts.filter((account) => !account.archivedAt)
  const filtered = view.search.trim().length > 0 || hasFilters(view)

  if (ledger.error) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[20px] font-semibold text-surface-100">This device cannot open its ledger</Text>
      <Text className="mt-2 text-center text-[16px] leading-5 text-surface-400">{ledger.error}. Turn off local Activity storage in Settings to use the previous connection.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} className="mt-4 min-h-11 justify-center rounded-lg bg-accent-600 px-4">
        <Text className="text-[16px] font-semibold text-white">Open settings</Text>
      </Pressable>
    </View>
  }

  if (!restored || (!ledger.ready && loading && rows.length === 0)) {
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
        <TextInput
          value={view.search}
          onChangeText={(value) => setView((current) => ({ ...current, search: value }))}
          accessibilityLabel="Search activity"
          placeholder="Search activity"
          placeholderTextColor="#909099"
          returnKeyType="search"
          className="ml-2 flex-1 py-2 text-[16px] text-surface-100"
        />
        {view.search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setView((current) => ({ ...current, search: '' }))} hitSlop={8} className="h-11 w-8 items-center justify-center">
          <X color="#909099" size={15} />
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Select transactions" disabled={rows.length === 0} onPress={() => setSelecting(true)} className="min-h-11 justify-center pl-1">
          <Text className={`text-[14px] font-semibold ${rows.length === 0 ? 'text-surface-600' : 'text-accent-400'}`}>Select</Text>
        </Pressable>
      </View>}

    <View className="flex-row flex-wrap items-center gap-2 px-3 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filters. Period ${periodLabel(view.period, view.custom)}`}
        onPress={() => setFiltering(true)}
        className={`min-h-11 flex-row items-center rounded-full border px-3 ${hasFilters(view) ? 'border-accent-500/50 bg-accent-500/20' : 'border-surface-700 bg-surface-900'}`}
      >
        <ListFilter color={hasFilters(view) ? '#91c4ff' : '#b5b5bc'} size={14} />
        <Text className={`ml-1.5 text-[14px] ${hasFilters(view) ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{periodLabel(view.period, view.custom)}</Text>
      </Pressable>
      {chips.map((chip) => <Pressable
        key={chip.id}
        accessibilityRole="button"
        accessibilityLabel={`Remove filter ${chip.label}`}
        onPress={() => changeView(chip.next)}
        className="min-h-11 flex-row items-center rounded-full border border-accent-500/50 bg-accent-500/20 px-3"
      >
        <Text className="text-[14px] font-semibold text-accent-400">{chip.label}</Text>
        <X color="#91c4ff" size={13} style={{ marginLeft: 5 }} />
      </Pressable>)}
    </View>

    <SectionList
      ref={listRef}
      sections={sections}
      keyExtractor={(item) => item.id}
      initialNumToRender={20}
      windowSize={9}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      className="flex-1 px-3"
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y
      }}
      scrollEventThrottle={200}
      onEndReachedThreshold={0.6}
      onEndReached={() => void loadOlder()}
      ListHeaderComponent={rows.length > 0
        ? <Text accessibilityLiveRegion="polite" className="py-2 text-[14px] text-surface-400">
          {partial ? `1-${rows.length} of ${total} transactions` : `${total} ${total === 1 ? 'transaction' : 'transactions'}`}
        </Text>
        : null}
      ListEmptyComponent={loading
        ? null
        : <View>
          <Empty
            title={filtered ? 'No matching transactions' : 'Record your first transaction'}
            detail={filtered
              ? 'Try another search, remove a filter, or choose a wider period.'
              : 'Add income, an expense, or a transfer between two accounts.'} />
          {filtered && view.period !== 'all' && <Pressable
            accessibilityRole="button"
            onPress={() => changeView(searchAllTime(view))}
            className="mx-8 min-h-11 items-center justify-center rounded-xl border border-surface-700 bg-surface-900"
          ><Text className="text-[16px] text-surface-100">Search all time</Text></Pressable>}
        </View>}
      renderSectionHeader={({ section }) => <View className="flex-row justify-between bg-surface-950 px-0.5 pb-1 pt-3">
        <Text className="text-[14px] font-semibold uppercase tracking-wide text-surface-400">
          {new Date(`${section.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
        <Text
          accessibilityLabel={`${partial ? 'Shown net' : 'Net'} ${money(netOf(section.data), true)}`}
          className="text-[14px] font-bold text-surface-300"
          style={{ fontVariant: ['tabular-nums'] }}
        >{partial ? 'Shown ' : ''}{money(netOf(section.data), true)}</Text>
      </View>}
      renderItem={({ item, index, section }) => <View className={`border-x border-surface-800 ${index === 0 ? 'overflow-hidden rounded-t-xl' : ''} ${index === section.data.length - 1 ? 'overflow-hidden rounded-b-xl border-b' : ''}`}>
        <TransactionRow
          item={item}
          selecting={selecting}
          checked={selected.includes(item.id)}
          onOpen={() => router.push({ pathname: '/(money)/transaction', params: { id: item.id } })}
          onToggle={() => toggle(item.id)}
          onSelect={() => {
            setSelecting(true)
            setSelected([item.id])
          }}
        />
      </View>}
      ListFooterComponent={<View className="pb-28 pt-4">
        {cursor && <Pressable
          accessibilityRole="button"
          onPress={() => void loadOlder()}
          className="min-h-11 items-center justify-center rounded-xl border border-surface-700 bg-surface-900"
        ><Text className="text-[16px] text-surface-100">Load older activity</Text></Pressable>}
      </View>}
    />

    {!selecting && <View className="absolute bottom-4 left-3 right-3 flex-row items-center justify-between">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan receipt"
        onPress={() => router.push('/transaction-image')}
        className="min-h-11 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3"
      >
        <ScanLine color="#b5b5bc" size={16} />
        <Text className="ml-1.5 text-[14px] font-semibold text-surface-200">Scan receipt</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        disabled={openAccounts.length === 0}
        onPress={() => setAdding(true)}
        className={`min-h-11 flex-row items-center rounded-xl px-4 ${openAccounts.length === 0 ? 'bg-surface-800' : 'bg-accent-600'}`}
      >
        <Plus color={openAccounts.length === 0 ? '#707078' : '#fff'} size={18} />
        <Text className={`ml-1 text-[16px] font-semibold ${openAccounts.length === 0 ? 'text-surface-500' : 'text-white'}`}>Add</Text>
      </Pressable>
    </View>}

    <Sheet visible={adding} title="Add" onClose={() => setAdding(false)}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setAdding(false)
          setCreating(true)
        }}
        className="min-h-16 justify-center rounded-xl border border-surface-700 bg-surface-900 px-3 py-3"
      >
        <Text className="text-[16px] font-semibold text-surface-100">Transaction</Text>
        <Text className="mt-0.5 text-[14px] text-surface-400">The amount keypad, with account, category, date, and notes.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setAdding(false)
          router.push('/transaction-image')
        }}
        className="mt-2 min-h-16 justify-center rounded-xl border border-surface-700 bg-surface-900 px-3 py-3"
      >
        <Text className="text-[16px] font-semibold text-surface-100">Money agent</Text>
        <Text className="mt-0.5 text-[14px] text-surface-400">Read a receipt image or a message into one or more transactions.</Text>
      </Pressable>
    </Sheet>

    {creating && <TransactionEntry
      key="new"
      snapshot={editorSnapshot}
      onSave={(input) => ledger.saveTransaction(input)}
      onClose={() => setCreating(false)}
    />}

    <FilterSheet
      visible={filtering}
      view={view}
      accounts={accounts}
      categories={categories}
      onApply={(next) => {
        changeView(next)
        setFiltering(false)
      }}
      onClose={() => setFiltering(false)}
    />

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
