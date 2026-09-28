import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import { ArrowRight, Check, ListFilter, Plus, ScanLine, Search, Trash2, X } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
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
import { ROW_MIN_HEIGHT, TOUCH, amountColor, amountSign, tabular } from './tokens'

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

const SEARCH_DELAY_MS = 250

const TransactionRow = memo(function TransactionRow({ item, selecting, checked, onOpen, onToggle, onSelect }: {
  item: LocalFeedTransaction
  selecting: boolean
  checked: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}): React.ReactElement {
  const state = pendingLabel(item.pending)
  const sign = amountSign(item.kind)
  const second = item.kind === 'transfer'
    ? item.destinationAccountName
    : item.merchant ? item.categoryName : null
  return <Pressable
    accessibilityRole="button"
    accessibilityState={selecting ? { selected: checked } : undefined}
    accessibilityLabel={`${item.kind} ${sign}${money(item.amountCents)}, ${title(item)}, ${item.accountName}${state ? `, ${state}` : ''}`}
    accessibilityHint={selecting ? undefined : 'Opens this transaction'}
    onPress={() => selecting ? onToggle(item.id) : onOpen(item.id)}
    onLongPress={() => selecting ? onToggle(item.id) : onSelect(item.id)}
    delayLongPress={350}
    android_ripple={{ color: 'rgba(145, 196, 255, 0.12)' }}
    style={{ minHeight: ROW_MIN_HEIGHT }}
    className={`flex-row items-center border-t border-surface-800 px-4 py-3 ${checked ? 'bg-accent-500/15' : 'bg-surface-900/70'}`}
  >
    {selecting && <View className={`mr-3 h-6 w-6 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-accent-600' : 'border-surface-600'}`}>
      {checked && <Check color="#fff" size={13} strokeWidth={3} />}
    </View>}
    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: item.categoryColor ?? '#38383d' }}>
      <MoneyIcon name={item.categoryIcon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={15} />
    </View>
    <View className="ml-3 flex-1">
      <Text numberOfLines={2} className="text-[16px] font-semibold text-surface-100">{title(item)}</Text>
      <View className="mt-0.5 flex-row flex-wrap items-center">
        <Text className="text-[14px] text-surface-400">{item.accountName}</Text>
        {item.kind === 'transfer' && second && <>
          <ArrowRight color="#8a8a92" size={11} style={{ marginHorizontal: 4 }} />
          <Text className="text-[14px] text-surface-400">{second}</Text>
        </>}
        {item.kind !== 'transfer' && second && <Text className="text-[14px] text-surface-400"> · {second}</Text>}
        {state && <View className={`ml-2 rounded-full px-2 py-0.5 ${item.pending === 'pending' ? 'bg-surface-800' : 'bg-attention/20'}`}>
          <Text className={`text-[14px] ${item.pending === 'pending' ? 'text-surface-300' : 'text-attention'}`}>{state}</Text>
        </View>}
      </View>
    </View>
    <Text className="ml-3 text-[16px] font-semibold" style={{ ...tabular, color: amountColor(item.kind) }}>
      {sign}{money(item.amountCents)}
    </Text>
  </Pressable>
})

function ConflictReview({ entries, onKeepMine, onUseSaved, onClose }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => void
  onUseSaved: (entry: OutboxEntry) => void
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible title="Needs attention" onClose={onClose}>
    {entries.map((entry) => <View key={entry.operationId} className="mb-4 rounded-2xl border border-surface-700 bg-surface-900 p-4">
      <Text className="text-[16px] font-semibold text-surface-100">{entry.lastError ?? 'This record changed on another device'}</Text>
      <Text className="mt-1 text-[14px] text-surface-400">{entry.entity} · {entry.commandType}</Text>
      {entry.status === 'conflict'
        ? <View className="mt-4 flex-row gap-2">
          <Pressable accessibilityRole="button" onPress={() => onKeepMine(entry)} style={{ minHeight: TOUCH }} className="flex-1 items-center justify-center rounded-xl bg-accent-600 px-3">
            <Text className="text-[16px] font-semibold text-white">Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} style={{ minHeight: TOUCH }} className="flex-1 items-center justify-center rounded-xl border border-surface-600 px-3">
            <Text className="text-[16px] font-semibold text-surface-200">Use saved version</Text>
          </Pressable>
        </View>
        : <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} style={{ minHeight: TOUCH }} className="mt-4 items-center justify-center rounded-xl border border-surface-600 px-3">
          <Text className="text-[16px] font-semibold text-surface-200">Discard this change</Text>
        </Pressable>}
    </View>)}
  </Sheet>
}

