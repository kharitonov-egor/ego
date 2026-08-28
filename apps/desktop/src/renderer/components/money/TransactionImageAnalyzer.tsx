import React, { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, FileImage, LoaderCircle, RotateCcw, ScanLine, Upload } from 'lucide-react'
import {
  MAX_TRANSACTION_IMAGE_BYTES,
  splitImageDataUrl
} from '@ego/core'
import type { AnalyzedTransactionDraft, CategoryKind, MoneySnapshot, TransactionInput } from '../../../shared/types'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, inputClass, Modal, subtleButtonClass } from './Common'
import { PurchaseForm } from './PurchasesView'
import { todayString } from '../../money/utils'

function cents(value: string): number { return Math.max(0, Math.round((Number(value) || 0) * 100)) }
function dollars(value: number): string { return (value / 100).toFixed(2) }
function transactionNotes(counterparty: string, notes: string): string {
  return [counterparty.trim(), notes.trim()].filter(Boolean).join('\n').slice(0, 500)
}

async function readImage(file: File): Promise<{ base64: string; mimeType: string } | { error: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { error: 'Choose a JPEG, PNG, or WebP image.' }
  if (file.size > MAX_TRANSACTION_IMAGE_BYTES) return { error: 'This image is larger than 10 MB. Choose a smaller image.' }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable image'))
    reader.onerror = () => reject(new Error('Unreadable image'))
    reader.readAsDataURL(file)
  }).catch(() => '')
  if (!data) return { error: 'The image could not be read. Choose it again.' }
  return splitImageDataUrl(data) ?? { error: 'The image could not be read. Choose it again.' }
}

