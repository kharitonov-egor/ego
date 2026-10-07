import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ChevronRight, Pencil, Receipt, Trash2 } from 'lucide-react'
import type { MoneySnapshot } from '@ego/core'
import type { LocalFeedTransaction } from '@ego/local/repositories/transactions'
import { noteTitle, transactionTitle } from '@ego/local/transaction-title'
import { MoneyIcon, money } from '../../components/money/Common'
import TransactionEntry from '../../components/money/TransactionEntry'
import { CenteredMessage, Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { Blurred } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { amountColor, amountSign } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { useBackPath } from './header'

function Row({ label, value, first = false, amount = false }: { label: string; value: string; first?: boolean; amount?: boolean }): React.ReactElement {
  return <div className={cn('flex min-h-14 items-center justify-between px-5 py-3.5', !first && 'border-t border-surface-800')}>
    <span className="text-[15px] text-surface-400">{label}</span>
    <Blurred active={amount}><span className="ml-4 flex-1 whitespace-pre-line text-right text-[17px] leading-6 text-foreground">{value}</span></Blurred>
  </div>
}

export default function TransactionDetail(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ id: string }>()
  const backPath = useBackPath('/money/transactions')
  const [transaction, setTransaction] = useState<LocalFeedTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null)

  const { transaction: findTransaction, receipt: findReceipt, version } = ledger
  const load = useCallback(async (): Promise<void> => {
    if (!params.id) {
      setLoading(false)
      return
    }
    try {
      const found = await findTransaction(params.id)
      setTransaction(found)
      if (found?.purchaseId) {
        const receipt = await findReceipt(found.purchaseId)
        setReceiptTotal(receipt?.purchase.totalCents ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [params.id, version, findTransaction, findReceipt])

  useEffect(() => {
    void load()
  }, [load])

  const back = (): void => {
    void navigate(backPath)
  }

  if (loading) {
    return <Screen>
      <ScreenHeader title="Transaction" back={backPath} />
      <div className="flex flex-1 items-center justify-center"><Spinner /></div>
    </Screen>
  }

  if (!transaction) {
    return <Screen>
      <ScreenHeader title="Transaction" back={backPath} />
      <div className="min-h-0 flex-1">
        <CenteredMessage title="This transaction is gone" detail="It was deleted here or on another device." action="Back to Activity" onAction={() => navigate('/money/transactions')} />
      </div>
    </Screen>
  }

  const sign = amountSign(transaction.kind)
  const heading = transactionTitle(transaction)
  const moreNotes = transaction.notes.trim().length > 0 && transaction.notes.trim() !== noteTitle(transaction.notes)
  const editorSnapshot: MoneySnapshot = {
    accounts: (ledger.reference?.accounts ?? []).map((account) => ({
      ...account,
      balanceCents: ledger.balances.find((balance) => balance.accountId === account.id)?.balanceCents
        ?? account.openingBalanceCents
    })),
    categories: ledger.reference?.categories ?? [],
    transactions: [transaction],
    purchases: [],
    budgets: [],
    syncedAt: new Date().toISOString()
  }

  return <Screen>
    <ScreenHeader title="Transaction" back={backPath} />
    <ScreenBody className="pb-10">
      <Card className="flex flex-col items-center px-5 py-7">
        <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: transaction.categoryColor ?? '#737373' }}>
          <MoneyIcon name={transaction.categoryIcon ?? (transaction.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={28} />
        </span>
        <h2 className="mt-4 text-center text-[22px] font-bold text-foreground">{heading}</h2>
        <Blurred><p
          aria-label={`${transaction.kind} of ${money(transaction.amountCents)}`}
          className="mt-1 text-[40px] font-bold tracking-tight tabular"
          style={{ color: amountColor(transaction.kind) }}
        >{sign}{money(transaction.amountCents)}</p></Blurred>
        {transaction.pending !== 'none' && <p className={cn('mt-1.5 text-[14px]', transaction.pending === 'pending' ? 'text-surface-400' : 'text-amber-300')}>
          {transaction.pending === 'pending' ? 'Pending. Waiting for the server.' : 'Needs attention. Review it in Activity.'}
        </p>}
      </Card>

      <Card className="mt-3 overflow-hidden">
        <Row first label="Date" value={new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
        <Row label={transaction.kind === 'transfer' ? 'From' : 'Account'} value={transaction.accountName} />
        {transaction.kind === 'transfer'
          ? <Row label="To" value={transaction.destinationAccountName ?? 'Archived account'} />
          : <Row label="Category" value={transaction.categoryName ?? 'Archived category'} />}
        {moreNotes && <Row label="Note" value={transaction.notes.trim()} />}
      </Card>

      {transaction.purchaseId && <Card className="mt-3 overflow-hidden">
        <div className="flex items-center px-5 pb-2 pt-4">
          <Receipt color="#fafafa" size={17} />
          <h3 className="ml-2 text-[17px] font-semibold text-foreground">Receipt</h3>
        </div>
        <Row label="Merchant" value={transaction.merchant ?? heading} />
        <Row label="Receipt total" value={money(receiptTotal ?? transaction.amountCents)} amount />
        <button
          type="button"
          onClick={() => navigate(`/money/purchases?purchaseId=${encodeURIComponent(transaction.purchaseId ?? '')}`, { state: { from: `${location.pathname}${location.search}` } })}
          className="flex min-h-14 w-full items-center justify-between border-t border-surface-800 px-5 text-left transition-colors hover:bg-surface-900"
        >
          <span className="text-[17px] font-semibold text-foreground">View items</span>
          <ChevronRight color="#a3a3a3" size={20} />
        </button>
      </Card>}

      <div className="mt-5 flex gap-3">
        <Button size="lg" onClick={() => setEditing(true)} className="flex-1">
          <Pencil color="#0a0a0a" size={18} />
          Edit
        </Button>
        <Button size="lg" variant="outline" onClick={() => setConfirming(true)} className="flex-1 border-destructive/40 text-destructive">
          <Trash2 color="#fb7185" size={18} />
          Delete
        </Button>
      </div>
    </ScreenBody>

    {editing && <TransactionEntry
      snapshot={editorSnapshot}
      transaction={transaction}
      onDelete={async () => {
        const removed = await ledger.removeTransaction(transaction)
        if (removed) back()
        return removed
      }}
      onClose={() => setEditing(false)}
    />}

    <ConfirmDialog
      visible={confirming}
      title="Delete this transaction?"
      detail="Account balances update immediately. The deletion syncs when the server is reachable."
      confirmLabel="Delete"
      destructive
      onCancel={() => setConfirming(false)}
      onConfirm={() => void (async () => {
        const removed = await ledger.removeTransaction(transaction)
        setConfirming(false)
        if (removed) back()
      })()}
    />
  </Screen>
}