export default function LocalActivity(): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ categoryId?: string; new?: string }>()
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
  const query = useRef(0)
  const [search, setSearch] = useState(DEFAULT_ACTIVITY_VIEW.search)

  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(PREFERENCES_KEY).catch(() => null)
      const preferences = parsePreferences(stored)
      setView(preferences)
      setSearch(preferences.search)
      setRestored(true)
    })()
  }, [])

  useEffect(() => {
    if (!params.categoryId) return
    const categoryId = params.categoryId
    setView((current) => current.categoryIds.includes(categoryId)
      ? current
      : { ...current, categoryIds: [...current.categoryIds, categoryId] })
    router.setParams({ categoryId: undefined })
  }, [params.categoryId, router])

  useEffect(() => {
    if (params.new !== 'true') return
    setCreating(true)
    router.setParams({ new: undefined })
  }, [params.new, router])

  useEffect(() => {
    if (search === view.search) return
    const timer = setTimeout(() => setView((current) => ({ ...current, search })), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, view.search])

  const identity = viewIdentity(view)

  const { feed, version } = ledger
  const loadFirstPage = useCallback(async (): Promise<void> => {
    query.current += 1
    const started = query.current
    setLoading(true)
    try {
      const page = await feed(activityFilters(view), null, PAGE_SIZE)
      if (started !== query.current) return
      setRows(page.items)
      setTotal(page.totalCount)
      setCursor(page.nextCursor)
    } catch {
      if (started === query.current) setCursor(null)
    } finally {
      if (started === query.current) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, version, feed])

  useEffect(() => {
    if (!restored) return
    setSelecting(false)
    setSelected([])
    void loadFirstPage()
  }, [loadFirstPage, restored])

  const preferences = storedPreferences(view)
  useEffect(() => {
    if (!restored) return
    void SecureStore.setItemAsync(PREFERENCES_KEY, preferences).catch(() => undefined)
  }, [restored, preferences])

  useEffect(() => {
    session = { identity, rows, cursor, total, offset: offset.current }
  }, [cursor, identity, rows, total])

  const loadOlder = async (): Promise<void> => {
    const last = rows[rows.length - 1]
    if (!cursor || !last || loadingOlder.current) return
    loadingOlder.current = true
    const started = query.current
    try {
      const page = await feed(activityFilters(view), {
        date: last.date, createdAt: last.createdAt, id: last.id
      }, PAGE_SIZE)
      if (started !== query.current) return
      const seen = new Set(rows.map((row) => row.id))
      setRows((current) => [...current, ...page.items.filter((item) => !seen.has(item.id))])
      setCursor(page.nextCursor)
    } catch {
      setCursor(null)
    } finally {
      loadingOlder.current = false
    }
  }

  const changeView = (next: ActivityView): void => {
    setView(next)
    setSearch(next.search)
    setSelecting(false)
    setSelected([])
    offset.current = 0
  }

  const exitSelection = (): void => {
    setSelecting(false)
    setSelected([])
  }
  const toggle = useCallback((id: string): void => setSelected((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]), [])
  const open = useCallback((id: string): void => {
    router.push({ pathname: '/(money)/transaction', params: { id } })
  }, [router])
  const startSelection = useCallback((id: string): void => {
    setSelecting(true)
    setSelected([id])
  }, [])
  const selectedIds = useMemo(() => new Set(selected), [selected])

  const removeSelected = async (): Promise<void> => {
    await ledger.removeTransactions(rows.filter((row) => selectedIds.has(row.id)))
    setConfirmingBulk(false)
    exitSelection()
  }

  const { reference, balances } = ledger
  const accounts = useMemo(() => reference?.accounts ?? [], [reference])
  const categories = useMemo(() => reference?.categories ?? [], [reference])
  const editorSnapshot = useMemo((): MoneySnapshot => {
    const balanceById = new Map(balances.map((balance) => [balance.accountId, balance.balanceCents]))
    return {
      accounts: accounts.map((account) => ({
        ...account,
        balanceCents: balanceById.get(account.id) ?? account.openingBalanceCents
      })),
      categories,
      transactions: rows,
      purchases: [],
      budgets: [],
      syncedAt: ''
    }
  }, [accounts, balances, categories, rows])
  const chips = activityChips(view, {
    account: (id) => accounts.find((account) => account.id === id)?.name ?? 'Account',
    category: (id) => categories.find((category) => category.id === id)?.name ?? 'Category'
  })

  const sections = useMemo(() => {
    const grouped: Section[] = []
    rows.forEach((row) => {
      const current = grouped[grouped.length - 1]
      if (current && current.date === row.date) current.data.push(row)
      else grouped.push({ date: row.date, data: [row] })
    })
    return grouped
  }, [rows])
  const partial = rows.length < total
  const visibleIds = rows.map((row) => row.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const paused = ledger.status?.state === 'paused'
  const openAccounts = accounts.filter((account) => !account.archivedAt)
  const filtered = view.search.trim().length > 0 || hasFilters(view)
  const attention = ledger.conflicts.length > 0

  if (ledger.error) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[20px] font-semibold text-surface-100">This device cannot open its ledger</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{ledger.error}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={{ minHeight: TOUCH }} className="mt-5 justify-center rounded-xl bg-accent-600 px-5">
        <Text className="text-[16px] font-semibold text-white">Open settings</Text>
      </Pressable>
    </View>
  }

  if (!restored || (!ledger.ready && rows.length === 0)) {
    const stopped = Boolean(ledger.status) && !ledger.syncing
    const offline = ledger.status?.state === 'offline'
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      {stopped
        ? <>
          <Text className="text-center text-[20px] font-semibold text-surface-100">{offline ? 'Waiting for a connection' : 'The download did not finish'}</Text>
          <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{offline
            ? 'The first download needs the internet. After that, Activity works offline.'
            : ledger.status?.message ?? 'Try again in a moment.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => void ledger.sync()} style={{ minHeight: TOUCH }} className="mt-5 justify-center rounded-xl bg-accent-600 px-5">
            <Text className="text-[16px] font-semibold text-white">Try again</Text>
          </Pressable>
        </>
        : <>
          <ActivityIndicator color="#91c4ff" />
          {restored && <Text className="mt-3 text-[14px] text-surface-400">Downloading your ledger</Text>}
        </>}
    </View>
  }

  return <View className="flex-1 bg-surface-950">
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${syncLabel(ledger.status)}`}
      accessibilityHint={attention ? 'Opens the changes that need a decision' : paused ? 'Opens Settings to sign in' : 'Syncs with the server'}
      onPress={() => attention ? setReviewing(true) : paused ? router.push('/settings') : void ledger.sync()}
      style={{ minHeight: 44 }}
      className={`flex-row items-center justify-between px-4 ${attention ? 'bg-attention/15' : 'bg-surface-900'}`}
    >
      <View className="flex-row items-center">
        <View className={`mr-2 h-1.5 w-1.5 rounded-full ${attention ? 'bg-attention' : ledger.status?.state === 'synced' ? 'bg-positive' : 'bg-surface-500'}`} />
        <Text className={`text-[14px] ${attention ? 'text-attention' : 'text-surface-400'}`}>{syncLabel(ledger.status)}</Text>
      </View>
      <Text className="text-[14px] text-surface-500">{attention ? 'Review' : paused ? 'Sign in' : ledger.syncing ? 'Syncing...' : 'Sync now'}</Text>
    </Pressable>

    {selecting
      ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-2 py-1.5">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={8} className="h-12 w-12 items-center justify-center">
          <X color="#b5b5bc" size={19} />
        </Pressable>
        <Text className="text-[16px] font-semibold text-surface-100">{selected.length} selected</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSelected(allSelected ? [] : visibleIds)}
          style={{ minHeight: TOUCH }}
          className="ml-auto justify-center rounded-full border border-surface-700 bg-surface-900 px-3"
        ><Text className="text-[14px] font-semibold text-surface-300">{allSelected ? 'Clear loaded' : 'Select loaded'}</Text></Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${selected.length} selected`}
          disabled={selected.length === 0}
          onPress={() => setConfirmingBulk(true)}
          style={{ minHeight: TOUCH, minWidth: TOUCH }}
          className={`items-center justify-center rounded-full ${selected.length === 0 ? 'bg-surface-800' : 'bg-destructive'}`}
        ><Trash2 color={selected.length === 0 ? '#707078' : '#1c1d1f'} size={17} /></Pressable>
      </View>
      : <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3">
        <Search color="#8a8a92" size={16} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search activity"
          placeholder="Search activity"
          placeholderTextColor="#8a8a92"
          returnKeyType="search"
          className="ml-2 flex-1 py-2.5 text-[16px] text-surface-100"
        />
        {search.length > 0 && <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => {
            setSearch('')
            setView((current) => ({ ...current, search: '' }))
          }}
          hitSlop={8}
          className="h-12 w-10 items-center justify-center"
        ><X color="#8a8a92" size={16} /></Pressable>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select transactions"
          disabled={rows.length === 0}
          onPress={() => setSelecting(true)}
          style={{ minHeight: TOUCH }}
          className="justify-center pl-2"
        ><Text className={`text-[14px] font-semibold ${rows.length === 0 ? 'text-surface-600' : 'text-accent-400'}`}>Select</Text></Pressable>
      </View>}

    <View className="flex-row flex-wrap items-center gap-2 px-4 py-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filters. Period ${periodLabel(view.period, view.custom)}`}
        onPress={() => setFiltering(true)}
        style={{ minHeight: 44 }}
        className={`flex-row items-center rounded-full border px-3.5 ${hasFilters(view) ? 'border-accent-500/50 bg-accent-500/20' : 'border-surface-700 bg-surface-900'}`}
      >
        <ListFilter color={hasFilters(view) ? '#91c4ff' : '#b5b5bc'} size={14} />
        <Text className={`ml-2 text-[14px] ${hasFilters(view) ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{periodLabel(view.period, view.custom)}</Text>
      </Pressable>
      {chips.map((chip) => <Pressable
        key={chip.id}
        accessibilityRole="button"
        accessibilityLabel={`Remove filter ${chip.label}`}
        onPress={() => changeView(chip.next)}
        style={{ minHeight: 44 }}
        className="flex-row items-center rounded-full border border-accent-500/50 bg-accent-500/20 px-3.5"
      >
        <Text className="text-[14px] font-semibold text-accent-400">{chip.label}</Text>
        <X color="#91c4ff" size={13} style={{ marginLeft: 6 }} />
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
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: 16 }}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y
      }}
      scrollEventThrottle={200}
      onEndReachedThreshold={0.6}
      onEndReached={() => void loadOlder()}
      ListHeaderComponent={rows.length > 0
        ? <Text accessibilityLiveRegion="polite" className="pt-3 text-[14px] text-surface-500">
          {partial ? `1-${rows.length} of ${total} transactions` : `${total} ${total === 1 ? 'transaction' : 'transactions'}`}
        </Text>
        : null}
      ListEmptyComponent={loading
        ? null
        : <View className="pt-6">
          <Empty
            title={filtered ? 'No matching transactions' : 'Record your first transaction'}
            detail={filtered
              ? 'Try another search, remove a filter, or choose a wider period.'
              : 'Add income, an expense, or a transfer between two accounts.'} />
          {filtered && view.period !== 'all' && <Pressable
            accessibilityRole="button"
            onPress={() => changeView(searchAllTime(view))}
            style={{ minHeight: TOUCH }}
            className="mx-6 items-center justify-center rounded-xl border border-surface-700 bg-surface-900"
          ><Text className="text-[16px] text-surface-100">Search all time</Text></Pressable>}
        </View>}
      renderSectionHeader={({ section }) => <View className="flex-row items-end justify-between bg-surface-950 pb-2 pt-5">
        <Text className="text-[14px] font-semibold uppercase tracking-wider text-surface-400">
          {new Date(`${section.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
        <Text
          accessibilityLabel={`${partial ? 'Net of the loaded rows' : 'Net'} ${money(netOf(section.data), true)}`}
          className="text-[14px] font-semibold text-surface-400"
          style={tabular}
        >{partial ? 'Shown ' : ''}{money(netOf(section.data), true)}</Text>
      </View>}
      renderItem={({ item, index, section }) => <View className={`overflow-hidden border-x border-surface-800 ${index === 0 ? 'rounded-t-2xl' : ''} ${index === section.data.length - 1 ? 'rounded-b-2xl border-b' : ''}`}>
        <TransactionRow
          item={item}
          selecting={selecting}
          checked={selectedIds.has(item.id)}
          onOpen={open}
          onToggle={toggle}
          onSelect={startSelection}
        />
      </View>}
      ListFooterComponent={<View style={{ paddingBottom: 96 + insets.bottom }} className="pt-4">
        {cursor && <Pressable
          accessibilityRole="button"
          onPress={() => void loadOlder()}
          style={{ minHeight: TOUCH }}
          className="items-center justify-center rounded-xl border border-surface-700 bg-surface-900"
        ><Text className="text-[16px] text-surface-100">Load older activity</Text></Pressable>}
      </View>}
    />

    {!selecting && <View
      style={{ bottom: Math.max(insets.bottom, 12) + 4 }}
      className="absolute left-4 right-4 flex-row items-center justify-between"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan receipt"
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
        disabled={openAccounts.length === 0}
        onPress={() => setAdding(true)}
        style={{ minHeight: TOUCH }}
        className={`flex-row items-center rounded-2xl px-5 ${openAccounts.length === 0 ? 'bg-surface-800' : 'bg-accent-600'}`}
      >
        <Plus color={openAccounts.length === 0 ? '#707078' : '#fff'} size={19} />
        <Text className={`ml-1.5 text-[16px] font-semibold ${openAccounts.length === 0 ? 'text-surface-500' : 'text-white'}`}>Add</Text>
      </Pressable>
    </View>}

    <Sheet visible={adding} title="Add" onClose={() => setAdding(false)}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setAdding(false)
          setCreating(true)
        }}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        className="justify-center rounded-2xl border border-surface-700 bg-surface-900 px-4 py-3"
      >
        <Text className="text-[16px] font-semibold text-surface-100">Transaction</Text>
        <Text className="mt-0.5 text-[14px] leading-5 text-surface-400">The amount keypad, with account, category, date, and notes.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setAdding(false)
          router.push('/transaction-image')
        }}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        className="mt-3 justify-center rounded-2xl border border-surface-700 bg-surface-900 px-4 py-3"
      >
        <Text className="text-[16px] font-semibold text-surface-100">Money agent</Text>
        <Text className="mt-0.5 text-[14px] leading-5 text-surface-400">Read a receipt image or a message into one or more transactions.</Text>
      </Pressable>
    </Sheet>

    {creating && <TransactionEntry
      key="new"
      snapshot={editorSnapshot}
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
