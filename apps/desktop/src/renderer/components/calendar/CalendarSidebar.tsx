import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, MoreVertical, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import type { CalendarAccount, CalendarInfo } from '@ego/api-contracts'
import { CALENDAR_COLORS } from '@ego/core'
import { monthWeeks, weekdayShort } from '@ego/local/calendar/layout'
import { parseIso, shiftMonth, timeAgo } from '@ego/local/dates'
import { cn } from '../../lib/utils'
import { Button, IconButton } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { PopupMenu, anchorBelow, type MenuAnchor, type MenuItem } from '../ui/menu'
import { Switch } from '../ui/switch'

function MiniMonth({ anchor, today, selected, onPick }: {
  anchor: string
  today: string
  selected: readonly string[]
  onPick: (day: string) => void
}): React.ReactElement {
  const [month, setMonth] = useState(anchor.slice(0, 7))
  const shown = `${month}-01`
  React.useEffect(() => setMonth(anchor.slice(0, 7)), [anchor])
  const weeks = monthWeeks(shown)
  return <div className="select-none">
    <div className="flex items-center justify-between px-1">
      <span className="text-[14px] font-semibold">{parseIso(shown).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
      <div className="flex">
        <IconButton label="Previous month" className="h-7 w-7" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></IconButton>
        <IconButton label="Next month" className="h-7 w-7" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></IconButton>
      </div>
    </div>
    <div className="mt-1 grid grid-cols-7 text-center">
      {weeks[0].map((day) => <span key={day} className="py-1 text-[11px] font-semibold text-surface-500">{weekdayShort(day).charAt(0)}</span>)}
      {weeks.flat().map((day) => <button
        key={day}
        type="button"
        onClick={() => onPick(day)}
        className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[12px]',
          day === today ? 'bg-white font-semibold text-black'
            : selected.includes(day) ? 'bg-surface-700 text-foreground'
              : day.slice(0, 7) === month ? 'text-surface-200 hover:bg-surface-800' : 'text-surface-600 hover:bg-surface-800')}
      >{parseIso(day).getDate()}</button>)}
    </div>
  </div>
}

/** Google Calendar's left column: a month to jump around, then each account's calendars to tick. */
export function CalendarSidebar({ anchor, today, days, accounts, calendars, overlay, refreshing, fetchedAt, connecting, onPick, onCreate, onToggle, onColor, onOverlay, onRefresh, onConnect, onDisconnect }: {
  anchor: string
  today: string
  days: readonly string[]
  accounts: readonly CalendarAccount[]
  calendars: readonly CalendarInfo[]
  overlay: boolean
  refreshing: boolean
  fetchedAt: string | null
  connecting: boolean
  onPick: (day: string) => void
  onCreate: () => void
  onToggle: (calendar: CalendarInfo, selected: boolean) => void
  onColor: (calendar: CalendarInfo, colorId: string) => void
  onOverlay: (on: boolean) => void
  onRefresh: () => void
  onConnect: (another: boolean) => void
  onDisconnect: (account: CalendarAccount) => void
}): React.ReactElement {
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; title: string; items: MenuItem[] } | null>(null)

  return <nav aria-label="Calendars" className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border px-4 py-4">
    <Button onClick={onCreate} className="self-start"><Plus size={18} />Create</Button>
    <MiniMonth anchor={anchor} today={today} selected={days} onPick={onPick} />

    {accounts.map((account) => {
      const own = calendars.filter((calendar) => calendar.accountId === account.id)
        .sort((left, right) => Number(right.primary) - Number(left.primary) || left.name.localeCompare(right.name))
      return <section key={account.id}>
        <div className="flex items-center gap-1">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-surface-400" title={account.id}>{account.id}</h3>
          <IconButton label={`${account.id} options`} className="h-7 w-7" onClick={(click) => setMenu({
            anchor: anchorBelow(click.currentTarget),
            title: account.id,
            items: [{ label: account.connected ? 'Disconnect' : 'Remove', destructive: true, onPress: () => onDisconnect(account) }]
          })}><MoreVertical size={15} /></IconButton>
        </div>
        {!account.connected && <button type="button" onClick={() => onConnect(true)} className="mt-1 flex items-start gap-2 rounded-xl bg-surface-900 px-3 py-2 text-left text-[13px] text-attention">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />Access ended. Connect this account again.
        </button>}
        {account.connected && account.lastError && <p className="mt-1 text-[12px] leading-4 text-surface-500">{account.lastError}</p>}
        <div className="mt-1 flex flex-col">
          {own.map((calendar) => <div key={calendar.key} className="group flex items-center">
            <Checkbox
              className="min-w-0 flex-1"
              checked={calendar.selected}
              color={calendar.color}
              label={calendar.name}
              onCheckedChange={(on) => onToggle(calendar, on)}
            />
            <IconButton label={`${calendar.name} color`} className="h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={(click) => setMenu({
              anchor: anchorBelow(click.currentTarget),
              title: calendar.name,
              items: Object.entries(CALENDAR_COLORS).map(([id, named]) => ({
                label: `${named.name}${calendar.colorId === id ? ' ✓' : ''}`, swatch: named.hex, onPress: () => onColor(calendar, id)
              }))
            })}><MoreVertical size={15} /></IconButton>
          </div>)}
        </div>
      </section>
    })}

    <Button variant="outline" size="sm" className="self-start" disabled={connecting} onClick={() => onConnect(accounts.length > 0)}>
      <Plus size={15} />{accounts.length > 0 ? 'Add a Google account' : 'Connect Google Calendar'}
    </Button>

    <label className="flex items-center gap-3">
      <Switch label="Show Tasks, Study, and Gym" checked={overlay} onCheckedChange={onOverlay} />
      <span className="text-[14px] text-surface-200">Show Tasks, Study, and Gym</span>
    </label>

    <button type="button" onClick={onRefresh} className="mt-auto flex items-center gap-2 text-[12px] text-surface-500 hover:text-surface-300">
      <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
      {refreshing ? 'Syncing with Google...' : fetchedAt ? `Synced ${timeAgo(fetchedAt, new Date())}` : 'Not synced yet'}
    </button>

    <PopupMenu anchor={menu?.anchor ?? null} title={menu?.title} items={menu?.items ?? []} onClose={() => setMenu(null)} />
  </nav>
}
