import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import {
  ArrowRight, Calculator, Check, ChevronRight, ListFilter, Plus, ScanLine, Search, Sparkles, Trash2, X
} from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot } from '@ego/core'
import { useLedger } from '../../lib/ledger-context'
import type { LocalFeedTransaction } from '../../lib/repositories/transactions'
import type { OutboxEntry } from '../../lib/sync/outbox'
import {
  DEFAULT_ACTIVITY_VIEW, activityChips, activityFilters, filterCount, hasFilters, parsePreferences,
  storedPreferences, viewIdentity, type ActivityView
} from '../../lib/activity-view'
import { usePeriod } from '../../lib/period-context'
import { Blurred } from '../../lib/blur'
import { transactionDetail, transactionTitle } from '../../lib/transaction-title'
import { ConflictEntries } from '../ConflictEntries'
import { ConfirmDialog, Empty, MoneyIcon, Sheet, money } from './Common'
import FilterSheet from './FilterSheet'
import { PeriodBar } from './PeriodBar'
import { PeriodSwipe } from './PeriodSwipe'
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
  const title = transactionTitle(item)
  const detail = transactionDetail(item)
  return <Pressable
    accessibilityRole="button"
    accessibilityState={selecting ? { selected: checked } : undefined}
    accessibilityLabel={`${item.kind} ${sign}${money(item.amountCents)}, ${title}, ${detail}${state ? `, ${state}` : ''}`}
    accessibilityHint={selecting ? undefined : 'Opens this transaction'}
    onPress={() => selecting ? onToggle(item.id) : onOpen(item.id)}
    onLongPress={() => selecting ? onToggle(item.id) : onSelect(item.id)}
    delayLongPress={350}
    android_ripple={{ color: 'rgba(255, 255, 255, 0.08)' }}
    style={{ minHeight: ROW_MIN_HEIGHT + 8 }}
    className={`flex-row items-center border-t border-surface-800 px-4 py-3 ${checked ? 'bg-accent-500/15' : 'bg-card'}`}
  >
    {selecting && <View className={`mr-3 h-6 w-6 items-center justify-center rounded-full border ${checked ? 'border-accent-500 bg-primary' : 'border-surface-600'}`}>
      {checked && <Check color="#0a0a0a" size={13} strokeWidth={3} />}
    </View>}
    <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: item.categoryColor ?? '#404040' }}>
      <MoneyIcon name={item.categoryIcon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={19} />
    </View>
    <View className="ml-3 flex-1">
      <Text numberOfLines={1} className="text-[17px] font-semibold text-surface-100">{title}</Text>
      <View className="mt-0.5 flex-row flex-wrap items-center">
        <Text numberOfLines={1} className="text-[14px] text-surface-400">{detail}</Text>
        {item.kind === 'transfer' && <>
          <ArrowRight color="#a3a3a3" size={12} style={{ marginHorizontal: 4 }} />
          <Text className="text-[14px] text-surface-400">{item.destinationAccountName ?? 'Archived account'}</Text>
        </>}
        {state && <View className={`ml-2 rounded-full px-2 py-0.5 ${item.pending === 'pending' ? 'bg-surface-800' : 'bg-attention/20'}`}>
          <Text className={`text-[14px] ${item.pending === 'pending' ? 'text-surface-300' : 'text-attention'}`}>{state}</Text>
        </View>}
      </View>
    </View>
    <Blurred tint={amountColor(item.kind)}><Text className="ml-3 text-[17px] font-semibold" style={{ ...tabular, color: amountColor(item.kind) }}>
      {sign}{money(item.amountCents)}
    </Text></Blurred>
  </Pressable>
})

