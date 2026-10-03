import React from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import TitleBar from './components/TitleBar'
import TalkToAIView from './components/TalkToAIView'
import { Sidebar } from './components/Sidebar'
import { BlurProvider } from './lib/blur'
import { LedgerProvider } from './lib/ledger'
import { MoneyProvider } from './lib/money'
import { PeriodProvider } from './lib/period'
import { ReminderProvider } from './lib/reminder'
import Home from './screens/Home'
import Settings from './screens/Settings'
import { moneyRoutes } from './screens/money/Finance'

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
      <MoneyProvider>
        <PeriodProvider>
          <ReminderProvider>
            <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
              <NavigationRequests />
              <TitleBar />
              <div className="flex min-h-0 flex-1">
                <Sidebar />
                <main className="min-w-0 flex-1 overflow-hidden">
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/ai" element={<TalkToAI />} />
                    {moneyRoutes}
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </div>
          </ReminderProvider>
        </PeriodProvider>
      </MoneyProvider>
    </LedgerProvider>
  </BlurProvider>
}
