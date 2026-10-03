import React from 'react'
import { useNavigate } from 'react-router'
import { CalendarClock, CloudOff, GraduationCap, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useLedger } from '../../lib/ledger'
import { useStudy } from '../../lib/study/context'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

export function StudyMessage({ Icon = GraduationCap, title, detail, action, onAction }: {
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

function Waiting({ label }: { label?: string }): React.ReactElement {
  return <div className="flex flex-1 flex-col items-center justify-center">
    <Spinner />
    {label && <p className="mt-3 text-[14px] text-surface-400">{label}</p>}
  </div>
}

/** Stands in for a Study screen until there is a list to show, whether saved or fresh. */
export function StudyGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const study = useStudy()
  const navigate = useNavigate()
  const openSettings = (): void => void navigate('/settings')
  const retry = (): void => void study.refresh()
  if (!ledger.enabled) {
    return <StudyMessage
      title="Sign in to see your assignments"
      detail="Study reads your Canvas calendar through the Ego server. Sign in once with Google on Home."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
  }
  if (ledger.error) return <StudyMessage Icon={TriangleAlert} title="This computer cannot open its storage" detail={ledger.error} />
  if (!study.loaded) return <Waiting />
  if (study.fetchedAt !== null) return <>{children}</>
  const error = study.error
  if (!error || study.refreshing) return <Waiting label="Reading your Canvas calendar" />
  if (error.code === 'NOT_CONFIGURED') {
    return <StudyMessage
      Icon={CalendarClock}
      title="Connect your Canvas calendar"
      detail="In Canvas, open Calendar and copy the Calendar Feed link. Then run npx wrangler secret put CANVAS_CALENDAR_URL in apps/api and paste it."
      action="Try again"
      onAction={retry}
    />
  }
  if (error.code === 'OFFLINE') {
    return <StudyMessage
      Icon={CloudOff}
      title="Waiting for a connection"
      detail="The first download needs the internet. After that, Study opens offline."
      action="Try again"
      onAction={retry}
    />
  }
  if (error.code === 'AUTH_REQUIRED') {
    return <StudyMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={openSettings} />
  }
  return <StudyMessage Icon={TriangleAlert} title="Canvas did not load" detail={error.message} action="Try again" onAction={retry} />
}
