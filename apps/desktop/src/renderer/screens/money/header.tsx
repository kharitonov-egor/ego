import React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ChartNoAxesCombined, CirclePlus, PieChart, PiggyBank, ReceiptText, ScanLine } from 'lucide-react'
import { useReceiptReader } from '../../components/money/ReceiptReader'
import { ScreenHeader, TabLinks } from '../../components/screen'
import { IconButton } from '../../components/ui/button'

const MONEY_TABS = [
  { to: '/money/overview', label: 'Home', Icon: ChartNoAxesCombined },
  { to: '/money/transactions', label: 'Activity', Icon: ReceiptText },
  { to: '/money/categories', label: 'Categories', Icon: PieChart },
  { to: '/money/budget', label: 'Budget', Icon: PiggyBank }
] as const

/** The tab screens' header: the phone's bottom tabs across the top, then reading a receipt and the phone's plus. */
export function FinanceHeader(): React.ReactElement {
  const navigate = useNavigate()
  const receipts = useReceiptReader()
  return <ScreenHeader
    title="Finance"
    tabs={<TabLinks items={MONEY_TABS} />}
    right={<>
      <IconButton label="Read a receipt" disabled={!receipts.available} onClick={receipts.open}><ScanLine size={20} /></IconButton>
      <IconButton label="Add transaction" onClick={() => navigate('/money/transactions?new=true')}><CirclePlus size={22} strokeWidth={2.2} /></IconButton>
    </>}
  />
}

/** Where a pushed screen's back arrow goes: the page that opened it, or `fallback` after a reload or a notification. */
export function useBackPath(fallback: string): string {
  const { state } = useLocation()
  if (typeof state === 'object' && state !== null && 'from' in state && typeof state.from === 'string') return state.from
  return fallback
}
