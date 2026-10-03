import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Pencil, Receipt, ScanLine, Trash2 } from 'lucide-react'
import type { MoneyPurchase } from '@ego/core'
import { formatIso } from '@ego/local/dates'
import type { LocalFeedTransaction, LocalPurchaseHeader } from '@ego/local/repositories/transactions'
import { Empty, MoneyScreen, money } from '../../components/money/Common'
import PurchaseEditor, { draftForPurchase } from '../../components/money/PurchaseEditor'
import { useReceiptReader } from '../../components/money/ReceiptReader'
import { Screen, ScreenHeader } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { Blurred } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { useMoney } from '../../lib/money'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { useBackPath } from './header'

const PAGE_SIZE = 50

interface PurchaseSection {
  date: string
  data: LocalPurchaseHeader[]
}

function Total({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }): React.ReactElement {
  return <div className="flex items-center justify-between py-1">
    <span className={strong ? 'font-semibold' : 'text-[15px] text-muted-foreground'}>{label}</span>
    <Blurred><span className={cn('tabular', strong ? 'text-[17px] font-bold' : 'text-[15px] font-medium')}>{money(cents)}</span></Blurred>
  </div>
}

export default function Purchases(): React.ReactElement {
  const state = useMoney()
  const ledger = useLedger()
  const receipts = useReceiptReader()
  const back = useBackPath('/money/transactions')
  const [params, setParams] = useSearchParams()
  const [headers, setHeaders] = useState<LocalPurchaseHeader[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [selected, setSelected] = useState<MoneyPurchase | null>(null)
  const [linked, setLinked] = useState<LocalFeedTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const busyLoading = useRef(false)
  /** A change that lands while a page loads asks for a fresh first page afterwards, rather than going unseen. */
  const reloadQueued = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(async (offset: number): Promise<void> => {
    if (busyLoading.current) {
      if (offset === 0) reloadQueued.current = true
      return
    }
    busyLoading.current = true
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    try {
      const page = await ledger.purchasePage(PAGE_SIZE, offset)
      setHeaders((current) => offset === 0 ? page.items : [...current, ...page.items])
      setNextOffset(page.nextOffset)
    } finally {
      busyLoading.current = false
      if (offset === 0) setLoading(false)
      else setLoadingMore(false)
      if (reloadQueued.current) {
        reloadQueued.current = false
        void loadPage(0)
      }
    }
  }, [ledger.purchasePage])

  useEffect(() => {
    void loadPage(0)
  }, [ledger.version, loadPage])

  useEffect(() => {
    const end = endRef.current
    if (!end || nextOffset === null || nextOffset === 0) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(nextOffset)
    }, { root: listRef.current, rootMargin: '600px 0px' })
    observer.observe(end)
    return () => observer.disconnect()
  }, [loadPage, nextOffset])

  const purchaseId = params.get('purchaseId')
  useEffect(() => {
    if (!purchaseId) return
    void ledger.receipt(purchaseId).then(async (receipt) => {
      setSelected(receipt?.purchase ?? null)
      setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
    })
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('purchaseId')
      return next
    }, { replace: true })
  }, [ledger.receipt, ledger.transaction, purchaseId, setParams])

  const selectedId = useRef<string | null>(null)
  selectedId.current = selected?.id ?? null
  /** The open receipt refreshes after a local write or a pulled change. */
  useEffect(() => {
    const id = selectedId.current
    if (!id) return
    void ledger.receipt(id).then(async (receipt) => {
      setSelected(receipt?.purchase ?? null)
      setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
    })
  }, [ledger.receipt, ledger.transaction, ledger.version])

  const sections = useMemo(() => {
    const grouped: PurchaseSection[] = []
    for (const purchase of headers) {
      const last = grouped[grouped.length - 1]
      if (last?.date === purchase.purchaseDate) last.data.push(purchase)
      else grouped.push({ date: purchase.purchaseDate, data: [purchase] })
    }
    return grouped
  }, [headers])

  const open = async (id: string): Promise<void> => {
    const receipt = await ledger.receipt(id)
    setSelected(receipt?.purchase ?? null)
    setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
  }

  return <Screen>
    <ScreenHeader title="Purchase details" back={back} />
    <MoneyScreen>{(snapshot) => {
      const current = selected
      const editorSnapshot = linked ? { ...snapshot, transactions: [linked] } : snapshot
      const close = (): void => { setSelected(null); setLinked(null); setEditing(false) }
      const remove = async (): Promise<void> => {
        if (!current) return
        if (await state.deletePurchase(current.id)) { setConfirmingDelete(false); setSelected(null) }
      }

      return <>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-6 pb-28">
            {headers.length === 0 && (loading
              ? <div className="flex justify-center pt-8"><Spinner /></div>
              : <Empty title="No itemized purchases" detail="Read a receipt to save its expense and item list." />)}
            {sections.map((section) => <section key={section.date}>
              <h2 className="pb-2 pt-5 text-[14px] font-semibold text-muted-foreground">{formatIso(section.date)}</h2>
              <Card className="overflow-hidden rounded-2xl">{section.data.map((item, index) => <button
                key={item.id}
                type="button"
                aria-label={`${item.merchant}, ${item.itemCount} items, ${money(item.totalCents)}`}
                onClick={() => void open(item.id)}
                className={cn('flex min-h-[72px] w-full items-center px-4 py-3 text-left transition-colors hover:bg-surface-900', index > 0 && 'border-t border-surface-800')}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-800"><Receipt color="#fafafa" size={19} /></span>
                <span className="ml-3 flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[17px] font-semibold">{item.merchant}</span>
                  <span className="text-[14px] text-muted-foreground">{item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}</span>
                </span>
                <Blurred><span className="text-[17px] font-semibold tabular" style={{ color: color.expense }}>-{money(item.totalCents)}</span></Blurred>
              </button>)}</Card>
            </section>)}
            <div ref={endRef}>{loadingMore && <div className="flex justify-center py-5"><Spinner /></div>}</div>
          </div>
        </div>

        <Button
          size="lg"
          aria-label="Read a receipt"
          disabled={state.readOnly}
          onClick={receipts.open}
          className="absolute bottom-5 right-6 shadow-lg"
        >
          <ScanLine color="#0a0a0a" size={20} />
          Scan receipt
        </Button>

        <Sheet visible={Boolean(current)} title={editing ? 'Edit purchase' : current?.merchant ?? 'Purchase'} onClose={close} wide={editing}>
          {current && (editing
            ? <PurchaseEditor snapshot={editorSnapshot} purchase={current} draft={draftForPurchase(current)} busy={state.busy} onSave={async (input) => { if (await state.updatePurchase(current.id, input)) setEditing(false) }} />
            : <div>
              <p className="text-[15px] text-muted-foreground">{formatIso(current.purchaseDate)} · {current.currency}</p>
              <Blurred><p className="mt-1 text-[36px] font-bold tracking-tight tabular">{money(current.totalCents)}</p></Blurred>

              <Card className="mt-4 overflow-hidden">{current.items.map((item, index) => <div key={item.id} className={cn('flex min-h-14 items-center px-4 py-3', index > 0 && 'border-t border-surface-800')}>
                <div className="flex-1 pr-3">
                  <p className="text-[16px]">{item.name}</p>
                  {item.quantity !== 1 && <p className="text-[14px] text-muted-foreground">Quantity {item.quantity}</p>}
                </div>
                <Blurred><span className="text-[16px] font-semibold tabular">{money(item.lineTotalCents)}</span></Blurred>
              </div>)}</Card>

              <div className="mt-4 px-1">
                <Total label="Subtotal" cents={current.subtotalCents} />
                {current.discountCents > 0 && <Total label="Discount" cents={-current.discountCents} />}
                <Total label="Tax" cents={current.taxCents} />
                {current.feesCents > 0 && <Total label="Fees and tip" cents={current.feesCents} />}
                <div className="mt-2 border-t border-surface-800 pt-2"><Total label="Total" cents={current.totalCents} strong /></div>
              </div>

              <div className="mt-5 flex gap-3">
                <Button size="lg" disabled={state.readOnly} onClick={() => setEditing(true)} className="flex-1">
                  <Pencil color="#0a0a0a" size={18} />
                  Edit
                </Button>
                <Button variant="outline" size="lg" aria-label="Delete purchase" disabled={state.readOnly} onClick={() => setConfirmingDelete(true)} className="border-destructive/40 text-destructive">
                  <Trash2 color="#fb7185" size={18} />
                  Delete
                </Button>
              </div>
            </div>)}
        </Sheet>
        <ConfirmDialog visible={confirmingDelete} title="Delete purchase?" detail="This also deletes the linked expense and updates the account balance." confirmLabel="Delete" destructive busy={state.busy} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} />
      </>
    }}</MoneyScreen>
  </Screen>
}
