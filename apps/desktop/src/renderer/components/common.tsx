import React from 'react'
import {
  ArrowRight, Banknote, Bitcoin, BriefcaseBusiness, Car, Check, CircleDollarSign, CreditCard, Gift, GraduationCap,
  HandCoins, Heart, Home, Landmark, PiggyBank, Receipt, ShoppingBag, ShoppingBasket, Tag, Utensils, WalletCards,
  type LucideIcon
} from 'lucide-react'
import { cn } from '../lib/utils'

const ICONS: Record<string, LucideIcon> = {
  Landmark, PiggyBank, Banknote, CreditCard, BriefcaseBusiness, Bitcoin, WalletCards,
  Utensils, ShoppingBag, ShoppingBasket, Car, Gift, Home, GraduationCap, Heart,
  Receipt, HandCoins, CircleDollarSign, Tag, ArrowRight
}

export const ICON_OPTIONS = Object.keys(ICONS)
export const COLORS = ['#5b6ee1', '#2bb3a9', '#43a047', '#e84d8a', '#f4511e', '#ff9f43', '#42a5f5', '#8e5ac7']

export function MoneyIcon({ name, color = '#fff', size = 16 }: { name: string; color?: string; size?: number }): React.ReactElement {
  const Icon = ICONS[name] ?? Tag
  return <Icon color={color} size={size} />
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const SIGNED_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'always' })

export function money(cents: number, sign = false): string {
  return (sign ? SIGNED_USD : USD).format(cents / 100)
}

/** Stored values stay lowercase ("credit-card"); what the eye sees starts with a capital ("Credit card"). */
export function sentenceCase(value: string): string {
  const words = value.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function Label({ text, htmlFor, children }: { text: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="mb-5">
    <label htmlFor={htmlFor} className="mb-2 block text-[15px] font-medium text-surface-200">{text}</label>
    {children}
  </div>
}

export function Chips<T extends string>({ values, value, labels, onChange }: {
  values: readonly T[]
  value: T
  labels?: Partial<Record<T, string>>
  onChange: (value: T) => void
}): React.ReactElement {
  return <div className="flex flex-wrap gap-2">{values.map((item) => {
    const selected = value === item
    return <button
      key={item}
      type="button"
      aria-pressed={selected}
      onClick={() => onChange(item)}
      className={cn('min-h-11 rounded-xl border px-4 text-[15px] transition-colors',
        selected ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-input bg-surface-900 text-surface-200 hover:bg-surface-800')}
    >{labels?.[item] ?? sentenceCase(item)}</button>
  })}</div>
}

/** The selected swatch carries a check, so color is never the only sign of the choice. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }): React.ReactElement {
  return <div className="flex flex-wrap gap-3">{COLORS.map((item) => {
    const selected = value === item
    return <button
      key={item}
      type="button"
      aria-label={`Use color ${item}`}
      aria-pressed={selected}
      onClick={() => onChange(item)}
      className="flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105"
      style={{ backgroundColor: item }}
    >{selected && <Check color="#ffffff" size={20} strokeWidth={3} />}</button>
  })}</div>
}

export function Empty({ title, detail, Icon = CircleDollarSign }: { title: string; detail: string; Icon?: LucideIcon }): React.ReactElement {
  return <div className="flex flex-col items-center px-8 py-14 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></div>
    <h3 className="mt-4 text-[20px] font-semibold text-surface-100">{title}</h3>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>
  </div>
}
