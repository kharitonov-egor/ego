import React from 'react'
import { Navigate } from 'react-router'
import { homeBoardId } from '@ego/local/tasks/board'
import { TabLinks } from '../../components/screen'
import { TasksGate } from '../../components/tasks/ui'
import { useTasks } from '../../lib/tasks/context'
import { BOARDS_PATH, TASKS_TABS, boardPath } from './nav'

function TasksHome(): React.ReactElement {
  const { data } = useTasks()
  const home = data ? homeBoardId(data) : null
  return <Navigate to={home ? boardPath(home) : BOARDS_PATH} replace />
}

/** Tasks opens on the board that holds the Inbox, or on the board list when no board has one. */
export default function TasksHomeScreen(): React.ReactElement {
  return <TasksGate title="Tasks" tabs={<TabLinks items={TASKS_TABS} />}><TasksHome /></TasksGate>
}
