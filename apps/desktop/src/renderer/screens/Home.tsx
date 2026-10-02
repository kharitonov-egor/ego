import React from 'react'
import { useNavigate } from 'react-router'
import appIcon from '../app-icon.png'
import { APPS, type AppEntry } from '../apps'
import { SignInPanel } from '../components/SignInPanel'
import { Spinner } from '../components/ui/spinner'
import { useLedger } from '../lib/ledger'
import { cn } from '../lib/utils'

function AppTile({ app, onOpen }: { app: AppEntry; onOpen: () => void }): React.ReactElement {
  return <button
    type="button"
    onClick={onOpen}
    className="flex h-32 flex-col items-center justify-center rounded-3xl border-2 border-white bg-black px-2 transition-colors hover:bg-white/10 active:bg-white/15"
  >
    <app.Icon color="#ffffff" size={30} strokeWidth={1.75} />
    <span className="mt-2 truncate text-[18px] font-semibold text-white">{app.label}</span>
  </button>
}

function Heading({ size }: { size: 'large' | 'small' }): React.ReactElement {
  const large = size === 'large'
  return <div className="flex flex-col items-center">
    <img src={appIcon} alt="" className={large ? 'h-20 w-20 rounded-3xl' : 'h-14 w-14 rounded-2xl'} />
    <h1 className={cn('font-bold tracking-tight text-white', large ? 'mt-3 text-[34px]' : 'mt-2 text-[28px]')}>Ego</h1>
  </div>
}

/** The phone's start screen, and the only place that asks for sign-in. */
export default function Home(): React.ReactElement {
  const navigate = useNavigate()
  const ledger = useLedger()
  if (!ledger.loaded || !ledger.enabled) {
    return <div className="h-full overflow-y-auto px-6 pb-10 pt-14">
      <div className="mx-auto max-w-md">
        <Heading size="large" />
        {!ledger.loaded
          ? <div className="mt-10 flex justify-center"><Spinner /></div>
          : <section className="mt-10 rounded-3xl border border-border bg-card p-5">
            <h2 className="text-[20px] font-semibold text-white">Sign in</h2>
            <div className="mt-2"><SignInPanel /></div>
          </section>}
      </div>
    </div>
  }
  return <div className="h-full overflow-y-auto px-6 pb-10 pt-10">
    <div className="mx-auto max-w-3xl">
      <Heading size="small" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {APPS.map((app) => <AppTile key={app.path} app={app} onOpen={() => navigate(app.path)} />)}
      </div>
    </div>
  </div>
}
