import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookOpen } from 'lucide-react'
import { courseSummaries, dueDay, shortDay, type CourseSummary } from '@ego/local/study/schedule'
import { useCourseColors } from '../../components/study/Assignment'
import { StudyGate, StudyMessage } from '../../components/study/StudyGate'
import { BlurSpan, Blurred } from '../../lib/blur'
import { useStudy } from '../../lib/study/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

/** `selected` outlines the card when it doubles as the course filter beside the assignments. */
export function CourseCard({ summary, tint, showOverdue, selected = false, onPress }: {
  summary: CourseSummary
  tint: string
  showOverdue: boolean
  selected?: boolean
  onPress: () => void
}): React.ReactElement {
  const next = summary.next
  const overdue = showOverdue && summary.overdue > 0
  return <button
    type="button"
    aria-label={`${summary.course}, ${summary.left} left${overdue ? `, ${summary.overdue} overdue` : ''}`}
    aria-pressed={selected || undefined}
    title="Shows this course's assignments"
    onClick={onPress}
    className={cn('flex w-full flex-col rounded-3xl border bg-card p-4 text-left transition-colors hover:bg-surface-900 active:bg-surface-900',
      selected ? 'border-surface-400' : 'border-border')}
  >
    <div className="flex w-full items-center">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: tint }}>
        <BookOpen color="#ffffff" size={19} />
      </div>
      <Blurred><span className="ml-3 min-w-0 flex-1 truncate text-[19px] font-bold text-surface-100">{summary.course}</span></Blurred>
      <div className="ml-2 flex flex-col items-end">
        <span className="tabular text-[22px] font-bold text-surface-50">{summary.left}</span>
        <span className="text-[14px] text-surface-400">left</span>
      </div>
    </div>
    <div className="mt-3 w-full border-t border-surface-800 pt-3">
      {next
        ? <p className="truncate text-[15px] text-surface-300">Next: <span className="font-semibold text-surface-100"><BlurSpan>{next.title}</BlurSpan></span> · {shortDay(dueDay(next))}</p>
        : <p className="text-[15px] text-surface-400">Nothing coming up</p>}
      {overdue && <p className="mt-1 text-[14px] font-semibold" style={{ color: color.expense }}>{summary.overdue} overdue</p>}
    </div>
  </button>
}

function CourseList(): React.ReactElement {
  const study = useStudy()
  const navigate = useNavigate()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const onFocus = (): void => setNow(new Date())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const tintOf = useCourseColors(study.items)
  const summaries = useMemo(() => courseSummaries(study.items, now), [now, study.items])
  if (summaries.length === 0) {
    return <StudyMessage title="No courses yet" detail="Courses appear once Canvas lists an assignment for them." />
  }
  const left = summaries.reduce((sum, summary) => sum + summary.left, 0)
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 pb-8 pt-5">
      <div className="pb-1">
        <h2 className="text-[20px] font-semibold text-surface-100">{summaries.length} {summaries.length === 1 ? 'course' : 'courses'}</h2>
        <p className="mt-0.5 text-[14px] text-surface-400">{left} assignments left this term · Click a course for its list</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {summaries.map((summary) => <CourseCard
          key={summary.course}
          summary={summary}
          tint={tintOf(summary.course)}
          showOverdue={!study.hideOverdue}
          onPress={() => navigate(`/study/assignments?${new URLSearchParams({ course: summary.course })}`)}
        />)}
      </div>
    </div>
  </div>
}

export default function Courses(): React.ReactElement {
  return <StudyGate><CourseList /></StudyGate>
}
