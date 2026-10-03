import React from 'react'
import { Navigate, Route, Routes } from 'react-router'
import ActivityScreen from './Activity'
import ArchiveScreen from './Archive'
import BoardScreen from './Board'
import BoardsScreen from './Boards'
import CardScreen from './Card'
import UpcomingScreen from './Upcoming'

/** Everything under /tasks: the two tabs, then a board, a card, and a board's activity and archive. */
export default function TasksRoutes(): React.ReactElement {
  return <Routes>
    <Route index element={<BoardsScreen />} />
    <Route path="upcoming" element={<UpcomingScreen />} />
    <Route path="board/:id" element={<BoardScreen />} />
    <Route path="card/:id" element={<CardScreen />} />
    <Route path="activity/:id" element={<ActivityScreen />} />
    <Route path="archive/:id" element={<ArchiveScreen />} />
    <Route path="*" element={<Navigate to="/tasks" replace />} />
  </Routes>
}
