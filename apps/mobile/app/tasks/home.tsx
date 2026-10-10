import React from 'react'
import { Redirect } from 'expo-router'
import { homeBoardId } from '@ego/local/tasks/board'
import { TasksGate } from '../../components/tasks/ui'
import { useTasks } from '../../lib/tasks/context'

function TasksHome(): React.ReactElement {
  const { data } = useTasks()
  const home = data ? homeBoardId(data) : null
  return home ? <Redirect href={{ pathname: '/tasks/board/[id]', params: { id: home } }} /> : <Redirect href="/tasks" />
}

/** The start screen's Tasks tile lands here and goes on to the board that holds the Inbox. */
export default function TasksHomeScreen(): React.ReactElement {
  return <TasksGate><TasksHome /></TasksGate>
}
