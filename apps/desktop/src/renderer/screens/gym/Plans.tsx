import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { ClipboardList, EllipsisVertical, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { planExercises, startLabel } from '@ego/local/gym/plans'
import type { GymPlanView } from '@ego/local/repositories/gym'
import { GymGate } from '../../components/gym/ui'
import { PopupMenu, anchorAtPointer, anchorBelow, type MenuAnchor } from '../../components/ui/menu'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'

/** Named lists of exercises that can start any day's workout. */
export default function Plans(): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ plan: GymPlanView; anchor: MenuAnchor } | null>(null)
  const [deleting, setDeleting] = useState<GymPlanView | null>(null)

  const edit = (id?: string): void => {
    void navigate(id ? `/gym/plan-editor?id=${encodeURIComponent(id)}` : '/gym/plan-editor')
  }

  const start = async (plan: GymPlanView): Promise<void> => {
    if (await gym.startPlan(gym.date, plan)) navigate('/gym')
  }

  const remove = async (): Promise<void> => {
    const target = deleting
    setDeleting(null)
    if (target) await gym.deletePlan(target.id)
  }

  return <Screen>
    <ScreenHeader title="Plans" back="/gym" right={
      <IconButton label="New plan" onClick={() => edit()}><Plus color={color.text} size={22} /></IconButton>
    } />
    <GymGate>
      {gym.plans.length === 0
        ? <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <ClipboardList color={color.textFaint} size={34} />
          <h2 className="mt-3 text-[20px] font-semibold">No plans yet</h2>
          <p className="mt-2 max-w-md text-[16px] leading-6 text-muted-foreground">
            A plan is a list of exercises you can start on any day. To reuse a workout you already logged, open that day and pick Save day as plan from the menu.
          </p>
          <Button size="lg" onClick={() => edit()} className="mt-6"><Plus color={color.screen} size={19} />New plan</Button>
        </div>
        : <ScreenBody className="py-2">
          {gym.plans.map((item) => {
            const exercises = planExercises(item, gym.exercises)
            return <div
              key={item.id}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ plan: item, anchor: anchorAtPointer(event) })
              }}
              className="flex min-h-[64px] items-center border-b border-border hover:bg-surface-900"
            >
              <button type="button" title="Edit this plan" onClick={() => edit(item.id)} className="flex min-w-0 flex-1 flex-col py-2.5 pl-4 text-left">
                <span className="text-[17px] font-medium">{item.name}</span>
                <span className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-muted-foreground">
                  {exercises.length > 0 ? exercises.map((exercise) => exercise.name).join(', ') : 'No exercises'}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Options for ${item.name}`}
                title="More options"
                onClick={(event) => setMenu({ plan: item, anchor: anchorBelow(event.currentTarget) })}
                className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-700"
              >
                <EllipsisVertical color={color.textMuted} size={20} />
              </button>
            </div>
          })}
        </ScreenBody>}
    </GymGate>
    <PopupMenu anchor={menu?.anchor ?? null} title={menu?.plan.name} onClose={() => setMenu(null)} items={menu ? [
      {
        label: startLabel(gym.date),
        Icon: ListPlus,
        disabled: planExercises(menu.plan, gym.exercises).length === 0,
        onPress: () => void start(menu.plan)
      },
      { label: 'Edit plan', Icon: Pencil, onPress: () => edit(menu.plan.id) },
      { label: 'Delete plan', Icon: Trash2, destructive: true, onPress: () => setDeleting(menu.plan) }
    ] : []} />
    <ConfirmDialog
      visible={deleting !== null}
      title={`Delete ${deleting?.name ?? 'this plan'}?`}
      detail="Days you already started from it keep their exercises and sets."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove()}
    />
  </Screen>
}
