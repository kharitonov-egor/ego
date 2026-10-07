import React, { useEffect, useState } from 'react'
import {
  ArrowDown, ArrowUp, EllipsisVertical, House, Link2, Plus, Trash2, Unlink, type LucideIcon
} from 'lucide-react'
import { linkSuperset, supersetOf, withoutSuperset } from '@ego/core'
import { setCountLabel } from '@ego/local/gym/format'
import type { GymDay } from '@ego/local/repositories/gym'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { ConfirmDialog, Modal } from '../ui/dialog'
import { PickerSheet } from './sheets'
import { DropLine, moveItem, useDragReorder } from './ui'
import { PopupMenu, anchorAtPointer, anchorBelow, type MenuAnchor, type MenuItem } from '../ui/menu'

function Action({ Icon, label, onPress }: { Icon: LucideIcon; label: string; onPress: () => void }): React.ReactElement {
  return <button type="button" onClick={onPress} className="flex min-h-12 w-full items-center px-5 text-left hover:bg-surface-800 active:bg-surface-800">
    <Icon color={color.textSecondary} size={20} />
    <span className="ml-4 text-[15px] font-bold tracking-wide">{label}</span>
  </button>
}

interface WorkoutListProps {
  day: GymDay | null
  /** The exercise Track has open, or null on the day view. */
  currentId: string | null
  onSelect: (exerciseId: string) => void
  onAddExercise: () => void
  onHome?: () => void
  /** Set when the list slides over the screen and should get out of the way after a choice. */
  onClose?: () => void
}

/**
 * FitNotes' side panel: the day's exercises, their order, and their supersets. Rows drag to a new
 * place; a right-click or the row's menu button offers the phone's hold menu.
 */
