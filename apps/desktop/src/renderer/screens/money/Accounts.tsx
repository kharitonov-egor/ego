import React, { useState } from 'react'
import { Archive, Plus, RotateCcw } from 'lucide-react'
import type { AccountInput, AccountKind, MoneyAccount } from '@ego/core'
import {
  Chips, COLORS, ColorPicker, Empty, EntityPreview, ICON_OPTIONS, IconPicker, Label, MoneyIcon, MoneyScreen,
  PrimaryButton, money, today
} from '../../components/money/Common'
import { DateField } from '../../components/DatePicker'
import { Screen, ScreenHeader } from '../../components/screen'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { Blurred } from '../../lib/blur'
import { useMoney } from '../../lib/money'
import { CARD, CARD_PADDING, HERO_AMOUNT } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { useBackPath } from './header'

const KINDS: AccountKind[] = ['checking', 'savings', 'cash', 'credit-card', 'investment', 'crypto', 'other']
const KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', 'credit-card': 'Credit card',
  investment: 'Investment', crypto: 'Crypto', other: 'Other'
}

function AccountForm({ account, onClose }: { account?: MoneyAccount; onClose: () => void }): React.ReactElement {
  const moneyState = useMoney()
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'checking')
  const [icon, setIcon] = useState(account?.icon ?? 'Landmark')
  const [color, setColor] = useState(account?.color ?? COLORS[0])
  const [balance, setBalance] = useState(account ? String(account.openingBalanceCents / 100) : '0')
  const [date, setDate] = useState(account?.openingDate ?? today())
  const valid = Boolean(name.trim() && date && balance.trim() !== '' && Number.isFinite(Number(balance)))
  const openingCents = Number.isFinite(Number(balance)) ? Math.round(Number(balance) * 100) : 0
  const save = async (): Promise<void> => {
    const input: AccountInput = { name: name.trim(), kind, icon, color, openingBalanceCents: Math.round(Number(balance) * 100), openingDate: date }
    const saved = account ? await moneyState.updateAccount(account.id, input) : await moneyState.createAccount(input)
    if (saved) onClose()
  }
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (valid && !moneyState.busy) void save()
  }}>
    <EntityPreview shape="square" name={name} placeholder="New account" icon={icon} color={color} detail={`${KIND_LABELS[kind]} · ${money(openingCents)}`} />
    <Label text="Name" htmlFor="account-name"><input id="account-name" autoFocus={!account} value={name} onChange={(event) => setName(event.target.value)} placeholder="Chase checking" className={inputClass} /></Label>
    <Label text="Type"><Chips values={KINDS} value={kind} labels={KIND_LABELS} onChange={setKind} /></Label>
    <div className="flex gap-3">
      <div className="flex-1">
        <Label text="Opening balance" htmlFor="account-balance">
          <div className={cn(inputClass, 'flex items-center py-0 focus-within:border-surface-400')}>
            <span className="text-[16px] text-muted-foreground">$</span>
            <input id="account-balance" value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" aria-label="Opening balance in dollars" placeholder="0.00" className="ml-1 min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-foreground outline-none tabular" />
          </div>
        </Label>
      </div>
      <div className="flex-1"><Label text="Opened on"><DateField label="Opened on" value={date} onChange={setDate} /></Label></div>
    </div>
    <Label text="Icon"><IconPicker icons={ICON_OPTIONS.slice(0, 7)} value={icon} color={color} onChange={setIcon} /></Label>
    <Label text="Color"><ColorPicker value={color} onChange={setColor} /></Label>
    <PrimaryButton type="submit" label={account ? 'Save account' : 'Create account'} disabled={!valid || moneyState.busy} />
  </form>
}

export default function Accounts(): React.ReactElement {
  const moneyState = useMoney()
  const back = useBackPath('/money/overview')
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null)
  const [archived, setArchived] = useState(false)
  const [confirming, setConfirming] = useState<MoneyAccount | null>(null)
  return <Screen>
    <ScreenHeader title="Accounts" back={back} />
    <MoneyScreen>{(snapshot) => {
      const accounts = snapshot.accounts.filter((item) => Boolean(item.archivedAt) === archived)
      const active = snapshot.accounts.filter((item) => !item.archivedAt)
      const total = active.reduce((sum, item) => sum + item.balanceCents, 0)
      const confirmArchive = async (): Promise<void> => {
        if (!confirming) return
        const saved = await moneyState.archiveAccount(confirming.id, !confirming.archivedAt)
        if (saved) setConfirming(null)
      }
      return <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 pb-28 pt-5">
            <div className="overflow-hidden rounded-3xl border border-border bg-card px-5 pb-5 pt-6">
              <p className="text-[14px] font-semibold uppercase tracking-wider text-muted-foreground">Total balance</p>
              <Blurred><p className={cn('mt-1.5 truncate text-foreground tabular', HERO_AMOUNT)}>{money(total)}</p></Blurred>
              <button
                type="button"
                onClick={() => setArchived(!archived)}
                className="mt-5 flex min-h-11 items-center rounded-full bg-secondary px-4 text-[14px] font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
              >{archived ? 'Show active' : 'Show archived'}</button>
            </div>

            {accounts.length === 0
              ? <Empty title={archived ? 'No archived accounts' : 'Create your first account'} detail="Add the accounts you want to track, then record income, expenses, and transfers." />
              : <div className="mt-4 grid gap-3 md:grid-cols-2">{accounts.map((account) => <div
                key={account.id}
                className={cn(CARD, CARD_PADDING, 'relative transition-colors hover:bg-surface-900')}
              >
                <button
                  type="button"
                  aria-label={`${account.name}, ${money(account.balanceCents)}`}
                  title="Opens the account editor"
                  onClick={() => setEditing(account)}
                  className="absolute inset-0 rounded-3xl"
                />
                <div className="pointer-events-none relative flex items-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: account.color }}>
                    <MoneyIcon name={account.icon} size={20} />
                  </span>
                  <span className="ml-3 flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[16px] font-semibold text-surface-100">{account.name}</span>
                    <span className="mt-0.5 text-[14px] text-surface-400">{KIND_LABELS[account.kind]}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={account.archivedAt ? `Restore ${account.name}` : `Archive ${account.name}`}
                    title={account.archivedAt ? 'Restore' : 'Archive'}
                    onClick={() => setConfirming(account)}
                    className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-800"
                  >{account.archivedAt ? <RotateCcw color="#a3a3a3" size={17} /> : <Archive color="#a3a3a3" size={17} />}</button>
                </div>
                <Blurred><p className={cn('pointer-events-none relative mt-4 truncate text-[28px] font-bold tabular', account.balanceCents < 0 ? 'text-destructive' : 'text-surface-50')}>
                  {money(account.balanceCents)}
                </p></Blurred>
              </div>)}</div>}
          </div>
        </div>

        {!editing && !confirming && <button
          type="button"
          aria-label="Add account"
          disabled={moneyState.readOnly}
          onClick={() => setEditing('new')}
          className="absolute bottom-5 right-6 flex min-h-12 items-center rounded-2xl bg-primary px-5 text-[16px] font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        ><Plus color="#0a0a0a" size={19} className="mr-1.5" />Account</button>}

        <Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)}>{editing && <AccountForm key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet>
        <ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore account?' : 'Archive account?'} detail="Transaction history will stay intact." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={moneyState.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} />
      </>
    }}</MoneyScreen>
  </Screen>
}
