import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Tags, Trash2, TriangleAlert } from 'lucide-react'
import {
  monthOf, summarizeBudget,
  type BudgetInput, type CategoryBudgetStatus, type MoneySnapshot
} from '@ego/core'
import { formatMonth, isoToday, shiftMonth } from '@ego/local/dates'
import { localSnapshot } from '@ego/local/repositories/snapshot'
import { AmountSheet } from '../../components/money/AmountSheet'
import { Empty, MoneyIcon, MoneyScreen, money } from '../../components/money/Common'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { Screen } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { Card, CardHeader, CardTitle } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { BlurSpan, Blurred } from '../../lib/blur'
import { useMoney, useMoneyQuery } from '../../lib/money'
import { usePeriod } from '../../lib/period'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { FinanceHeader } from './header'

/** Status colors, each paired with words in the row, so the bar never carries the meaning alone. */
const BAR_COLORS: Record<CategoryBudgetStatus['state'], string> = {
  over: color.destructive, close: color.attention, under: color.positive, unplanned: '#525252'
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }): React.ReactElement {
  return <div className="min-w-0 flex-1">
    <p className="text-[14px] text-muted-foreground">{label}</p>
    <Blurred><p className={cn('mt-1 truncate text-[20px] font-bold tabular', bad && 'text-destructive')}>{value}</p></Blurred>
  </div>
}

function CategoryRow({ status, disabled, onClick }: { status: CategoryBudgetStatus; disabled: boolean; onClick: () => void }): React.ReactElement {
  const width = `${Math.min(100, Math.round(status.usedRatio * 100))}%`
  const over = status.state === 'over'
  const right = status.allocatedCents === 0
    ? status.spentCents > 0 ? money(status.spentCents) : 'Set budget'
    : over ? `${money(-status.remainingCents)} over` : `${money(status.remainingCents)} left`
  return <button
    type="button"
    aria-label={`${status.name}, ${status.allocatedCents === 0 ? 'no budget' : `${money(status.spentCents)} of ${money(status.allocatedCents)}`}, ${right}`}
    disabled={disabled}
    onClick={onClick}
    className="block w-full border-t border-surface-800 px-5 py-3.5 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
  >
    <span className="flex items-center">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: status.color }}>
        <MoneyIcon name={status.icon} size={19} />
      </span>
      <span className="ml-3 flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[17px] font-semibold">{status.name}</span>
        <Blurred active={status.allocatedCents !== 0}><span className="text-[14px] text-muted-foreground tabular">
          {status.allocatedCents === 0 ? 'No budget set' : `${money(status.spentCents)} of ${money(status.allocatedCents)}`}
        </span></Blurred>
      </span>
      <Blurred active={status.allocatedCents !== 0 || status.spentCents > 0}><span className={cn('ml-3 text-[15px] font-semibold tabular',
        over ? 'text-destructive' : status.state === 'close' ? 'text-attention' : status.allocatedCents === 0 && status.spentCents === 0 ? 'text-muted-foreground' : '')}>{right}</span></Blurred>
    </span>
    <span className="ml-14 mt-2.5 block h-2 overflow-hidden rounded-full bg-surface-800">
      <span className="block h-full rounded-full" style={{ width, backgroundColor: BAR_COLORS[status.state] }} />
    </span>
  </button>
}

function relativeMonth(month: string): string | null {
  const current = monthOf(isoToday())
  if (month === current) return 'This month'
  if (month === shiftMonth(current, -1)) return 'Last month'
  if (month === shiftMonth(current, 1)) return 'Next month'
  return null
}

const MONTH = /^\d{4}-\d{2}$/

