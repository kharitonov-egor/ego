import React, { useCallback, useMemo, useState } from 'react'
import { Circle, CircleCheck, Clock, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  courseKey, courseList, dayHeading, dueClock, dueDay, dueWithin, isDone, isOverdue, localDay, overdueCount, shortDay,
  studySections, type StudySection, type StudyView
} from '@ego/local/study/schedule'
import type { StudyItem } from '@ego/local/study/store'
import { Blurred } from '../../lib/blur'
import { useStudy } from '../../lib/study/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { AssignmentDetail, useCourseColors } from '../study/Assignment'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'

export interface UsfFilter {
  course: string | null
  view: StudyView
}

export const NO_USF_FILTER: UsfFilter = { course: null, view: 'upcoming' }

/** A card of your own joins a course when one of its labels is named after the course code. */
export function inCourse(labelNames: readonly string[], course: string): boolean {
  const key = courseKey(course)
  return labelNames.some((name) => courseKey(name) === key)
}

function updatedLabel(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return localDay(at) === localDay(new Date()) ? time : `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/** Sits in the column's header, which drags the list, so it keeps the press to itself. */
export function UsfRefresh(): React.ReactElement {
  const study = useStudy()
  return <button
    type="button"
    aria-label="Check Canvas"
    title="Check Canvas"
    disabled={study.refreshing}
    onPointerDown={stop}
    onKeyDown={stop}
    onClick={(event) => {
      event.stopPropagation()
      void study.refresh()
    }}
    className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-60"
  >
    <RefreshCw color="#ffffff" size={16} className={cn(study.refreshing && 'animate-spin motion-reduce:animate-none')} />
  </button>
}

function Pill({ label, selected, tint, onPress }: {
  label: string
  selected: boolean
  tint?: string
  onPress: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onPress}
    className={cn('flex h-7 items-center rounded-full border px-2.5 text-[12px] font-semibold transition-colors',
      selected ? 'border-white bg-white text-black' : 'border-surface-700 text-surface-300 hover:bg-surface-800')}
  >
    {tint && <span className="mr-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} />}
    <Blurred active={tint !== undefined}><span>{label}</span></Blurred>
  </button>
}

/** Course chips, Upcoming or Past, and Hide overdue, between the header and the cards. */
export function UsfControls({ filter, onChange, now }: {
  filter: UsfFilter
  onChange: (filter: UsfFilter) => void
  now: Date
}): React.ReactElement {
  const study = useStudy()
  const tintOf = useCourseColors(study.items)
  const courses = useMemo(() => courseList(study.items), [study.items])
  const overdue = overdueCount(study.items, now, filter.course)
  const thisWeek = dueWithin(study.items, now, 7)
  const waiting = study.items.filter((item) => item.pending).length
  return <div className="shrink-0 px-2 pb-1 pt-2">
    {courses.length > 0 && <div className="flex flex-wrap gap-1.5">
      <Pill label="All" selected={filter.course === null} onPress={() => onChange({ ...filter, course: null })} />
      {courses.map((course) => <Pill
        key={course}
        label={course}
        tint={tintOf(course)}
        selected={filter.course === course}
        onPress={() => onChange({ ...filter, course: filter.course === course ? null : course })}
      />)}
    </div>}
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <Pill label="Upcoming" selected={filter.view === 'upcoming'} onPress={() => onChange({ ...filter, view: 'upcoming' })} />
      <Pill label="Past" selected={filter.view === 'past'} onPress={() => onChange({ ...filter, view: 'past' })} />
      <Pill label={overdue > 0 ? `Hide overdue (${overdue})` : 'Hide overdue'} selected={study.hideOverdue} onPress={() => study.setHideOverdue(!study.hideOverdue)} />
    </div>
    {study.fetchedAt && <p aria-live="polite" className="mt-1.5 px-0.5 text-[12px] leading-4 text-surface-500">
      {thisWeek} due this week · Updated {updatedLabel(study.fetchedAt)}{study.refreshing ? ', checking Canvas' : ''}
      {waiting > 0 ? ` · ${waiting} not synced` : ''}
    </p>}
    {study.error && study.fetchedAt && <p className="mt-1 flex items-start gap-1 px-0.5 text-[12px] leading-4 text-red-300">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" />{study.error.message.replace(/\.$/, '')}. Showing the saved copy.
    </p>}
  </div>
}

function AssignmentCard({ item, tint, now, showDay, onToggle, onOpen }: {
  item: StudyItem
  tint: string
  now: Date
  showDay: boolean
  onToggle: (id: string, done: boolean) => void
  onOpen: (id: string) => void
}): React.ReactElement {
  const done = isDone(item)
  const overdue = isOverdue(item, now)
  const when = showDay ? `${shortDay(dueDay(item))}, ${dueClock(item)}` : dueClock(item)
  return <div
    role="button"
    tabIndex={0}
    aria-label={`${item.title}${item.course ? `, ${item.course}` : ''}, due ${when}${done ? ', done' : overdue ? ', overdue' : ''}`}
    onClick={() => onOpen(item.id)}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen(item.id)
    }}
    className="shrink-0 cursor-pointer select-none rounded-xl border border-surface-800 bg-card px-3 py-2.5 transition-[filter] hover:brightness-125"
  >
    {item.course && <div className="mb-1.5 flex">
      <span className="inline-flex min-w-0 max-w-full items-center rounded-full bg-surface-800 px-2 py-0.5">
        <span className="mr-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: tint }} />
        <Blurred><span className="truncate text-[12px] font-semibold text-surface-200">{item.course}</span></Blurred>
      </span>
    </div>}
    <div className="flex items-start">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onKeyDown={stop}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(item.id, !done)
        }}
        className="-ml-1 mr-1 mt-[-2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-surface-800"
      >{done ? <CircleCheck color="#0a0a0a" fill={tint} size={18} /> : <Circle color={tint} size={18} />}</button>
      <Blurred>
        <span className={cn('min-w-0 flex-1 break-words text-[15px] leading-5', done ? 'text-surface-500 line-through' : 'text-surface-100')}>{item.title}</span>
      </Blurred>
    </div>
    <div className="mt-2 flex items-center gap-1" style={{ color: overdue ? color.expense : done ? color.textFaint : color.textMuted }}>
      <Clock size={13} />
      <span className="tabular text-[12px] font-semibold">{when}</span>
      {item.pending && <CloudUpload size={13} className="ml-1" aria-label="Not synced yet" />}
    </div>
  </div>
}

function ColumnNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex shrink-0 flex-col items-center px-3 py-4 text-center text-[13px] leading-5 text-surface-400">{children}</div>
}

/** The Canvas assignments, after the column's own cards, grouped by day the way Study groups them. */
export function UsfAssignments({ filter, now }: { filter: UsfFilter; now: Date }): React.ReactElement {
  const study = useStudy()
  const tintOf = useCourseColors(study.items)
  const [openId, setOpenId] = useState<string | null>(null)
  const { hideOverdue, setDone } = study
  const sections = useMemo(
    () => studySections(study.items, filter.view, now, { course: filter.course, hideOverdue }),
    [filter.course, filter.view, hideOverdue, now, study.items])
  const toggle = useCallback((id: string, done: boolean) => void setDone(id, done), [setDone])
  const open = study.items.find((item) => item.id === openId) ?? null
  const today = localDay(now)
  const heading = (section: StudySection): string => section.day === null ? 'Overdue' : dayHeading(section.day, today)

  let body: React.ReactNode
  if (!study.loaded || (study.fetchedAt === null && (study.refreshing || !study.error))) {
    body = <ColumnNote><Spinner /><span className="mt-2">Reading your Canvas calendar</span></ColumnNote>
  } else if (study.fetchedAt === null && study.error) {
    body = <ColumnNote>
      {study.error.code === 'NOT_CONFIGURED'
        ? 'Canvas is not connected. Put the Calendar Feed link in the Worker secret CANVAS_CALENDAR_URL.'
        : study.error.code === 'OFFLINE' ? 'Canvas needs a connection for the first download.' : study.error.message}
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => void study.refresh()}>Try again</Button>
    </ColumnNote>
  } else if (sections.length === 0) {
    body = <ColumnNote>{filter.view === 'upcoming'
      ? filter.course ? `${filter.course} has nothing coming up in Canvas.` : 'Nothing due in Canvas.'
      : 'Nothing earlier.'}</ColumnNote>
  } else {
    body = sections.map((section) => <React.Fragment key={section.key}>
      <p
        className="shrink-0 px-1 pt-1 text-[13px] font-semibold"
        style={{ color: section.day === null ? color.expense : section.day === today ? color.text : color.textMuted }}
      >{heading(section)}</p>
      {section.data.map((item) => <AssignmentCard
        key={item.id}
        item={item}
        tint={tintOf(item.course)}
        now={now}
        showDay={section.day === null}
        onToggle={toggle}
        onOpen={setOpenId}
      />)}
    </React.Fragment>)
  }

  return <>
    {body}
    <Sheet visible={open !== null} title={open?.title ?? ''} onClose={() => setOpenId(null)} dismissOnBackdrop privateTitle>
      {open && <AssignmentDetail item={open} tint={tintOf(open.course)} overdue={isOverdue(open, now)} onToggle={(done) => void setDone(open.id, done)} />}
    </Sheet>
  </>
}
