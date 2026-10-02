import React from 'react'
import { NavLink, useNavigate } from 'react-router'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button, IconButton } from './ui/button'

/** One page of an app: a header row and a body that fills the rest of the window. */
export function Screen({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <div className={cn('flex h-full min-h-0 flex-col', className)}>{children}</div>
}

/**
 * The phone's navigation bar, along the top of the page: a back arrow where the phone has one,
 * the title, the app's tabs, and its header buttons on the right.
 */
export function ScreenHeader({ title, back, tabs, right }: {
  title: React.ReactNode
  /** Where the back arrow goes. */
  back?: string
  tabs?: React.ReactNode
  right?: React.ReactNode
}): React.ReactElement {
  const navigate = useNavigate()
  return <header className="flex min-h-14 shrink-0 select-none items-center gap-3 border-b border-border px-5">
    {back !== undefined && <IconButton label="Go back" onClick={() => navigate(back)} className="-ml-2">
      <ArrowLeft size={20} />
    </IconButton>}
    <h1 className="min-w-0 truncate text-[17px] font-bold">{title}</h1>
    {tabs && <div className="ml-3 flex min-w-0 items-center">{tabs}</div>}
    <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div>
  </header>
}

export interface TabLinkItem {
  to: string
  label: string
  Icon?: LucideIcon
  end?: boolean
}

/** The phone's bottom tab bar, laid out across the header. */
export function TabLinks({ items }: { items: readonly TabLinkItem[] }): React.ReactElement {
  return <nav className="flex items-center gap-1">
    {items.map((item) => <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn('flex h-9 items-center gap-2 rounded-full px-3.5 text-[14px] font-semibold transition-colors',
        isActive ? 'bg-surface-800 text-foreground' : 'text-surface-500 hover:bg-surface-900 hover:text-surface-200')}
    >
      {item.Icon && <item.Icon size={16} />}
      {item.label}
    </NavLink>)}
  </nav>
}

const WIDTHS = {
  narrow: 'max-w-2xl',
  medium: 'max-w-4xl',
  wide: 'max-w-6xl',
  full: 'max-w-none'
} as const

/** The scrolling part of a page. Phone layouts read best at a column's width, so the column stays narrow unless asked. */
export function ScreenBody({ width = 'narrow', className, children }: {
  width?: keyof typeof WIDTHS
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className={cn('mx-auto w-full px-6 py-5', WIDTHS[width], className)}>{children}</div>
  </div>
}

/** A full-page state: signed out, downloading, offline, or empty. */
export function CenteredMessage({ Icon, title, detail, action, onAction, children }: {
  Icon?: LucideIcon
  title: string
  detail?: string
  action?: string
  onAction?: () => void
  children?: React.ReactNode
}): React.ReactElement {
  return <div className="flex h-full flex-col items-center justify-center px-8 text-center">
    {Icon && <Icon color="#737373" size={34} />}
    <h2 className="mt-3 text-[20px] font-semibold">{title}</h2>
    {detail && <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>}
    {action && onAction && <Button onClick={onAction} className="mt-5">{action}</Button>}
    {children}
  </div>
}
