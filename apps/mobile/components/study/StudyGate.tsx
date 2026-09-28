import React from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CalendarClock, CloudOff, GraduationCap, TriangleAlert, type LucideIcon } from 'lucide-react-native'
import { useLedger } from '../../lib/ledger-context'
import { useStudy } from '../../lib/study/context'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

export function StudyMessage({ Icon = GraduationCap, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></View>
    <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><UiText>{action}</UiText></Button>}
  </View>
}

function Waiting({ label }: { label?: string }): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950">
    <ActivityIndicator color="#fafafa" />
    {label && <Text className="mt-3 text-[14px] text-surface-400">{label}</Text>}
  </View>
}

/** Stands in for a Study screen until there is a list to show, whether saved or fresh. */
export function StudyGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const study = useStudy()
  const router = useRouter()
  const openSettings = (): void => router.push('/settings')
  const retry = (): void => void study.refresh()
  if (!ledger.enabled) {
    return <StudyMessage
      title="Sign in to see your assignments"
      detail="Study reads your Canvas calendar through the Ego server. Sign in once with Google on the start screen."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <StudyMessage Icon={TriangleAlert} title="This phone cannot open its storage" detail={ledger.error} />
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