function AddOption({ Icon, title, detail, onPress }: { Icon: typeof Calculator; title: string; detail: string; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="mb-3 min-h-[84px] flex-row items-center rounded-2xl border border-border bg-card px-4 py-3 active:bg-surface-900"
  >
    <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Icon color="#fafafa" size={22} /></View>
    <View className="ml-3.5 flex-1">
      <Text className="text-[17px] font-semibold text-foreground">{title}</Text>
      <Text className="mt-0.5 text-[15px] leading-5 text-muted-foreground">{detail}</Text>
    </View>
    <ChevronRight color="#737373" size={20} />
  </Pressable>
}

function ConflictReview({ entries, onKeepMine, onUseSaved, onClose }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => void
  onUseSaved: (entry: OutboxEntry) => void
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible title="Needs attention" onClose={onClose}>
    <ConflictEntries entries={entries} onKeepMine={onKeepMine} onUseSaved={onUseSaved} />
  </Sheet>
}

export default function LocalActivity(): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ categoryId?: string; new?: string; review?: string }>()
  const period = usePeriod()
  const range = period.range
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

  const { categoryId } = params
  useEffect(() => {
    if (!restored || !categoryId) return
    setView((current) => current.categoryIds.includes(categoryId)
      ? current
      : { ...current, categoryIds: [...current.categoryIds, categoryId] })
    router.setParams({ categoryId: undefined })
  }, [categoryId, restored, router])

  const conflictCount = ledger.conflicts.length
  useEffect(() => {
    if (params.review !== 'true') return
    if (conflictCount > 0) setReviewing(true)
    router.setParams({ review: undefined })
  }, [conflictCount, params.review, router])

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

  const identity = viewIdentity(view, range)

  const { feed, version } = ledger
  const loadFirstPage = useCallback(async (): Promise<void> => {
    query.current += 1
    const started = query.current
    setLoading(true)
    try {
      const page = await feed(activityFilters(view, range), null, PAGE_SIZE)
      if (started !== query.current) return
      setRows(page.items)
      setTotal(page.totalCount ?? page.items.length)
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
      const page = await feed(activityFilters(view, range), {
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
  const openAccounts = accounts.filter((account) => !account.archivedAt)
  const filtered = view.search.trim().length > 0 || hasFilters(view)
  const activeFilters = filterCount(view)

  if (ledger.error) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[20px] font-semibold text-surface-100">This device cannot open its ledger</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{ledger.error}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={{ minHeight: TOUCH }} className="mt-5 justify-center rounded-xl bg-primary px-5">
        <Text className="text-[16px] font-semibold text-primary-foreground">Open settings</Text>
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
          <Pressable accessibilityRole="button" onPress={() => void ledger.sync()} style={{ minHeight: TOUCH }} className="mt-5 justify-center rounded-xl bg-primary px-5">
            <Text className="text-[16px] font-semibold text-primary-foreground">Try again</Text>
          </Pressable>
        </>
        : <>
          <ActivityIndicator color="#fafafa" />
          {restored && <Text className="mt-3 text-[14px] text-surface-400">Downloading your ledger</Text>}
        </>}
    </View>
  }

  return <View className="flex-1 bg-surface-950">
    <PeriodBar />
    <PeriodSwipe enabled={!selecting}>

    {selecting
      ? <View className="flex-row items-center gap-2 border-b border-surface-800 px-2 py-1.5">
        <Pressable accessibilityRole="button" accessibilityLabel="Leave selection" onPress={exitSelection} hitSlop={8} className="h-12 w-12 items-center justify-center">
          <X color="#d4d4d4" size={19} />
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
        ><Trash2 color={selected.length === 0 ? '#737373' : '#0a0a0a'} size={17} /></Pressable>
      </View>
      : <View className="mx-4 flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3">
        <Search color="#a3a3a3" size={16} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search activity"
          placeholder="Search activity"
          placeholderTextColor="#a3a3a3"
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
        ><X color="#a3a3a3" size={16} /></Pressable>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select transactions"
          disabled={rows.length === 0}
          onPress={() => setSelecting(true)}
          style={{ minHeight: TOUCH }}
          className="justify-center pl-2"
        ><Text className={`text-[14px] font-semibold ${rows.length === 0 ? 'text-surface-600' : 'text-accent-400'}`}>Select</Text></Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} on` : 'Filters'}
          onPress={() => setFiltering(true)}
          className={`h-12 w-12 items-center justify-center rounded-xl border ${activeFilters > 0 ? 'border-primary bg-primary' : 'border-surface-700 bg-surface-900 active:bg-surface-800'}`}
        >
          <ListFilter color={activeFilters > 0 ? '#0a0a0a' : '#fafafa'} size={20} />
          {activeFilters > 0 && <View className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-foreground px-1">
            <Text className="text-[11px] font-bold text-background">{activeFilters}</Text>
          </View>}
        </Pressable>
      </View>}

    {chips.length > 0 && <View className="flex-row flex-wrap items-center gap-2 px-4 pt-2.5">
      {chips.map((chip) => <Pressable
        key={chip.id}
        accessibilityRole="button"
        accessibilityLabel={`Remove filter ${chip.label}`}
        onPress={() => changeView(chip.next)}
        style={{ minHeight: 44 }}
        className="flex-row items-center rounded-full border border-accent-500/50 bg-accent-500/20 px-3.5"
      >
        <Text className="text-[14px] font-semibold text-accent-400">{chip.label}</Text>
        <X color="#fafafa" size={13} style={{ marginLeft: 6 }} />
      </Pressable>)}
    </View>}

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
            title={filtered ? 'No matching transactions' : period.period !== 'all' ? `Nothing in ${period.label}` : 'Record your first transaction'}
            detail={filtered
              ? 'Try another search, remove a filter, or choose a wider period.'
              : period.period !== 'all'
                ? 'Step to another period above, or look at all time.'
                : 'Add income, an expense, or a transfer between two accounts.'} />
          {period.period !== 'all' && <Pressable
            accessibilityRole="button"
            onPress={() => period.setPeriod('all')}
            style={{ minHeight: TOUCH }}
            className="mx-6 items-center justify-center rounded-xl border border-surface-700 bg-surface-900"
          ><Text className="text-[16px] text-surface-100">Show all time</Text></Pressable>}
        </View>}
      renderSectionHeader={({ section }) => {
        const net = netOf(section.data)
        const netColor = net < 0 ? amountColor('expense') : net > 0 ? amountColor('income') : '#a3a3a3'
        return <View className="flex-row items-end justify-between bg-surface-950 pb-2 pt-5">
          <Text className="text-[14px] font-semibold uppercase tracking-wider text-surface-400">
            {new Date(`${section.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
          <Blurred tint={netColor}><Text accessibilityLabel={`${partial ? 'Net of the loaded rows' : 'Net'} ${money(net, true)}`} className="text-[14px] font-semibold" style={{ ...tabular, color: netColor }}>
            {money(net, true)}
          </Text></Blurred>
        </View>
      }}
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
    </PeriodSwipe>

    {!selecting && <View
      style={{ bottom: Math.max(insets.bottom, 12) + 4 }}
      className="absolute left-4 right-4 flex-row items-center justify-between"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan receipt"
        onPress={() => router.push('/ai')}
        style={{ minHeight: TOUCH }}
        className="flex-row items-center rounded-2xl border border-surface-700 bg-surface-900/95 px-4"
      >
        <ScanLine color="#d4d4d4" size={16} />
        <Text className="ml-2 text-[14px] font-semibold text-surface-200">Scan receipt</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        disabled={openAccounts.length === 0}
        onPress={() => setAdding(true)}
        style={{ minHeight: TOUCH }}
        className={`flex-row items-center rounded-2xl px-5 ${openAccounts.length === 0 ? 'bg-surface-800' : 'bg-primary'}`}
      >
        <Plus color={openAccounts.length === 0 ? '#737373' : '#0a0a0a'} size={19} />
        <Text className={`ml-1.5 text-[16px] font-semibold ${openAccounts.length === 0 ? 'text-surface-500' : 'text-primary-foreground'}`}>Add</Text>
      </Pressable>
    </View>}

    <Sheet visible={adding} title="Add" onClose={() => setAdding(false)} dismissOnBackdrop>
      <AddOption
        Icon={Calculator}
        title="Transaction"
        detail="Type the amount, then pick the account and category."
        onPress={() => {
          setAdding(false)
          setCreating(true)
        }}
      />
      <AddOption
        Icon={Sparkles}
        title="AI"
        detail="Turn a receipt photo or a message into transactions."
        onPress={() => {
          setAdding(false)
          router.push('/ai')
        }}
      />
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
