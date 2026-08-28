import React from 'react'
import {
  ArrowRight, Banknote, Bitcoin, BriefcaseBusiness, Car, CircleDollarSign, CreditCard, Gift,
  GraduationCap, HandCoins, Heart, Home, Landmark, PiggyBank, Receipt, ShoppingBag,
  ShoppingBasket, Tag, Utensils, WalletCards, type LucideIcon
} from 'lucide-react'
import type { DateRange, MoneySnapshot, MoneyTransaction, PeriodPreset } from '../../shared/types'

export const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLOR_OPTIONS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']

export function MoneyIcon({ name, size = 20 }: { name: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon size={size} />
}

export function formatMoney(cents: number, sign = false): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', signDisplay: sign ? 'always' : 'auto'
  }).format(cents / 100)
}

export function todayString(): string {
  const date = new Date()
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function isoDate(date: Date): string {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

export function rangeForPreset(preset: PeriodPreset, custom: DateRange): DateRange {
  if (preset === 'all') return { from: null, to: null }
  if (preset === 'custom') return custom
  const now = localDate(todayString())
  const from = new Date(now)
  if (preset === 'week') from.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  if (preset === 'month') from.setDate(1)
  if (preset === 'year') from.setMonth(0, 1)
  return { from: isoDate(from), to: isoDate(now) }
}

export function filterTransactions(
  transactions: MoneyTransaction[], preset: PeriodPreset, custom: DateRange
): MoneyTransaction[] {
  const range = rangeForPreset(preset, custom)
  return transactions.filter((transaction) =>
    (!range.from || transaction.date >= range.from) && (!range.to || transaction.date <= range.to)
  )
}

export function transactionDelta(transaction: MoneyTransaction, accountId: string): number {
  if (transaction.kind === 'income' && transaction.accountId === accountId) return transaction.amountCents
  if (transaction.kind === 'expense' && transaction.accountId === accountId) return -transaction.amountCents
  if (transaction.kind === 'transfer') {
    if (transaction.accountId === accountId) return -transaction.amountCents
    if (transaction.destinationAccountId === accountId) return transaction.amountCents
  }
  return 0
}

export function totalBalanceAt(snapshot: MoneySnapshot, through: string | null, exclusive = false): number {
  return snapshot.accounts.reduce((total, account) => {
    if (through && account.openingDate > through) return total
    const balance = snapshot.transactions.reduce((sum, transaction) => {
      if (through && (exclusive ? transaction.date >= through : transaction.date > through)) return sum
      return sum + transactionDelta(transaction, account.id)
    }, account.openingBalanceCents)
    return total + balance
  }, 0)
}

export function displayDate(value: string): string {
  return localDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
