import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  ArrowRight, Calculator, Check, ChevronRight, ListFilter, Plus, ScanLine, Search, Sparkles, Trash2, X
} from 'lucide-react'
import type { MoneySnapshot } from '@ego/core'
import type { LocalFeedTransaction } from '@ego/local/repositories/transactions'
import type { OutboxEntry } from '@ego/local/sync/outbox'
import {
  DEFAULT_ACTIVITY_VIEW, activityChips, activityFilters, filterCount, hasFilters, parsePreferences,
  storedPreferences, viewIdentity, type ActivityView
} from '@ego/local/activity-view'
import { transactionDetail, transactionTitle } from '@ego/local/transaction-title'
import { Blurred } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { usePeriod } from '../../lib/period'
import { SecureStore } from '../../lib/preferences'
import { amountColor, amountSign } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { ConflictEntries } from '../ConflictEntries'
import { CenteredMessage } from '../screen'
import { Button } from '../ui/button'
import { ConfirmDialog, Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'
import { Empty, MoneyIcon, money } from './Common'
import FilterSheet from './FilterSheet'
import { PeriodBar } from './PeriodBar'
import { PeriodSwipe, isTyping } from './PeriodSwipe'
import { useReceiptReader } from './ReceiptReader'
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

function netOf(items: LocalFeedTransaction[]): number {
  return items.reduce((sum, item) =>
    sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0)
}

const SEARCH_DELAY_MS = 250

/** A click opens the row. Ctrl+click or a right-click starts a selection, and Shift+click extends it. */
const TransactionRow = memo(function TransactionRow({ item, selecting, checked, onOpen, onToggle, onSelect, onExtend }: {
  item: LocalFeedTransaction
  selecting: boolean
  checked: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onExtend: (id: string) => void
}): React.ReactElement {
  const state = pendingLabel(item.pending)
  const sign = amountSign(item.kind)
  const title = transactionTitle(item)
  const detail = transactionDetail(item)
  return <button
    type="button"
    aria-pressed={selecting ? checked : undefined}
    aria-label={`${item.kind} ${sign}${money(item.amountCents)}, ${title}, ${detail}${state ? `, ${state}` : ''}`}
    onClick={(event) => {
      if (event.shiftKey && selecting) onExtend(item.id)
      else if (selecting) onToggle(item.id)
      else if (event.ctrlKey || event.metaKey) onSelect(item.id)
      else onOpen(item.id)
    }}
    onContextMenu={(event) => {
      event.preventDefault()
      if (selecting) onToggle(item.id)
      else onSelect(item.id)
    }}
    className={cn('flex min-h-[72px] w-full select-none items-center border-t border-surface-800 px-4 py-3 text-left transition-colors',
      checked ? 'bg-accent-500/15' : 'bg-card hover:bg-surface-900')}
  >
    {selecting && <span className={cn('mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', checked ? 'border-accent-500 bg-primary' : 'border-surface-600')}>
      {checked && <Check color="#0a0a0a" size={13} strokeWidth={3} />}
    </span>}
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: item.categoryColor ?? '#404040' }}>
      <MoneyIcon name={item.categoryIcon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={19} />
    </span>
    <span className="ml-3 flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[17px] font-semibold text-surface-100">{title}</span>
      <span className="mt-0.5 flex flex-wrap items-center">
        <span className="truncate text-[14px] text-surface-400">{detail}</span>
        {item.kind === 'transfer' && <>
          <ArrowRight color="#a3a3a3" size={12} className="mx-1" />
          <span className="text-[14px] text-surface-400">{item.destinationAccountName ?? 'Archived account'}</span>
        </>}
        {state && <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[14px]', item.pending === 'pending' ? 'bg-surface-800 text-surface-300' : 'bg-attention/20 text-attention')}>
          {state}
        </span>}
      </span>
    </span>
    <Blurred><span className="ml-3 text-[17px] font-semibold tabular" style={{ color: amountColor(item.kind) }}>
      {sign}{money(item.amountCents)}
    </span></Blurred>
  </button>
})

function AddOption({ Icon, title, detail, onClick }: { Icon: typeof Calculator; title: string; detail: string; onClick: () => void }): React.ReactElement {
  return <button
    type="button"
    onClick={onClick}
    className="mb-3 flex min-h-[84px] w-full items-center rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-surface-900"
  >
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-800"><Icon color="#fafafa" size={22} /></span>
    <span className="ml-3.5 flex flex-1 flex-col">
      <span className="text-[17px] font-semibold text-foreground">{title}</span>
      <span className="mt-0.5 text-[15px] leading-5 text-muted-foreground">{detail}</span>
    </span>
    <ChevronRight color="#737373" size={20} />
  </button>
}

