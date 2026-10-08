import React from 'react'
import { Link, useLocation } from 'react-router'
import { Eye, EyeOff, House, Settings, type LucideIcon } from 'lucide-react'
import { visibleApps } from '../apps'
import { useBlur } from '../lib/blur'
import { cn } from '../lib/utils'
import { SyncStatus } from './SyncStatus'

const ROW = 'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors'

function Row({ to, label, Icon, active }: { to: string; label: string; Icon: LucideIcon; active: boolean }): React.ReactElement {
  return <Link
    to={to}
    aria-current={active ? 'page' : undefined}
    className={cn(ROW, active ? 'bg-surface-800 text-foreground' : 'text-surface-400 hover:bg-surface-900 hover:text-foreground')}
  >
    <Icon size={19} strokeWidth={1.9} />
    {label}
  </Link>
}

/** Every start-screen tile, always one click away. */
export function Sidebar(): React.ReactElement {
  const { pathname } = useLocation()
  const { blurred, setBlurred } = useBlur()
  const BlurIcon = blurred ? EyeOff : Eye
  return <aside className={cn("w-56 shrink-0 select-none flex-col border-r border-border px-3 pb-3 pt-3", pathname.startsWith('/content') ? 'hidden sm:flex' : 'flex')}>
    <nav aria-label="Apps" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
      <Row to="/" label="Home" Icon={House} active={pathname === '/'} />
      <div className="my-2 border-t border-border" />
      {visibleApps().map((app) => <Row
        key={app.path}
        to={app.path}
        label={app.label}
        Icon={app.Icon}
        active={pathname === app.prefix || pathname.startsWith(`${app.prefix}/`)}
      />)}
    </nav>
    <div className="mt-2 border-t border-border pt-2" />
    <SyncStatus />
    <button
      type="button"
      aria-pressed={blurred}
      title="Ctrl+Shift+B"
      onClick={() => setBlurred(!blurred)}
      className={cn(ROW, 'text-[14px]', blurred ? 'text-foreground hover:bg-surface-900' : 'text-surface-400 hover:bg-surface-900 hover:text-foreground')}
    >
      <BlurIcon size={18} />
      {blurred ? 'Blur is on' : 'Blur personal data'}
    </button>
    <Row to="/settings" label="Settings" Icon={Settings} active={pathname.startsWith('/settings')} />
  </aside>
}
