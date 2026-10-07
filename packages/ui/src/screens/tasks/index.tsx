import React from 'react'
import { Navigate, Route, Routes } from 'react-router'
import ActivityScreen from './Activity'
import ArchiveScreen from './Archive'
import BoardScreen from './Board'
import BoardsScreen from './Boards'
import CardScreen from './Card'
import GoalScreen from './Goal'
import GoalsScreen from './Goals'
import UpcomingScreen from './Upcoming'

/** Everything under /tasks: the tabs, then a board, a card, a goal, and a board's activity and archive. */
export default function TasksRoutes(): React.ReactElement {
  return <Routes>
    <Route index element={<BoardsScreen />} />
    <Route path="goals" element={<GoalsScreen />} />
    <Route path="upcoming" element={<UpcomingScreen />} />
    <Route path="board/:id" element={<BoardScreen />} />
    <Route path="card/:id" element={<CardScreen />} />
    <Route path="goal/:id" element={<GoalScreen />} />
    <Route path="activity/:id" element={<ActivityScreen />} />
    <Route path="archive/:id" element={<ArchiveScreen />} />
    <Route path="*" element={<Navigate to="/tasks" replace />} />
  </Routes>
}