/** The phone's Budget in two columns once the window is wide: the month's plan on the left, its categories on the right. */
export default function Budget(): React.ReactElement {
  const state = useMoney()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const period = usePeriod()
  /** Opening the tab lands on the month the other tabs show; stepping here stays local, so future months can be planned. */
  const [month, setMonth] = useState(() => monthOf(period.anchor))
  const requested = params.get('month')
  useEffect(() => {
    if (!requested) return
    if (MONTH.test(requested)) setMonth(requested)
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('month')
      return next
    }, { replace: true })
  }, [requested, setParams])
  const [editing, setEditing] = useState<'income' | CategoryBudgetStatus | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const monthData = useMoneyQuery((db) => localSnapshot(db, new Date().toISOString(), {
    accounts: false,
    budgetMonth: month,
    purchases: false,
    transactionFrom: `${month}-01`,
    transactionTo: `${month}-31`
  }), [month])

  return <Screen>
    <FinanceHeader />
    <MoneyScreen>{(baseSnapshot: MoneySnapshot) => {
      if (!monthData) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      const snapshot: MoneySnapshot = {
        ...baseSnapshot,
        budgets: monthData.budgets,
        transactions: monthData.transactions
      }
      const summary = summarizeBudget(snapshot, month)
      const planned = snapshot.budgets.some((item) => item.month === month)
      const allocations = summary.categories
        .filter((item) => item.allocatedCents > 0)
        .map((item) => ({ categoryId: item.categoryId, amountCents: item.allocatedCents }))

      const save = async (input: BudgetInput): Promise<void> => {
        if (await state.saveBudget(input)) setEditing(null)
      }
      const saveIncome = (cents: number): void => {
        void save({ month, plannedIncomeCents: cents, allocations })
      }
      const saveAllocation = (categoryId: string, cents: number): void => {
        void save({
          month,
          plannedIncomeCents: summary.plannedIncomeCents,
          allocations: [...allocations.filter((item) => item.categoryId !== categoryId),
            ...(cents > 0 ? [{ categoryId, amountCents: cents }] : [])]
        })
      }
      const clear = async (): Promise<void> => {
        if (await state.deleteBudget(month)) setConfirmingClear(false)
      }

      return <>
        <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center px-6 pb-3 pt-4">
          <IconButton label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="h-11 w-11">
            <ChevronLeft color="#fafafa" size={22} />
          </IconButton>
          <div className="flex flex-1 flex-col items-center">
            <span aria-live="polite" className="text-[22px] font-bold tracking-tight">{formatMonth(month)}</span>
            <span className="mt-0.5 flex min-h-[20px] items-center gap-2">
              {relativeMonth(month) && <span className="text-[14px] text-muted-foreground">{relativeMonth(month)}</span>}
              {month !== monthOf(isoToday()) && <button type="button" onClick={() => setMonth(monthOf(isoToday()))} className="text-[14px] font-semibold underline">
                Back to this month
              </button>}
            </span>
          </div>
          <IconButton label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="h-11 w-11">
            <ChevronRight color="#fafafa" size={22} />
          </IconButton>
        </div>

        <PeriodSwipe onStep={(delta) => setMonth(shiftMonth(month, delta))}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pb-8 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {summary.overspent.length > 0 && <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-5">
                  <div className="flex items-center"><TriangleAlert color="#fb7185" size={18} /><span className="ml-2 text-[17px] font-semibold text-destructive">Over budget</span></div>
                  {summary.overspent.map((item) => <p key={item.categoryId} className="mt-1.5 text-[15px] leading-5 text-rose-200">
                    {item.name} is <BlurSpan>{money(item.spentCents - item.allocatedCents)}</BlurSpan> past its <BlurSpan>{money(item.allocatedCents)}</BlurSpan> budget
                  </p>)}
                </div>}

                <button type="button" title="Changes the planned income" disabled={state.readOnly} onClick={() => setEditing('income')} className="rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:bg-surface-900">
                  <span className="text-[14px] font-medium text-muted-foreground">Planned income</span>
                  <Blurred><span className="mt-1 block truncate text-[36px] font-bold tracking-tight tabular">{money(summary.plannedIncomeCents)}</span></Blurred>
                  <span className="mt-1 block text-[15px] text-muted-foreground"><BlurSpan>{money(summary.actualIncomeCents)}</BlurSpan> received so far</span>
                </button>

                <Card className="flex gap-3 p-5">
                  <Stat label="Allocated" value={money(summary.allocatedCents)} />
                  <Stat label="Left to plan" value={money(summary.unallocatedCents)} bad={summary.unallocatedCents < 0} />
                  <Stat label="Spent" value={money(summary.spentCents)} bad={summary.overspent.length > 0} />
                </Card>

                {summary.unplannedSpentCents > 0 && <p className="px-1 text-[15px] leading-5 text-attention">
                  <BlurSpan>{money(summary.unplannedSpentCents)}</BlurSpan> spent in categories with no budget this month.
                </p>}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <Card className="overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between pb-4">
                    <CardTitle>Categories</CardTitle>
                    <Button variant="secondary" size="sm" onClick={() => navigate('/money/categories')}>
                      <Tags color="#fafafa" size={15} />
                      Manage
                    </Button>
                  </CardHeader>
                  {summary.categories.length === 0
                    ? <p className="px-5 pb-5 text-muted-foreground">Create an expense category first.</p>
                    : summary.categories.map((status) => <CategoryRow key={status.categoryId} status={status} disabled={state.readOnly} onClick={() => setEditing(status)} />)}
                </Card>

                {planned && <Button variant="outline" size="lg" disabled={state.readOnly} onClick={() => setConfirmingClear(true)} className="border-destructive/40 text-destructive">
                  <Trash2 color="#fb7185" size={17} />
                  Clear this month
                </Button>}
                {snapshot.categories.filter((item) => item.kind === 'expense').length === 0 && <Empty title="Nothing to budget yet" detail="Add expense categories, then give each one a monthly amount." />}
              </div>
            </div>
          </div>
        </PeriodSwipe>

        <AmountSheet
          visible={editing === 'income'}
          title="Planned income"
          detail={formatMonth(month)}
          valueCents={summary.plannedIncomeCents}
          color="#34d399"
          onClose={() => setEditing(null)}
          onConfirm={saveIncome}
        />
        <AmountSheet
          visible={editing !== null && editing !== 'income'}
          title={editing !== null && editing !== 'income' ? editing.name : ''}
          detail={`Monthly budget for ${formatMonth(month)}`}
          valueCents={editing !== null && editing !== 'income' ? editing.allocatedCents : 0}
          color="#fafafa"
          onClose={() => setEditing(null)}
          onConfirm={(cents) => { if (editing !== null && editing !== 'income') saveAllocation(editing.categoryId, cents) }}
        />
        <ConfirmDialog
          visible={confirmingClear}
          title="Clear this month?"
          detail="The planned income and every allocation for this month are removed. Transactions stay."
          confirmLabel="Clear" destructive busy={state.busy}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => void clear()}
        />
      </>
    }}</MoneyScreen>
  </Screen>
}
