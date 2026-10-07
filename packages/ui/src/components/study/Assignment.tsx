import React, { memo, useMemo } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { courseColors, courseList, dueClock, dueDay, dueSentence, isDone, shortDay } from '@ego/local/study/schedule'
import type { StudyItem } from '@ego/local/study/store'
import { Blurred } from '../../lib/blur'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { COLORS } from '../common'
import { Button } from '../ui/button'

const NO_COURSE = '#525252'

export function useCourseColors(items: StudyItem[]): (course: string | null) => string {
  const courses = useMemo(() => courseList(items), [items])
  return useMemo(() => {
    const colors = courseColors(courses, COLORS)
    return (course: string | null) => (course ? colors.get(course) : undefined) ?? NO_COURSE
  }, [courses])
}

export function DoneToggle({ done, tint, title, onToggle }: {
  done: boolean
  tint: string
  title: string
  onToggle: () => void
}): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={done}
    aria-label={title}
    title={done ? 'Marks it as not done' : 'Marks it as done'}
    onClick={onToggle}
    className="group flex h-14 w-14 shrink-0 items-center justify-center"
  >
    <span
      className="flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform group-hover:scale-110"
      style={done ? { backgroundColor: tint, borderColor: tint } : { borderColor: tint }}
    >{done && <Check color="#ffffff" size={16} strokeWidth={3} />}</span>
  </button>
}

/** Inside a day the right column is the time. In the overdue group it is the day, since that group spans several. */
export const AssignmentRow = memo(function AssignmentRow({ item, tint, overdue, showDay, onToggle, onOpen }: {
  item: StudyItem
  tint: string
  overdue: boolean
  showDay: boolean
  onToggle: (id: string, done: boolean) => void
  onOpen: (id: string) => void
}): React.ReactElement {
  const done = isDone(item)
  const when = showDay ? shortDay(dueDay(item)) : dueClock(item)
  return <div className="flex min-h-[72px] items-center border-t border-surface-800 bg-card transition-colors hover:bg-surface-900">
    <DoneToggle done={done} tint={tint} title={item.title} onToggle={() => onToggle(item.id, !done)} />
    <button
      type="button"
      aria-label={`${item.title}${item.course ? `, ${item.course}` : ''}, ${dueSentence(item)}${done ? ', done' : overdue ? ', overdue' : ''}`}
      title="Opens the details"
      onClick={() => onOpen(item.id)}
      className="flex min-h-[72px] min-w-0 flex-1 items-center py-1.5 pr-4 text-left"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <Blurred><span className={cn('line-clamp-2 text-[17px] font-semibold', done ? 'text-surface-500 line-through' : 'text-surface-100')}>{item.title}</span></Blurred>
        {item.course && <span className="mt-0.5 flex items-center">
          <span className="mr-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
          <Blurred><span className="truncate text-[14px] text-surface-400">{item.course}</span></Blurred>
        </span>}
      </span>
      <span
        className="tabular ml-3 shrink-0 text-[15px] font-semibold"
        style={{ color: overdue ? color.expense : done ? color.textFaint : color.textSecondary }}
      >{when}</span>
    </button>
  </div>
})

export function AssignmentDetail({ item, tint, overdue, onToggle }: {
  item: StudyItem
  tint: string
  overdue: boolean
  onToggle: (done: boolean) => void
}): React.ReactElement {
  const done = isDone(item)
  return <div>
    <div className="flex flex-wrap items-center gap-2">
      {item.course && <span className="flex items-center rounded-full bg-surface-900 px-3 py-1.5">
        <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />
        <Blurred><span className="text-[14px] font-semibold text-surface-200">{item.course}</span></Blurred>
      </span>}
      {overdue && <span className="rounded-full bg-red-500/15 px-3 py-1.5 text-[14px] font-semibold text-red-300">Overdue</span>}
      {done && <span className="rounded-full bg-positive/15 px-3 py-1.5 text-[14px] font-semibold text-positive">Done</span>}
    </div>
    <p className="tabular mt-3 text-[17px] font-semibold text-surface-100">{dueSentence(item)}</p>
    {item.pending && <p className="mt-1 text-[14px] text-surface-400">Saved on this computer. The server gets it on the next sync.</p>}
    {item.description.length > 0 && <Blurred><p className="mt-4 select-text whitespace-pre-wrap break-words text-[16px] leading-6 text-surface-300">{item.description}</p></Blurred>}
    <Button size="lg" onClick={() => onToggle(!done)} className="mt-6 w-full">{done ? 'Mark as not done' : 'Mark as done'}</Button>
    {item.url && <Button variant="outline" size="lg" onClick={() => void window.api.openExternalUrl(item.url ?? '')} className="mt-3 w-full">
      <ExternalLink color="#fafafa" size={18} />
      Open in Canvas
    </Button>}
  </div>
}
