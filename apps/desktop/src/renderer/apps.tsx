import {
  BookOpen, CalendarDays, CircleCheckBig, Dumbbell, GraduationCap, HeartPulse, Sheet, Smile, Sparkles, SquareKanban, UtensilsCrossed, Wallet,
  type LucideIcon
} from 'lucide-react'

export interface AppEntry {
  label: string
  Icon: LucideIcon
  /** The page the tile and the sidebar open. */
  path: string
  /** Every path under this prefix belongs to the app, so its sidebar row stays lit. */
  prefix: string
}

/** The phone's start-screen tiles, in the phone's order. */
export const APPS: readonly AppEntry[] = [
  { label: 'AI', Icon: Sparkles, path: '/ai', prefix: '/ai' },
  { label: 'Finance', Icon: Wallet, path: '/money', prefix: '/money' },
  { label: 'Gym', Icon: Dumbbell, path: '/gym', prefix: '/gym' },
  { label: 'Health', Icon: HeartPulse, path: '/health', prefix: '/health' },
  { label: 'Mood', Icon: Smile, path: '/mood', prefix: '/mood' },
  { label: 'Diary', Icon: BookOpen, path: '/diary', prefix: '/diary' },
  { label: 'Study', Icon: GraduationCap, path: '/study/assignments', prefix: '/study' },
  { label: 'Habits', Icon: CircleCheckBig, path: '/habits/home', prefix: '/habits' },
  { label: 'Tasks', Icon: SquareKanban, path: '/tasks', prefix: '/tasks' },
  { label: 'Sheets', Icon: Sheet, path: '/sheets', prefix: '/sheets' },
  { label: 'Food', Icon: UtensilsCrossed, path: '/food', prefix: '/food' },
  { label: 'Calendar', Icon: CalendarDays, path: '/calendar', prefix: '/calendar' }
]
