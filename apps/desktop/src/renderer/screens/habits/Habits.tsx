import React from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { HabitEditorHost } from '../../components/habits/HabitEditor'
import { HabitsProvider } from '../../lib/habits/context'
import HabitsHome from './Home'
import HabitsProgress from './Progress'
import HabitsQuit from './Quit'

/** The phone's Habits tabs, under `/habits/*`, sharing one provider and one editor sheet. */
export default function Habits(): React.ReactElement {
  return <HabitsProvider>
    <Routes>
      <Route path="home" element={<HabitsHome />} />
      <Route path="progress" element={<HabitsProgress />} />
      <Route path="quit" element={<HabitsQuit />} />
      <Route path="*" element={<Navigate to="/habits/home" replace />} />
    </Routes>
    <HabitEditorHost />
  </HabitsProvider>
}