function TransactionDraftForm({ snapshot, actions, draft, kind, onKind, onSaved }: {
  snapshot: MoneySnapshot
  actions: MoneyActions
  draft: AnalyzedTransactionDraft
  kind: CategoryKind
  onKind: (kind: CategoryKind) => void
  onSaved: (target: 'transactions' | 'purchases') => void
}): React.ReactElement {
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt)
  const recentAccount = snapshot.transactions.find((item) => accounts.some((account) => account.id === item.accountId))
  const [accountId, setAccountId] = useState(recentAccount?.accountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(snapshot.categories.some((item) =>
    item.id === draft.categoryId && item.kind === kind && !item.archivedAt) ? draft.categoryId ?? '' : '')
  const [counterparty, setCounterparty] = useState(draft.counterparty)
  const [amount, setAmount] = useState(dollars(draft.amountCents))
  const [date, setDate] = useState(draft.date ?? todayString())
  const [notes, setNotes] = useState(draft.notes)
  const categories = snapshot.categories.filter((item) => item.kind === kind && !item.archivedAt)
  const amountCents = cents(amount)
  const valid = Boolean(accountId && categoryId && counterparty.trim() && amountCents > 0 && date)
  const changeKind = (value: CategoryKind): void => {
    onKind(value)
    setCategoryId(value === draft.kind && snapshot.categories.some((item) => item.id === draft.categoryId && !item.archivedAt) ? draft.categoryId ?? '' : '')
  }
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!valid) return
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: null, categoryId, amountCents, date,
      notes: transactionNotes(counterparty, notes)
    }
    if (await actions.createTransaction(input)) onSaved('transactions')
  }
  return <form className="space-y-4" onSubmit={(event) => void save(event)}>
    <div className="grid grid-cols-2 gap-2">{(['expense', 'income'] as CategoryKind[]).map((value) => <button key={value} type="button" onClick={() => changeKind(value)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${kind === value ? 'border-accent-500 bg-accent-500/10 text-accent-300' : 'border-surface-700 text-surface-400'}`}>{value}</button>)}</div>
    <label className="block text-xs text-surface-400">Counterparty<input autoFocus className={`${inputClass} mt-1.5`} value={counterparty} maxLength={120} onChange={(event) => setCounterparty(event.target.value)} placeholder="Person or business" /></label>
    <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-surface-400">Amount in USD<input type="number" min="0.01" step="0.01" className={`${inputClass} mt-1.5`} value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="block text-xs text-surface-400">Date<input type="date" className={`${inputClass} mt-1.5`} value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-surface-400">Account<select className={`${inputClass} mt-1.5`} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select an account</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs text-surface-400">{kind === 'income' ? 'Income' : 'Expense'} category<select className={`${inputClass} mt-1.5`} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Select a category</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <label className="block text-xs text-surface-400">Notes<textarea className={`${inputClass} mt-1.5 min-h-20 resize-none`} value={notes} maxLength={360} onChange={(event) => setNotes(event.target.value)} placeholder="Visible details from the image" /></label>
    {draft.receipt && <p className="text-xs text-amber-400">Changing this itemized expense to income will save one transaction without its item list.</p>}
    <div className="flex justify-end"><button className={buttonClass} disabled={!valid || actions.busy}>Save {kind}</button></div>
  </form>
}

export default function TransactionImageAnalyzer({ snapshot, actions, onClose, onSaved }: {
  snapshot: MoneySnapshot
  actions: MoneyActions
  onClose: () => void
  onSaved: (target: 'transactions' | 'purchases') => void
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<AnalyzedTransactionDraft | null>(null)
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeCategories = snapshot.categories.filter((item) => !item.archivedAt)

  const processFile = async (file: File): Promise<void> => {
    const image = await readImage(file)
    if ('error' in image) { setError(image.error); return }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.analyzeTransactionImage({
        ...image,
        categories: activeCategories.map(({ id, name, kind: categoryKind }) => ({ id, name, kind: categoryKind }))
      })
      if (result.ok) { setDraft(result.data); setKind(result.data.kind) }
      else setError(result.message)
    } catch {
      setError('The desktop app could not start image analysis. Try again.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (draft || busy) return
    const paste = (event: ClipboardEvent): void => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'))
      if (!file) { setError('The clipboard has no supported image.'); return }
      event.preventDefault()
      void processFile(file)
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [draft, busy, snapshot])

  const reset = (): void => { setDraft(null); setError(null) }
  const body = draft
    ? <div><div className="mb-4 flex items-start justify-between gap-4"><div><h3 className="text-sm font-medium text-surface-100">Check the transaction</h3><p className="mt-1 text-xs text-surface-500">Correct anything the model misread before saving.</p></div><button className={subtleButtonClass} onClick={reset}><RotateCcw size={14} />Try another</button></div>{draft.receipt && kind === 'expense' ? <div><div className="mb-4 grid grid-cols-2 gap-2">{(['expense', 'income'] as CategoryKind[]).map((value) => <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${kind === value ? 'border-accent-500 bg-accent-500/10 text-accent-300' : 'border-surface-700 text-surface-400'}`}>{value}</button>)}</div><PurchaseForm snapshot={snapshot} actions={actions} draft={draft.receipt} initialCategoryId={draft.categoryId} onClose={() => onSaved('purchases')} /></div> : <TransactionDraftForm snapshot={snapshot} actions={actions} draft={draft} kind={kind} onKind={setKind} onSaved={onSaved} />}</div>
    : <div className="text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400"><ScanLine size={26} /></div><h3 className="mt-4 text-lg font-medium text-surface-100">Analyze a transaction</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-surface-400">Paste, drop, or choose one check, receipt, invoice, card slip, or screenshot. Ego discards the image after OpenRouter reads it.</p>{busy ? <div className="mt-7 flex items-center justify-center gap-2 text-sm text-surface-300"><LoaderCircle className="animate-spin" size={18} />Reading image...</div> : <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void processFile(file) }} className="mt-6 rounded-xl border border-dashed border-surface-700 bg-surface-950/60 p-6"><Upload className="mx-auto text-surface-500" size={22} /><p className="mt-2 text-xs text-surface-400">Drop an image here or press Ctrl+V</p><button className={`${buttonClass} mt-4`} onClick={() => inputRef.current?.click()}><FileImage size={15} />Choose image</button><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processFile(file); event.target.value = '' }} /></div>}{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<div className="mt-5 flex items-center justify-center gap-2 text-xs text-surface-500"><ClipboardPaste size={13} />The API key stays in Ego's encrypted desktop settings.</div></div>

  return <Modal title="Analyze image" onClose={onClose}>{body}</Modal>
}