function ConflictReview({ entries, onKeepMine, onUseSaved, onClose }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => Promise<void>
  onUseSaved: (entry: OutboxEntry) => Promise<void>
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible title="Needs attention" onClose={onClose}>
    <ConflictEntries entries={entries} onKeepMine={onKeepMine} onUseSaved={onUseSaved} />
  </Sheet>
}

export default function LocalActivity(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const location = useLocation()
  const receipts = useReceiptReader()
  const [params, setParams] = useSearchParams()
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
  const listRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const anchorRow = useRef<string | null>(null)
  const offset = useRef(session?.offset ?? 0)
  const pendingScroll = useRef(session?.offset ?? 0)
  const loadingOlder = useRef(false)
  const query = useRef(0)
  const [search, setSearch] = useState(DEFAULT_ACTIVITY_VIEW.search)

  const dropParam = useCallback((name: string): void => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(name)
      return next
    }, { replace: true })
  }, [setParams])

  useEffect(() => {
    void (async () => {
      const stored = await SecureStore.getItemAsync(PREFERENCES_KEY).catch(() => null)
      const preferences = parsePreferences(stored)
      setView(preferences)
      setSearch(preferences.search)
      setRestored(true)
    })()
  }, [])

  const categoryId = params.get('categoryId')
  useEffect(() => {
    if (!restored || !categoryId) return
    setView((current) => current.categoryIds.includes(categoryId)
      ? current
      : { ...current, categoryIds: [...current.categoryIds, categoryId] })
    dropParam('categoryId')
  }, [categoryId, dropParam, restored])

  const conflictCount = ledger.conflicts.length
  const review = params.get('review')
  useEffect(() => {
    if (review !== 'true') return
    if (conflictCount > 0) setReviewing(true)
    dropParam('review')
  }, [conflictCount, dropParam, review])

  const create = params.get('new')
  useEffect(() => {
    if (create !== 'true') return
    setCreating(true)
    dropParam('new')
  }, [create, dropParam])

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

  /** Another search, filter, or period starts at the top, as a fresh list would. */
  const shownIdentity = useRef(session?.identity ?? null)
  useEffect(() => {
    if (!restored || shownIdentity.current === identity) return
    const first = shownIdentity.current === null
    shownIdentity.current = identity
    if (first) return
    offset.current = 0
    pendingScroll.current = 0
    if (listRef.current) listRef.current.scrollTop = 0
  }, [identity, restored])

  useLayoutEffect(() => {
    if (pendingScroll.current <= 0 || rows.length === 0 || !listRef.current) return
    listRef.current.scrollTop = pendingScroll.current
    pendingScroll.current = 0
  }, [rows.length])

  const loadOlder = useCallback(async (): Promise<void> => {
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
  }, [cursor, feed, range, rows, view])

  /** The phone loads the next page as the list nears its end; a sentinel below the rows does it here. */
  useEffect(() => {
    const end = endRef.current
    if (!end || !cursor) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadOlder()
    }, { root: listRef.current, rootMargin: '600px 0px' })
    observer.observe(end)
    return () => observer.disconnect()
  }, [cursor, loadOlder])

  const changeView = (next: ActivityView): void => {
    setView(next)
    setSearch(next.search)
    setSelecting(false)
    setSelected([])
    offset.current = 0
  }

  const exitSelection = useCallback((): void => {
    setSelecting(false)
    setSelected([])
  }, [])
  const toggle = useCallback((id: string): void => {
    anchorRow.current = id
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }, [])
  const open = useCallback((id: string): void => {
    navigate(`/money/transaction/${encodeURIComponent(id)}`, { state: { from: `${location.pathname}${location.search}` } })
  }, [location.pathname, location.search, navigate])
  const startSelection = useCallback((id: string): void => {
    anchorRow.current = id
    setSelecting(true)
    setSelected([id])
  }, [])
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows])
  const extend = useCallback((id: string): void => {
    const from = anchorRow.current ? rowIds.indexOf(anchorRow.current) : -1
    const to = rowIds.indexOf(id)
    if (from < 0 || to < 0) {
      toggle(id)
      return
    }
    const span = rowIds.slice(Math.min(from, to), Math.max(from, to) + 1)
    setSelected((current) => [...new Set([...current, ...span])])
  }, [rowIds, toggle])
  const selectedIds = useMemo(() => new Set(selected), [selected])

  useEffect(() => {
    if (!selecting) return
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || document.querySelector('[aria-modal="true"]')) return
      if (event.key === 'Escape') exitSelection()
      else if (event.key === 'Delete' && selected.length > 0) setConfirmingBulk(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitSelection, selected.length, selecting])

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
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id))
  const openAccounts = accounts.filter((account) => !account.archivedAt)
  const filtered = view.search.trim().length > 0 || hasFilters(view)
  const activeFilters = filterCount(view)

  if (ledger.error) {
    return <CenteredMessage title="This device cannot open its ledger" detail={ledger.error} action="Open settings" onAction={() => navigate('/settings')} />
  }

  if (!restored || (!ledger.ready && rows.length === 0)) {
    const stopped = Boolean(ledger.status) && !ledger.syncing
    const offline = ledger.status?.state === 'offline'
    if (stopped) {
      return <CenteredMessage
        title={offline ? 'Waiting for a connection' : 'The download did not finish'}
        detail={offline ? 'The first download needs the internet. After that, Activity works offline.' : ledger.status?.message ?? 'Try again in a moment.'}
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <div className="flex h-full flex-col items-center justify-center">
      <Spinner />
      {restored && <p className="mt-3 text-[14px] text-surface-400">Downloading your ledger</p>}
    </div>
  }

  return <div className="relative flex min-h-0 flex-1 flex-col">
    <PeriodBar />
    <PeriodSwipe enabled={!selecting}>
      <div className="mx-auto w-full max-w-2xl shrink-0 px-6">
        {selecting
          ? <div className="flex min-h-12 items-center gap-2 rounded-xl border border-surface-800 px-1.5 py-1">
            <button type="button" aria-label="Leave selection" title="Leave selection (Esc)" onClick={exitSelection} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-800">
              <X color="#d4d4d4" size={19} />
            </button>
            <span className="text-[16px] font-semibold text-surface-100">{selected.length} selected</span>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? [] : rowIds)}
              className="ml-auto flex min-h-10 items-center rounded-full border border-surface-700 bg-surface-900 px-3 text-[14px] font-semibold text-surface-300 hover:bg-surface-800"
            >{allSelected ? 'Clear loaded' : 'Select loaded'}</button>
            <button
              type="button"
              aria-label={`Delete ${selected.length} selected`}
              title="Delete (Del)"
              disabled={selected.length === 0}
              onClick={() => setConfirmingBulk(true)}
              className={cn('flex h-10 w-10 items-center justify-center rounded-full', selected.length === 0 ? 'bg-surface-800' : 'bg-destructive hover:bg-destructive/90')}
            ><Trash2 color={selected.length === 0 ? '#737373' : '#0a0a0a'} size={17} /></button>
          </div>
          : <div className="flex items-center gap-2">
            <div className="flex min-h-12 flex-1 items-center rounded-xl border border-surface-700 bg-surface-900 px-3 focus-within:border-surface-400">
              <Search color="#a3a3a3" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && search) {
                    event.preventDefault()
                    setSearch('')
                    setView((current) => ({ ...current, search: '' }))
                  }
                }}
                type="search"
                aria-label="Search activity"
                placeholder="Search activity"
                className="ml-2 min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-surface-100 outline-none placeholder:text-surface-400 [&::-webkit-search-cancel-button]:hidden"
              />
              {search.length > 0 && <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('')
                  setView((current) => ({ ...current, search: '' }))
                }}
                className="flex h-10 w-9 items-center justify-center"
              ><X color="#a3a3a3" size={16} /></button>}
              <button
                type="button"
                aria-label="Select transactions"
                disabled={rows.length === 0}
                onClick={() => setSelecting(true)}
                className={cn('min-h-10 pl-2 text-[14px] font-semibold', rows.length === 0 ? 'text-surface-600' : 'text-accent-400 hover:underline')}
              >Select</button>
            </div>
            <button
              type="button"
              aria-label={activeFilters > 0 ? `Filters, ${activeFilters} on` : 'Filters'}
              title="Filters"
              onClick={() => setFiltering(true)}
              className={cn('relative flex h-12 w-12 items-center justify-center rounded-xl border transition-colors',
                activeFilters > 0 ? 'border-primary bg-primary' : 'border-surface-700 bg-surface-900 hover:bg-surface-800')}
            >
              <ListFilter color={activeFilters > 0 ? '#0a0a0a' : '#fafafa'} size={20} />
              {activeFilters > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-foreground px-1 text-[11px] font-bold text-background">
                {activeFilters}
              </span>}
            </button>
          </div>}

        {chips.length > 0 && <div className="flex flex-wrap items-center gap-2 pt-2.5">
          {chips.map((chip) => <button
            key={chip.id}
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => changeView(chip.next)}
            className="flex min-h-10 items-center rounded-full border border-accent-500/50 bg-accent-500/20 px-3.5 text-[14px] font-semibold text-accent-400 hover:bg-accent-500/30"
          >
            {chip.label}
            <X color="#fafafa" size={13} className="ml-1.5" />
          </button>)}
        </div>}
      </div>

      <div
        ref={listRef}
        onScroll={(event) => {
          offset.current = event.currentTarget.scrollTop
          if (session) session.offset = offset.current
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-2xl px-6">
          {rows.length > 0 && <p aria-live="polite" className="pt-3 text-[14px] text-surface-500">
            {partial ? `1-${rows.length} of ${total} transactions` : `${total} ${total === 1 ? 'transaction' : 'transactions'}`}
          </p>}
          {rows.length === 0 && !loading && <div className="pt-6">
            <Empty
              title={filtered ? 'No matching transactions' : period.period !== 'all' ? `Nothing in ${period.label}` : 'Record your first transaction'}
              detail={filtered
                ? 'Try another search, remove a filter, or choose a wider period.'
                : period.period !== 'all'
                  ? 'Step to another period above, or look at all time.'
                  : 'Add income, an expense, or a transfer between two accounts.'} />
            {period.period !== 'all' && <Button variant="outline" size="lg" onClick={() => period.setPeriod('all')} className="mx-6 w-[calc(100%-3rem)] bg-surface-900 font-normal">Show all time</Button>}
          </div>}
          {sections.map((section) => {
            const net = netOf(section.data)
            const netColor = net < 0 ? amountColor('expense') : net > 0 ? amountColor('income') : '#a3a3a3'
            return <section key={section.date}>
              <div className="flex items-end justify-between pb-2 pt-5">
                <h2 className="text-[14px] font-semibold uppercase tracking-wider text-surface-400">
                  {new Date(`${section.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </h2>
                <Blurred><span aria-label={`${partial ? 'Net of the loaded rows' : 'Net'} ${money(net, true)}`} className="text-[14px] font-semibold tabular" style={{ color: netColor }}>
                  {money(net, true)}
                </span></Blurred>
              </div>
              <div className="overflow-hidden rounded-2xl border-x border-b border-surface-800">
                {section.data.map((item) => <TransactionRow
                  key={item.id}
                  item={item}
                  selecting={selecting}
                  checked={selectedIds.has(item.id)}
                  onOpen={open}
                  onToggle={toggle}
                  onSelect={startSelection}
                  onExtend={extend}
                />)}
              </div>
            </section>
          })}
          <div ref={endRef} className="pb-28 pt-4">
            {cursor && <Button variant="outline" size="lg" onClick={() => void loadOlder()} className="w-full bg-surface-900 font-normal">Load older activity</Button>}
          </div>
        </div>
      </div>
    </PeriodSwipe>

    {!selecting && <div className="pointer-events-none absolute inset-x-0 bottom-5">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6">
        <button
          type="button"
          onClick={receipts.open}
          className="pointer-events-auto flex min-h-12 items-center rounded-2xl border border-surface-700 bg-surface-900/95 px-4 text-[14px] font-semibold text-surface-200 shadow-lg transition-colors hover:bg-surface-800"
        >
          <ScanLine color="#d4d4d4" size={16} className="mr-2" />
          Scan receipt
        </button>
        <button
          type="button"
          aria-label="Add transaction"
          disabled={openAccounts.length === 0}
          onClick={() => setAdding(true)}
          className={cn('pointer-events-auto flex min-h-12 items-center rounded-2xl px-5 text-[16px] font-semibold shadow-lg transition-colors',
            openAccounts.length === 0 ? 'bg-surface-800 text-surface-500' : 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          <Plus color={openAccounts.length === 0 ? '#737373' : '#0a0a0a'} size={19} className="mr-1.5" />
          Add
        </button>
      </div>
    </div>}

    <Sheet visible={adding} title="Add" onClose={() => setAdding(false)} dismissOnBackdrop>
      <AddOption
        Icon={Calculator}
        title="Transaction"
        detail="Type the amount, then pick the account and category."
        onClick={() => {
          setAdding(false)
          setCreating(true)
        }}
      />
      <AddOption
        Icon={Sparkles}
        title="AI"
        detail="Turn a receipt photo or a message into transactions."
        onClick={() => {
          setAdding(false)
          navigate('/ai')
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
      onKeepMine={(entry) => ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
      onUseSaved={(entry) => ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      onClose={() => setReviewing(false)}
    />}

    <ConfirmDialog
      visible={confirmingBulk}
      title={`Delete ${selected.length} ${selected.length === 1 ? 'transaction' : 'transactions'}?`}
      detail="The rows leave this computer now and the deletion syncs when the server is reachable."
      confirmLabel="Delete"
      destructive
      onCancel={() => setConfirmingBulk(false)}
      onConfirm={() => void removeSelected()}
    />
  </div>
}
