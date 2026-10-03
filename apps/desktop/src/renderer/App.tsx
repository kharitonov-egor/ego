import React from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import TitleBar from './components/TitleBar'
import TalkToAIView from './components/TalkToAIView'
import { Sidebar } from './components/Sidebar'
import { BlurProvider } from './lib/blur'
import { GymProvider } from './lib/gym/context'
import { RestTimerProvider } from './lib/gym/rest-timer'
import { LedgerProvider } from './lib/ledger'
import { MoneyProvider } from './lib/money'
import { PeriodProvider } from './lib/period'
import { ReminderProvider } from './lib/reminder'
import { TasksProvider } from './lib/tasks/context'
import { TaskNotificationsProvider } from './lib/tasks/notifications'
import ExerciseEditor from './screens/gym/ExerciseEditor'
import Exercises from './screens/gym/Exercises'
import GymCalendar from './screens/gym/GymCalendar'
import GymLog from './screens/gym/GymLog'
import PlanEditor from './screens/gym/PlanEditor'
import Plans from './screens/gym/Plans'
import Track from './screens/gym/Track'
import Habits from './screens/habits/Habits'
import Health from './screens/health/Health'
import HealthHome from './screens/health/HealthHome'
import HealthMetricScreen from './screens/health/HealthMetric'
import Home from './screens/Home'
import Settings from './screens/Settings'
import { moneyRoutes } from './screens/money/Finance'
import MoodScreen from './screens/mood/MoodScreen'
import SheetsApp from './screens/sheets'
import Assignments from './screens/study/Assignments'
import Courses from './screens/study/Courses'
import Study from './screens/study/Study'
import TasksRoutes from './screens/tasks'

function TalkToAI(): React.ReactElement {
  const navigate = useNavigate()
  return <TalkToAIView onOpenSettings={() => navigate('/settings')} />
}

/** Follows a notification click to the page it is about. */
function NavigationRequests(): null {
  const navigate = useNavigate()
  React.useEffect(() => window.api.onNavigate((route) => navigate(route)), [navigate])
  return null
}

/** The phone's root providers, in the phone's order. */
function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return <BlurProvider>
    <LedgerProvider>
      <MoneyProvider>
        <GymProvider>
          <RestTimerProvider>
            <PeriodProvider>
              <ReminderProvider>
                <TasksProvider>
                  <TaskNotificationsProvider>
                    {children}
                  </TaskNotificationsProvider>
                </TasksProvider>
              </ReminderProvider>
            </PeriodProvider>
          </RestTimerProvider>
        </GymProvider>
      </MoneyProvider>
    </LedgerProvider>
  </BlurProvider>
}

export default function App(): React.ReactElement {
  return <Providers>
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <NavigationRequests />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/ai" element={<TalkToAI />} />
            {moneyRoutes}
            <Route path="/gym" element={<GymLog />} />
            <Route path="/gym/track" element={<Track />} />
            <Route path="/gym/calendar" element={<GymCalendar />} />
            <Route path="/gym/exercises" element={<Exercises />} />
            <Route path="/gym/exercise-editor" element={<ExerciseEditor />} />
            <Route path="/gym/plans" element={<Plans />} />
            <Route path="/gym/plan-editor" element={<PlanEditor />} />
            <Route path="/health" element={<Health />}>
              <Route index element={<HealthHome />} />
              <Route path=":metric" element={<HealthMetricScreen />} />
            </Route>
            <Route path="/mood" element={<MoodScreen />} />
            <Route path="/study" element={<Study />}>
              <Route index element={<Navigate to="/study/assignments" replace />} />
              <Route path="assignments" element={<Assignments />} />
              <Route path="courses" element={<Courses />} />
            </Route>
            <Route path="/habits/*" element={<Habits />} />
            <Route path="/tasks/*" element={<TasksRoutes />} />
            <Route path="/sheets/*" element={<SheetsApp />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  </Providers>
}
