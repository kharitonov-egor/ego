import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarCheck, TriangleAlert } from 'lucide-react'
import {
  courseList, courseSummaries, dayHeading, dueWithin, isDone, isOverdue, localDay, overdueCount, studySections,
  type StudySection, type StudyView
} from '@ego/local/study/schedule'
import type { StudyItem } from '@ego/local/study/store'
import { AssignmentDetail, AssignmentRow, useCourseColors } from '../../components/study/Assignment'
import { StudyGate } from '../../components/study/StudyGate'
import { Checkbox } from '../../components/ui/checkbox'
import { Sheet } from '../../components/ui/dialog'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Blurred } from '../../lib/blur'
import { useStudy } from '../../lib/study/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { CourseCard } from './Courses'

const VIEW_OPTIONS = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }] as const

function updatedLabel(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return localDay(at) === localDay(new Date()) ? time : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function CourseChip({ label, tint, selected, personal = false, onPress }: {
  label: string
  tint?: string
  selected: boolean
  personal?: boolean
  onPress: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onPress}
    className={cn('flex min-h-10 items-center rounded-full border px-3.5 transition-colors',
      selected ? 'border-primary bg-primary' : 'border-surface-700 bg-surface-900 hover:bg-surface-800 active:bg-surface-800')}
  >
    {tint && <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />}
    <Blurred active={personal}>
      <span className={cn('text-[14px] font-semibold', selected ? 'text-primary-foreground' : 'text-surface-300')}>{label}</span>
    </Blurred>
  </button>
}

/**
 * The phone's list in a column. A wide window adds the course cards beside it, which filter the
 * list the way the chips do.
 */
function AssignmentList(): React.ReactElement {
  const study = useStudy()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<StudyView>('upcoming')
  const [course, setCourse] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const requested = params.get('course')

  useEffect(() => {
    const onFocus = (): void => setNow(new Date())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => setNow(new Date()), [study.items])

  useEffect(() => {
    if (!requested) return
    setCourse(requested)
    setView('upcoming')
    setParams({}, { replace: true })
  }, [requested, setParams])

  const tintOf = useCourseColors(study.items)
  const courses = useMemo(() => courseList(study.items), [study.items])
  const summaries = useMemo(() => courseSummaries(study.items, now), [now, study.items])
  const { hideOverdue, setHideOverdue } = study
  const sections = useMemo(
    () => studySections(study.items, view, now, { course, hideOverdue }),
    [course, hideOverdue, now, study.items, view])
  const overdue = overdueCount(study.items, now, course)
  const today = localDay(now)
  const thisWeek = dueWithin(study.items, now, 7)
  const waiting = study.items.filter((item) => item.pending).length
  const open = study.items.find((item) => item.id === openId) ?? null
  const setDone = study.setDone
  const toggle = useCallback((id: string, done: boolean) => void setDone(id, done), [setDone])
  const pickCourse = (code: string): void => setCourse(course === code ? null : code)

  const heading = (section: StudySection): string => section.day === null ? 'Overdue' : dayHeading(section.day, today)
  const leftIn = (data: StudyItem[]): string => {
    const left = data.filter((item) => !isDone(item)).length
    return left === 0 ? 'All done' : `${left} left`
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    {study.error && <div className="flex min-h-11 items-start gap-2 bg-red-500/10 px-6 py-2">
      <TriangleAlert color="#fca5a5" size={15} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-[14px] leading-5 text-red-300">{study.error.message.replace(/\.$/, '')}. Showing the copy from {study.fetchedAt ? updatedLabel(study.fetchedAt) : 'earlier'}.</p>
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-6">
        <div className="min-w-0 max-w-2xl flex-1 pb-8">
          <div className="sticky top-0 z-10 bg-background pb-1 pt-4">
            <SegmentedControl options={VIEW_OPTIONS} value={view} onValueChange={setView} />
            {courses.length > 1 && <div className="flex flex-wrap gap-2 pt-2.5">
              <CourseChip label="All" selected={course === null} onPress={() => setCourse(null)} />
              {courses.map((code) => <CourseChip key={code} label={code} tint={tintOf(code)} selected={course === code} personal onPress={() => pickCourse(code)} />)}
            </div>}
            <div className="flex pt-1">
              <Checkbox
                checked={hideOverdue}
                onCheckedChange={setHideOverdue}
                label={overdue > 0 ? `Hide overdue (${overdue})` : 'Hide overdue'}
              />
            </div>
          </div>
          {study.fetchedAt && <p aria-live="polite" className="pt-3 text-[14px] text-surface-500">
            {view === 'upcoming' ? `${thisWeek} due in the next 7 days · ` : ''}Updated {updatedLabel(study.fetchedAt)}{study.refreshing ? ', checking Canvas' : ''}
            {waiting > 0 ? ` · ${waiting} ${waiting === 1 ? 'check mark' : 'check marks'} not synced` : ''}
          </p>}
          {sections.length === 0
            ? <div className="flex flex-col items-center px-8 py-14 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><CalendarCheck color="#a3a3a3" size={30} /></div>
              <h2 className="mt-4 text-[20px] font-semibold text-surface-100">{view === 'upcoming' ? 'Nothing due' : 'Nothing earlier'}</h2>
              <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{view === 'upcoming'
                ? course ? `${course} has nothing coming up in Canvas.` : 'Canvas has no upcoming assignments. Refresh to check again.'
                : hideOverdue ? 'Unchecked past assignments are hidden. Clear Hide overdue to see them.' : 'Assignments show up here once their day has passed.'}</p>
            </div>
            : sections.map((section) => <section key={section.key}>
              <div className="flex items-end justify-between pb-2 pt-5">
                <h2
                  className="text-[14px] font-semibold uppercase tracking-wider"
                  style={{ color: section.day === null ? color.expense : section.day === today ? color.text : color.textMuted }}
                >{heading(section)}</h2>
                <span className="text-[14px] font-semibold text-surface-500">{leftIn(section.data)}</span>
              </div>
              <div className="overflow-hidden rounded-2xl border-x border-b border-surface-800">
                {section.data.map((item) => <AssignmentRow
                  key={item.id}
                  item={item}
                  tint={tintOf(item.course)}
                  overdue={isOverdue(item, now)}
                  showDay={section.day === null}
                  onToggle={toggle}
                  onOpen={setOpenId}
                />)}
              </div>
            </section>)}
        </div>
        {summaries.length > 0 && <aside aria-label="Courses" className="hidden w-80 shrink-0 flex-col gap-3 pb-8 pt-4 xl:flex">
          <h2 className="pt-1 text-[14px] font-semibold uppercase tracking-wider text-surface-400">Courses</h2>
          {summaries.map((summary) => <CourseCard
            key={summary.course}
            summary={summary}
            tint={tintOf(summary.course)}
            showOverdue={!hideOverdue}
            selected={course === summary.course}
            onPress={() => {
              pickCourse(summary.course)
              setView('upcoming')
            }}
          />)}
        </aside>}
      </div>
    </div>
    <Sheet visible={open !== null} title={open?.title ?? ''} onClose={() => setOpenId(null)} dismissOnBackdrop privateTitle>
      {open && <AssignmentDetail item={open} tint={tintOf(open.course)} overdue={isOverdue(open, now)} onToggle={(done) => void setDone(open.id, done)} />}
    </Sheet>
  </div>
}

export default function Assignments(): React.ReactElement {
  return <StudyGate><AssignmentList /></StudyGate>
}
