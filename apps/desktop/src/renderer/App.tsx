import React from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router'
import { ChartNoAxesCombined, Landmark, PiggyBank, ReceiptText, ScanLine, Tags } from 'lucide-react'
import TitleBar from './components/TitleBar'
import TalkToAIView from './components/TalkToAIView'
import MoneyWorkspace, { type MoneyView } from './components/money/MoneyWorkspace'
import { Screen, ScreenHeader, TabLinks } from './components/screen'
import { Sidebar } from './components/Sidebar'
import { BlurProvider } from './lib/blur'
import { LedgerProvider } from './lib/ledger'
import Home from './screens/Home'
import Settings from './screens/Settings'

const MONEY_TABS = [
  { to: '/money/overview', label: 'Overview', Icon: ChartNoAxesCombined },
  { to: '/money/transactions', label: 'Transactions', Icon: ReceiptText },
  { to: '/money/accounts', label: 'Accounts', Icon: Landmark },
  { to: '/money/categories', label: 'Categories', Icon: Tags },
  { to: '/money/purchases', label: 'Purchases', Icon: ScanLine },
  { to: '/money/budget', label: 'Budget', Icon: PiggyBank }
] as const

const MONEY_VIEWS: readonly MoneyView[] = ['accounts', 'categories', 'transactions', 'purchases', 'budget', 'overview']

function isMoneyView(value: string | undefined): value is MoneyView {
  return MONEY_VIEWS.some((view) => view === value)
}

function Finance(): React.ReactElement {
  const navigate = useNavigate()
  const { view } = useParams()
  if (!isMoneyView(view)) return <Navigate to="/money/overview" replace />
  return <Screen>
    <ScreenHeader title="Finance" tabs={<TabLinks items={MONEY_TABS} />} />
    <div className="min-h-0 flex-1">
      <MoneyWorkspace view={view} onNavigate={(next) => navigate(next === 'settings' ? '/settings' : next === 'talk' ? '/ai' : `/money/${next}`)} />
    </div>
  </Screen>
}

function TalkToAI(): React.ReactElement {
  const navigate = useNavigate()
  return <TalkToAIView onOpenSettings={() => navigate('/settings')} />
}

/** Follows a notification click to the page it is about. */
function NavigationRequests(): null {
  const navigate = useNavigate()
  React.useEffect(() => window.api.onNavigate((route) => navigate(route)), [navigate])
  return null
}

export default function App(): React.ReactElement {
  return <BlurProvider>
    <LedgerProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <NavigationRequests />
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/ai" element={<TalkToAI />} />
              <Route path="/money" element={<Navigate to="/money/overview" replace />} />
              <Route path="/money/:view" element={<Finance />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </LedgerProvider>
  </BlurProvider>
}
