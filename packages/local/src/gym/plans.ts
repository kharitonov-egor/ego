import { isoToday, parseIso } from '../dates'
import type { GymExerciseView, GymPlanView } from '../repositories/gym'

/** "Start today", or "Start on Sun, Sep 20" when the log is showing another day. */
export function startLabel(iso: string, today: string = isoToday()): string {
  if (iso === today) return 'Start today'
  return `Start on ${parseIso(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
}

export function planNameProblem(name: string, plans: readonly GymPlanView[], editingId: string | null): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the plan a name'
  if (trimmed.length > 60) return 'Keep the name under 60 characters'
  const clash = plans.find((plan) => plan.id !== editingId && plan.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  return clash ? `A plan called ${clash.name} already exists` : null
}

/** The plan's exercises that still exist, in plan order. A deleted exercise drops out quietly. */
export function planExercises(plan: GymPlanView, exercises: readonly GymExerciseView[]): GymExerciseView[] {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]))
  return plan.exerciseOrder.flatMap((id) => {
    const exercise = byId.get(id)
    return exercise ? [exercise] : []
  })
}

export function exerciseCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'exercise' : 'exercises'}`
}
