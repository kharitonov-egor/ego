import React from 'react'
import TitleBar from './components/TitleBar'
import SettingsView from './components/SettingsView'
import MoneyWorkspace, { type AppView } from './components/money/MoneyWorkspace'
import { Landmark, Tags, ReceiptText, ChartNoAxesCombined, Settings } from 'lucide-react'

export default function App(): React.ReactElement {
  const [view, setView] = React.useState<AppView>('accounts')
  const items = [
    { id: 'accounts' as const, label: 'Accounts', icon: Landmark },
    { id: 'categories' as const, label: 'Categories', icon: Tags },
    { id: 'transactions' as const, label: 'Transactions', icon: ReceiptText },
    { id: 'overview' as const, label: 'Overview', icon: ChartNoAxesCombined }
  ]
  return (
    <div className="h-screen overflow-hidden bg-surface-950 text-surface-100">
      <TitleBar />
      <div className="flex h-[calc(100vh-32px)]">
        <aside className="flex w-48 shrink-0 flex-col border-r border-surface-800 bg-surface-900/70 p-3">
          <div className="px-3 pb-4 pt-2"><div className="text-sm font-semibold text-white">Money</div><div className="mt-0.5 text-[11px] text-surface-500">Personal budget</div></div>
          <nav className="space-y-1">
            {items.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${view === item.id ? 'bg-surface-700 text-white' : 'text-surface-400 hover:bg-surface-800 hover:text-white'}`}><item.icon size={17} />{item.label}</button>)}
          </nav>
          <div className="flex-1" />
          <button onClick={() => setView('settings')} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${view === 'settings' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:bg-surface-800 hover:text-white'}`}><Settings size={17} />Settings</button>
        </aside>
        <main className="min-w-0 flex-1">
          {view === 'settings' ? <SettingsView /> : <MoneyWorkspace view={view} onNavigate={setView} />}
        </main>
      </div>
    </div>
  )
}
