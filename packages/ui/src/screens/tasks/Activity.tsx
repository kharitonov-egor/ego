import React, { useMemo } from 'react'
import { useParams } from 'react-router'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { ActivityRow, type ActivityEntry } from '../../components/tasks/ActivityList'
import { TasksGate } from '../../components/tasks/ui'
import { useTasks } from '../../lib/tasks/context'
import { boardPath, useOpenCard } from './nav'

/** Every card's log on one board, newest first, the way Trello's board menu shows it. */
function BoardActivity({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const openCard = useOpenCard()
  const entries = useMemo<ActivityEntry[]>(() => (tasks.data?.cards ?? [])
    .filter((card) => card.boardId === boardId)
    .flatMap((card) => card.activity.map((entry) => ({ ...entry, cardTitle: card.title, cardId: card.id })))
    .sort((left, right) => right.at.localeCompare(left.at)), [boardId, tasks.data])
  return <Screen>
    <ScreenHeader title="Activity" back={boardPath(boardId)} />
    {entries.length === 0
      ? <div className="flex min-h-0 flex-1 items-center justify-center px-8">
        <p className="text-center text-[16px] leading-6 text-surface-400">Nothing has happened on this board yet.</p>
      </div>
      : <ScreenBody className="pb-10 pt-2">
        {entries.map((entry, index) => <ActivityRow key={`${entry.cardId ?? ''}-${entry.at}-${index}`} entry={entry} now={tasks.now} onOpenCard={(id) => openCard(id)} />)}
      </ScreenBody>}
  </Screen>
}

export default function ActivityScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title="Activity" back={boardPath(id)}><BoardActivity boardId={id} /></TasksGate>
}
