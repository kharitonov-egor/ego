import React, { useMemo } from 'react'
import { CalendarCheck, Circle, CircleCheck } from 'lucide-react'
import type { TaskCardRecord } from '@ego/api-contracts'
import { UPCOMING_TITLES, dueBadge, upcomingSections } from '@ego/local/tasks/board'
import { Screen, ScreenBody, ScreenHeader, TabLinks } from '../../components/screen'
import { DueChip, PriorityIcon, TasksError, TasksGate, TasksMessage } from '../../components/tasks/ui'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { cn } from '../../lib/utils'
import { TASKS_TABS, useOpenCard } from './nav'

function Row({ card }: { card: TaskCardRecord }): React.ReactElement {
  const tasks = useTasks()
  const openCard = useOpenCard()
  const board = tasks.data?.boards.find((item) => item.id === card.boardId)
  const list = tasks.data?.lists.find((item) => item.id === card.listId)
  const due = dueBadge(card, tasks.now)
  const done = card.doneAt !== null
  return <div
    role="button"
    tabIndex={0}
    onClick={() => openCard(card.id)}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openCard(card.id)
    }}
    className="flex min-h-[68px] cursor-pointer items-center border-t border-surface-800 bg-card py-2 pr-4 transition-colors hover:bg-surface-900 active:bg-surface-900"
  >
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      onClick={(event) => {
        event.stopPropagation()
        void tasks.updateCard(card.id, (input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full hover:bg-surface-800"
    >{done ? <CircleCheck color="#0a0a0a" fill="#fafafa" size={22} /> : <Circle color="#525252" size={22} />}</button>
    <div className="min-w-0 flex-1">
      <Blurred><p className={cn('line-clamp-2 text-[16px] font-semibold', done ? 'text-surface-500' : 'text-surface-100')}>{card.title}</p></Blurred>
      <Blurred><p className="mt-0.5 truncate text-[13px] text-surface-400">{[board?.icon, board?.name].filter(Boolean).join(' ')}{list ? ` · ${list.name}` : ''}</p></Blurred>
    </div>
    <div className="ml-3 flex flex-col items-end gap-1.5">
      {due && <DueChip due={due} />}
      <PriorityIcon priority={card.priority} />
    </div>
  </div>
}

function Upcoming(): React.ReactElement {
  const tasks = useTasks()
  const sections = useMemo(() => tasks.data ? upcomingSections(tasks.data, tasks.now) : [], [tasks.data, tasks.now])
  return <Screen>
    <ScreenHeader title="Upcoming" tabs={<TabLinks items={TASKS_TABS} />} />
    {sections.length === 0
      ? <div className="min-h-0 flex-1">
        <TasksMessage Icon={CalendarCheck} title="Nothing due" detail="Cards with a due date show here from every board, soonest first, until they are done." />
      </div>
      : <ScreenBody className="pb-8 pt-1">
        <TasksError className="mt-4" />
        {sections.map((section) => <section key={section.key}>
          <div className="flex items-baseline px-4 pb-2 pt-5">
            <h2 className={cn('flex-1 text-[15px] font-semibold uppercase tracking-wide', section.key === 'overdue' ? 'text-red-400' : 'text-surface-400')}>{UPCOMING_TITLES[section.key]}</h2>
            <span className="tabular text-[14px] text-surface-500">{section.data.length}</span>
          </div>
          <div className="overflow-hidden rounded-2xl border-b border-surface-800">
            {section.data.map((card) => <Row key={card.id} card={card} />)}
          </div>
        </section>)}
      </ScreenBody>}
  </Screen>
}

export default function UpcomingScreen(): React.ReactElement {
  return <TasksGate title="Upcoming" tabs={<TabLinks items={TASKS_TABS} />}><Upcoming /></TasksGate>
}
