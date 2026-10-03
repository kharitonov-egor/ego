import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { CalendarClock, SquareKanban } from 'lucide-react'
import type { TabLinkItem } from '../../components/screen'

/** The phone's two Tasks tabs, drawn in the header. */
export const TASKS_TABS: readonly TabLinkItem[] = [
  { to: '/tasks', label: 'Boards', Icon: SquareKanban, end: true },
  { to: '/tasks/upcoming', label: 'Upcoming', Icon: CalendarClock }
]

export const boardPath = (id: string): string => `/tasks/board/${encodeURIComponent(id)}`
export const cardPath = (id: string): string => `/tasks/card/${encodeURIComponent(id)}`
export const activityPath = (id: string): string => `/tasks/activity/${encodeURIComponent(id)}`
export const archivePath = (id: string): string => `/tasks/archive/${encodeURIComponent(id)}`

function backFrom(state: unknown): string | null {
  return typeof state === 'object' && state !== null && 'back' in state && typeof state.back === 'string' ? state.back : null
}

/** Where this page's back arrow goes: the page that opened it, or `fallback` after a notification click. */
export function useBack(fallback: string): string {
  return backFrom(useLocation().state) ?? fallback
}

/**
 * Opens a card so its back arrow returns here, the way the phone's stack pops back. A card that
 * replaces this page, like a fresh copy, takes over this page's own back arrow instead.
 */
export function useOpenCard(): (cardId: string, replacing?: { back: string }) => void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback((cardId, replacing) => {
    void navigate(cardPath(cardId), { state: { back: replacing?.back ?? pathname }, replace: replacing !== undefined })
  }, [navigate, pathname])
}
