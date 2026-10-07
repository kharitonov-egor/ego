import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Copy, FileText, Globe, KeyRound, Lock, type LucideIcon } from 'lucide-react'
import { Screen, ScreenHeader, TabLinks } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'

const DOCKET_TABS = [
  { to: '/dockets', label: 'My dockets', Icon: FileText, end: true },
  { to: '/dockets/cli', label: 'CLI setup', Icon: KeyRound }
] as const

export function DocketHeader({ right }: { right?: React.ReactNode }): React.ReactElement {
  return <ScreenHeader title="Docket" tabs={<TabLinks items={DOCKET_TABS} />} right={right} />
}

export function DocketMessage({ Icon = FileText, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">{title}</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>
    {action && onAction && <Button onClick={onAction} className="mt-5">{action}</Button>}
  </div>
}

export function DocketWaiting(): React.ReactElement {
  return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
}

/** Stands in for a Docket screen until this device is signed in. */
export function DocketGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  if (!ledger.loaded || !ledger.enabled) {
    return <Screen>
      <DocketHeader />
      {ledger.loaded
        ? <DocketMessage
          title="Sign in to see your dockets"
          detail="Dockets belong to your Ego account. Sign in on the start screen first."
          action="Go to the start screen"
          onAction={() => navigate('/')}
        />
        : <DocketWaiting />}
    </Screen>
  }
  return <>{children}</>
}

export function VisibilityBadge({ visible }: { visible: boolean }): React.ReactElement {
  const Icon = visible ? Globe : Lock
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold',
    visible ? 'bg-white text-black' : 'bg-surface-800 text-surface-300')}>
    <Icon size={13} />
    {visible ? 'Public' : 'Private'}
  </span>
}

/** Copies `text` and says so for two seconds. */
export function CopyButton({ text, label = 'Copy', size = 'sm' }: {
  text: string
  label?: string
  size?: 'sm' | 'default'
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return <Button
    variant="outline"
    size={size}
    onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
  >
    {copied ? <Check size={15} /> : <Copy size={15} />}
    {copied ? 'Copied' : label}
  </Button>
}
