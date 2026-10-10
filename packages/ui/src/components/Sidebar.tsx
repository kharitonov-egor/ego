import React, { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Eye, EyeOff, House, PanelLeftClose, PanelLeftOpen, Settings, type LucideIcon } from 'lucide-react'
import { visibleApps } from '../apps'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useBlur } from '../lib/blur'
import { SecureStore } from '../lib/preferences'
import { cn } from '../lib/utils'
import { isTyping } from './money/PeriodSwipe'
import { SyncStatus } from './SyncStatus'

const STORE_KEY = 'ego.sidebar.collapsed'
const NARROW = '(max-width: 767px)'

const ROW = 'flex min-h-10 w-full items-center overflow-hidden rounded-xl pr-3 text-[15px] font-medium transition-colors'
const ICON_BUTTON = 'flex min-h-10 items-center justify-center rounded-xl text-surface-400 transition-colors hover:bg-surface-900 hover:text-foreground'

function Row({ to, label, Icon, active, collapsed }: {
  to: string
  label: string
  Icon: LucideIcon
  active: boolean
  collapsed: boolean
}): React.ReactElement {
  return <Link
    to={to}
    aria-current={active ? 'page' : undefined}
    title={collapsed ? label : undefined}
    className={cn(ROW, active ? 'bg-surface-800 text-foreground' : 'text-surface-400 hover:bg-surface-900 hover:text-foreground')}
  >
    <span className="flex w-10 shrink-0 justify-center"><Icon size={19} strokeWidth={1.9} /></span>
    <span className={cn('whitespace-nowrap', collapsed && 'sr-only')}>{label}</span>
  </Link>
}

/**
 * The saved choice holds on a wide window. A narrow one always starts collapsed, and opening it
 * there lasts until the window crosses the width again, so a small window never overwrites it.
 */
function useCollapsed(): { collapsed: boolean; toggle: () => void; animate: boolean } {
  const narrow = useMediaQuery(NARROW)
  const [saved, setSaved] = useState(false)
  const [openWhileNarrow, setOpenWhileNarrow] = useState(false)
  // Off until the first toggle, so the saved state loading at startup snaps instead of sliding.
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active && raw === '1') setSaved(true) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  useEffect(() => setOpenWhileNarrow(false), [narrow])
  const toggle = useCallback((): void => {
    setAnimate(true)
    if (narrow) {
      setOpenWhileNarrow((open) => !open)
      return
    }
    setSaved(!saved)
    void SecureStore.setItemAsync(STORE_KEY, saved ? '0' : '1').catch(() => undefined)
  }, [narrow, saved])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.repeat || event.code !== 'KeyB' || isTyping(event.target)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  return { collapsed: narrow ? !openWhileNarrow : saved, toggle, animate }
}

/** Every start-screen tile, always one click away. */
export function Sidebar(): React.ReactElement {
  const { pathname } = useLocation()
  const { blurred, setBlurred } = useBlur()
  const { collapsed, toggle, animate } = useCollapsed()
  const BlurIcon = blurred ? EyeOff : Eye
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toolButton = cn(ICON_BUTTON, collapsed ? 'w-10' : 'flex-1')
  return <aside className={cn(
    'shrink-0 select-none flex-col overflow-hidden border-r border-border px-3 pb-3 pt-3',
    collapsed ? 'w-16' : 'w-56',
    animate && 'transition-[width] duration-150 ease-out motion-reduce:transition-none',
    pathname.startsWith('/content') ? 'hidden sm:flex' : 'flex'
  )}>
    <nav aria-label="Apps" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1">
      <Row to="/" label="Home" Icon={House} active={pathname === '/'} collapsed={collapsed} />
      <div className="my-2 border-t border-border" />
      {visibleApps().map((app) => <Row
        key={app.path}
        to={app.path}
        label={app.label}
        Icon={app.Icon}
        active={pathname === app.prefix || pathname.startsWith(`${app.prefix}/`)}
        collapsed={collapsed}
      />)}
    </nav>
    <div className="mt-2 border-t border-border pt-2" />
    <div className={cn('flex gap-0.5', collapsed && 'flex-col')}>
      <SyncStatus className={toolButton} />
      <button
        type="button"
        aria-pressed={blurred}
        aria-label="Blur personal data"
        title={`${blurred ? 'Blur is on' : 'Blur personal data'} (Ctrl+Shift+B)`}
        onClick={() => setBlurred(!blurred)}
        className={cn(toolButton, blurred && 'text-foreground')}
      >
        <BlurIcon size={18} />
      </button>
      <button
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={`${collapsed ? 'Expand sidebar' : 'Collapse sidebar'} (Ctrl+B)`}
        onClick={toggle}
        className={toolButton}
      >
        <CollapseIcon size={18} />
      </button>
    </div>
    <Row to="/settings" label="Settings" Icon={Settings} active={pathname.startsWith('/settings')} collapsed={collapsed} />
  </aside>
}