function WorkoutList({ day, currentId, onSelect, onAddExercise, onHome, onClose }: WorkoutListProps): React.ReactElement {
  const gym = useGym()
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null)
  const [pairingFor, setPairingFor] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)

  useEffect(() => setPendingOrder(null), [day])

  const loaded = day?.exercises ?? []
  const exercises = pendingOrder
    ? pendingOrder.flatMap((id) => loaded.filter((item) => item.exercise.id === id))
    : loaded
  const supersets = day?.supersets ?? []
  const ids = exercises.map((item) => item.exercise.id)
  const nameOf = (id: string): string => exercises.find((item) => item.exercise.id === id)?.exercise.name ?? ''
  const close = (): void => onClose?.()

  const move = (from: number, to: number): void => {
    if (!day || from === -1 || to === from || to < 0 || to >= ids.length) return
    setPendingOrder(moveItem(ids, from, to))
    void gym.arrange(day.date, (current) => ({ ...current, exerciseOrder: moveItem(current.exerciseOrder, from, to) }))
      .then((saved) => { if (!saved) setPendingOrder(null) })
  }

  const menuItems = (id: string): MenuItem[] => {
    const index = ids.indexOf(id)
    const group = supersetOf(supersets, id)
    const items: MenuItem[] = [
      { label: 'Move up', Icon: ArrowUp, disabled: index <= 0, onPress: () => move(index, index - 1) },
      { label: 'Move down', Icon: ArrowDown, disabled: index === -1 || index >= ids.length - 1, onPress: () => move(index, index + 1) },
      { label: 'Add to superset', Icon: Link2, disabled: ids.length < 2, onPress: () => setPairingFor(id) }
    ]
    if (group && day) items.push({ label: 'Remove from superset', Icon: Unlink, onPress: () => void gym.arrange(day.date, (current) => ({ ...current, supersets: withoutSuperset(current.supersets, id) })) })
    items.push({ label: 'Delete from this workout', Icon: Trash2, destructive: true, onPress: () => setRemoving(id) })
    return items
  }

  const pairWith = (other: string): void => {
    const first = pairingFor
    if (!first || !day) return
    void gym.arrange(day.date, (current) => linkSuperset(current, first, other))
  }

  const removeFromWorkout = async (): Promise<void> => {
    const id = removing
    setRemoving(null)
    const item = exercises.find((entry) => entry.exercise.id === id)
    if (!item || !day) return
    const exerciseId = item.exercise.id
    if (item.sets.length > 0 && !await gym.deleteSets(item.sets.map((set) => set.id))) return
    if (day.workout?.exerciseOrder.includes(exerciseId) || supersetOf(supersets, exerciseId)) {
      await gym.arrange(day.date, (current) => ({
        exerciseOrder: current.exerciseOrder.filter((entry) => entry !== exerciseId),
        supersets: withoutSuperset(current.supersets, exerciseId)
      }))
    }
    if (exerciseId === currentId) close()
  }

  const drag = useDragReorder(ids, move, day !== null)
  const removingSets = exercises.find((entry) => entry.exercise.id === removing)?.sets.length ?? 0

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="border-b border-border px-5 pb-4 pt-5">
      <h2 className="text-[17px] font-bold tracking-wide">{`${exercises.length} ${exercises.length === 1 ? 'EXERCISE' : 'EXERCISES'}`}</h2>
      <p className="mt-0.5 text-[14px] text-muted-foreground">Drag an exercise to reorder it. Right-click it to superset it.</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto" {...drag.listProps}>
      {exercises.map((item, index) => {
        const id = item.exercise.id
        const group = supersetOf(supersets, id)
        const joinsPrevious = group !== null && index > 0 && group.includes(ids[index - 1])
        const joinsNext = group !== null && index < ids.length - 1 && group.includes(ids[index + 1])
        const current = id === currentId
        return <div
          key={id}
          {...drag.rowProps(id, index)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({ id, anchor: anchorAtPointer(event) })
          }}
          className={cn('group relative flex min-h-[64px] items-center pr-2',
            current ? 'bg-surface-800' : 'hover:bg-surface-900',
            drag.dragging === id && 'opacity-40')}
        >
          {drag.dragging && drag.dropAt === index && <DropLine edge="top" />}
          {drag.dragging && drag.dropAt === exercises.length && index === exercises.length - 1 && <DropLine edge="bottom" />}
          <button
            type="button"
            aria-current={current ? 'true' : undefined}
            onClick={() => {
              onSelect(id)
              close()
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-stretch self-stretch text-left active:cursor-grabbing"
          >
            <span className="relative w-5 shrink-0">
              {group && <span
                className="absolute left-2 w-[3px] rounded-sm bg-foreground"
                style={{ top: joinsPrevious ? 0 : 14, bottom: joinsNext ? 0 : 14 }}
              />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center py-2">
              <span className={cn('line-clamp-2 text-[16px]', current && 'font-semibold')}>{item.exercise.name}</span>
              <span className="text-[14px] text-muted-foreground">{setCountLabel(item.sets.length)}{group ? ', superset' : ''}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label={`Options for ${item.exercise.name}`}
            title="More options"
            onClick={(event) => setMenu({ id, anchor: anchorBelow(event.currentTarget) })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-700"
          >
            <EllipsisVertical color={color.textMuted} size={20} />
          </button>
        </div>
      })}
      {exercises.length === 0 && <p className="px-5 py-6 text-[15px] leading-6 text-muted-foreground">Nothing logged this day yet. Save a set or start a plan and it shows up here.</p>}
    </div>
    <div className="border-t border-border bg-surface-900 py-1">
      <Action Icon={Plus} label="ADD EXERCISE" onPress={() => { close(); onAddExercise() }} />
      {currentId !== null && <Action Icon={Link2} label="ADD TO SUPERSET" onPress={() => setPairingFor(currentId)} />}
      {onHome && <Action Icon={House} label="HOME" onPress={() => { close(); onHome() }} />}
    </div>

    <PopupMenu anchor={menu?.anchor ?? null} title={menu ? nameOf(menu.id) : undefined} items={menu ? menuItems(menu.id) : []} onClose={() => setMenu(null)} />
    <PickerSheet
      visible={pairingFor !== null}
      title={`Superset with ${pairingFor ? nameOf(pairingFor) || 'this exercise' : ''}`}
      options={exercises.filter((item) => item.exercise.id !== pairingFor).map((item) => ({
        value: item.exercise.id, label: item.exercise.name, detail: setCountLabel(item.sets.length)
      }))}
      value={null}
      onPick={pairWith}
      onClose={() => setPairingFor(null)}
    />
    <ConfirmDialog
      visible={removing !== null}
      title={removingSets > 0 ? 'Delete from this workout?' : 'Remove from this workout?'}
      detail={removingSets > 0
        ? `The ${removing ? nameOf(removing) : ''} sets logged this day are deleted. Other days keep theirs.`
        : `${removing ? nameOf(removing) : 'It'} leaves this day's list.`}
      confirmLabel={removingSets > 0 ? 'Delete sets' : 'Remove'}
      destructive
      onCancel={() => setRemoving(null)}
      onConfirm={() => void removeFromWorkout()}
    />
  </div>
}

/** The list as a column on the right of a wide window, beside the day or the exercise. */
export function WorkoutPanel(props: Omit<WorkoutListProps, 'onClose'>): React.ReactElement {
  return <aside aria-label="The day's exercises" className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
    <WorkoutList {...props} />
  </aside>
}

/** On a narrow window the list slides in from the left, as on the phone. */
export function WorkoutDrawer({ visible, onClose, ...props }: Omit<WorkoutListProps, 'onClose'> & {
  visible: boolean
  onClose: () => void
}): React.ReactElement | null {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!visible) {
      setEntered(false)
      return
    }
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [visible])
  return <Modal
    visible={visible}
    onClose={onClose}
    dismissOnBackdrop
    className={cn('fixed inset-y-0 left-0 flex w-[min(360px,82vw)] flex-col border-r border-border bg-card transition-transform duration-200 ease-out motion-reduce:transition-none',
      entered ? 'translate-x-0' : '-translate-x-full')}
  >
    <WorkoutList {...props} onClose={onClose} />
  </Modal>
}
