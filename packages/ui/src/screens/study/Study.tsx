import React from 'react'
import { Outlet } from 'react-router'
import { GraduationCap, ListChecks, RefreshCw } from 'lucide-react'
import { Screen, ScreenHeader, TabLinks } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { StudyProvider, useStudy } from '../../lib/study/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const STUDY_TABS = [
  { to: '/study/assignments', label: 'Assignments', Icon: ListChecks },
  { to: '/study/courses', label: 'Courses', Icon: GraduationCap }
] as const

/** The refresh button stands in for the phone's pull-down on the assignment list. */
function StudyScreen(): React.ReactElement {
  const study = useStudy()
  return <Screen>
    <ScreenHeader
      title="Study"
      tabs={<TabLinks items={STUDY_TABS} />}
      right={<IconButton label="Refresh" disabled={study.refreshing} onClick={() => void study.refresh()}>
        <RefreshCw color={color.textSecondary} size={19} className={cn(study.refreshing && 'animate-spin motion-reduce:animate-none')} />
      </IconButton>}
    />
    <Outlet />
  </Screen>
}

/** The phone's Study tabs, with one provider for both. */
export default function Study(): React.ReactElement {
  return <StudyProvider><StudyScreen /></StudyProvider>
}
