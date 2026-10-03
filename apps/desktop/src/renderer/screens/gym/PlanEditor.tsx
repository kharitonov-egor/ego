import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  ArrowDown, ArrowUp, Check, EllipsisVertical, Link2, Plus, Search, Trash2, Unlink, X
} from 'lucide-react'
import { linkSuperset, supersetOf, withoutSuperset, type GymArrangement } from '@ego/core'
import { exerciseCountLabel, planNameProblem } from '@ego/local/gym/plans'
import { PickerSheet } from '../../components/gym/sheets'
import { Dot, DropLine, GymGate, SectionLabel, moveItem, useDragReorder } from '../../components/gym/ui'
import { PopupMenu, anchorAtPointer, anchorBelow, anchorForClick, type MenuAnchor, type MenuItem } from '../../components/ui/menu'
import { CenteredMessage, Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const EMPTY: GymArrangement = { exerciseOrder: [], supersets: [] }

function without(arrangement: GymArrangement, id: string): GymArrangement {
  return {
    exerciseOrder: arrangement.exerciseOrder.filter((entry) => entry !== id),
    supersets: withoutSuperset(arrangement.supersets, id)
  }
}

/** Clicking an exercise adds it to the plan or takes it out again. The sheet stays open for more. */
function ExercisePicker({ visible, chosen, onToggle, onClose }: {
  visible: boolean
  chosen: readonly string[]
  onToggle: (id: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const gym = useGym()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle ? gym.exercises.filter((exercise) => exercise.name.toLocaleLowerCase().includes(needle)) : gym.exercises
  return <Sheet visible={visible} title="Add exercises" onClose={onClose} dismissOnBackdrop>
    <div className="mb-2 flex items-center rounded-xl border border-input bg-surface-900 px-3">
      <Search color={color.textFaint} size={18} />
      <input
        aria-label="Search exercises"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search exercises"
        autoComplete="off"
        spellCheck={false}
        className="ml-2 min-h-[48px] flex-1 bg-transparent text-[17px] text-foreground outline-none"
      />
      {needle !== '' && <IconButton label="Clear search" onClick={() => setQuery('')}><X color={color.textMuted} size={18} /></IconButton>}
    </div>
    {shown.map((exercise) => {
      const selected = chosen.includes(exercise.id)
      return <button
        key={exercise.id}
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(exercise.id)}
        className="flex min-h-14 w-full items-center border-b border-surface-900 py-2 text-left hover:bg-surface-900 active:bg-surface-900"
      >
        <span className="mr-3 flex"><Dot color={exercise.categoryColor} size={10} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('text-[17px]', selected && 'font-semibold')}>{exercise.name}</span>
          <span className="text-[14px] text-muted-foreground">{exercise.categoryName}</span>
        </span>
        {selected && <Check color={color.text} size={19} />}
      </button>
    })}
    {shown.length === 0 && <p className="py-6 text-center text-[16px] text-muted-foreground">Nothing called "{query.trim()}".</p>}
  </Sheet>
}

export default function PlanEditor(): React.ReactElement {
  const [params] = useSearchParams()
  const id = params.get('id')
  const gym = useGym()
  const navigate = useNavigate()
  const existing = id ? gym.plans.find((plan) => plan.id === id) ?? null : null
  const [name, setName] = useState('')
  const [arrangement, setArrangement] = useState<GymArrangement>(EMPTY)
  const [loaded, setLoaded] = useState(!id)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null)
  const [pairingFor, setPairingFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (loaded || !existing) return
    const live = new Set(gym.exercises.map((exercise) => exercise.id))
    setName(existing.name)
    setArrangement({
      exerciseOrder: existing.exerciseOrder.filter((entry) => live.has(entry)),
      supersets: existing.supersets.map((group) => group.filter((entry) => live.has(entry))).filter((group) => group.length >= 2)
    })
    setLoaded(true)
  }, [existing, gym.exercises, loaded])

  const byId = new Map(gym.exercises.map((exercise) => [exercise.id, exercise]))
  const items = arrangement.exerciseOrder.flatMap((entry) => {
    const exercise = byId.get(entry)
    return exercise ? [exercise] : []
  })
  const ids = items.map((exercise) => exercise.id)
  const nameOf = (entry: string): string => byId.get(entry)?.name ?? ''

  const toggle = (entry: string): void => setArrangement((current) => current.exerciseOrder.includes(entry)
    ? without(current, entry)
    : { ...current, exerciseOrder: [...current.exerciseOrder, entry] })

  const reorder = (from: number, to: number): void => setArrangement((current) => {
    const order = current.exerciseOrder.filter((entry) => byId.has(entry))
    return { ...current, exerciseOrder: moveItem(order, from, to) }
  })
  const drag = useDragReorder(ids, reorder)

  const shift = (entry: string, by: -1 | 1): void => {
    const index = ids.indexOf(entry)
    reorder(index, index + by)
  }

  const menuItems = (entry: string): MenuItem[] => {
    const index = ids.indexOf(entry)
    const entries: MenuItem[] = [
      { label: 'Move up', Icon: ArrowUp, disabled: index <= 0, onPress: () => shift(entry, -1) },
      { label: 'Move down', Icon: ArrowDown, disabled: index === -1 || index >= ids.length - 1, onPress: () => shift(entry, 1) },
      { label: 'Add to superset', Icon: Link2, disabled: ids.length < 2, onPress: () => setPairingFor(entry) }
    ]
    if (supersetOf(arrangement.supersets, entry)) {
      entries.push({
        label: 'Remove from superset',
        Icon: Unlink,
        onPress: () => setArrangement((current) => ({ ...current, supersets: withoutSuperset(current.supersets, entry) }))
      })
    }
    entries.push({ label: 'Remove from plan', Icon: Trash2, destructive: true, onPress: () => setArrangement((current) => without(current, entry)) })
    return entries
  }

  const save = async (): Promise<void> => {
    const issue = planNameProblem(name, gym.plans, existing?.id ?? null)
    if (issue) return setProblem(issue)
    if (ids.length === 0) return setProblem('Add at least one exercise')
    setProblem(null)
    const saved = await gym.savePlan(existing?.id ?? null, {
      name: name.trim(),
      exerciseOrder: ids,
      supersets: arrangement.supersets.map((group) => group.filter((entry) => byId.has(entry))).filter((group) => group.length >= 2)
    })
    if (saved) navigate('/gym/plans')
  }

  const remove = async (): Promise<void> => {
    setDeleting(false)
    if (existing && await gym.deletePlan(existing.id)) navigate('/gym/plans')
  }

  const gone = Boolean(id) && !existing && gym.exercises.length > 0

  return <Screen>
    <ScreenHeader title={id ? 'Edit plan' : 'New plan'} back="/gym/plans" right={gone ? undefined
      : <IconButton label="Save plan" onClick={() => void save()}><Check color={color.text} size={22} /></IconButton>} />
    <GymGate>
      {gone
        ? <CenteredMessage title="This plan is gone" detail="It was deleted, possibly on another device." action="Back to plans" onAction={() => navigate('/gym/plans')} />
        : <ScreenBody className="pb-10 pt-6">
          <form onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}>
            <SectionLabel>NAME</SectionLabel>
            <input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus={!id}
              maxLength={60}
              placeholder="Push day"
              className={cn(inputClass, 'mb-7 mt-3')}
            />
          </form>
          <SectionLabel right={items.length > 0 ? <span className="text-[14px] text-muted-foreground">{exerciseCountLabel(items.length)}</span> : undefined}>EXERCISES</SectionLabel>
          {items.length > 1 && <p className="mt-2 text-[14px] text-muted-foreground">Drag an exercise to reorder it. Click it to superset or remove it.</p>}
          <div {...drag.listProps}>
            {items.map((exercise, index) => {
              const group = supersetOf(arrangement.supersets, exercise.id)
              const joinsPrevious = group !== null && index > 0 && group.includes(ids[index - 1])
              const joinsNext = group !== null && index < ids.length - 1 && group.includes(ids[index + 1])
              return <div
                key={exercise.id}
                {...drag.rowProps(exercise.id, index)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ id: exercise.id, anchor: anchorAtPointer(event) })
                }}
                className={cn('relative flex min-h-[60px] items-center border-b border-border hover:bg-surface-900',
                  drag.dragging === exercise.id && 'opacity-40')}
              >
                {drag.dragging && drag.dropAt === index && <DropLine edge="top" />}
                {drag.dragging && drag.dropAt === items.length && index === items.length - 1 && <DropLine edge="bottom" />}
                <span className="relative w-5 shrink-0 self-stretch">
                  {group && <span
                    className="absolute left-1.5 w-[3px] rounded-sm bg-foreground"
                    style={{ top: joinsPrevious ? 0 : 14, bottom: joinsNext ? 0 : 14 }}
                  />}
                </span>
                <button
                  type="button"
                  title="Reorder, superset, or remove"
                  onClick={(event) => setMenu({ id: exercise.id, anchor: anchorForClick(event) })}
                  className="flex min-w-0 flex-1 flex-col self-stretch justify-center py-2 text-left"
                >
                  <span className="text-[16px]">{exercise.name}</span>
                  <span className="text-[14px] text-muted-foreground">{exercise.categoryName}{group ? ', superset' : ''}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Options for ${exercise.name}`}
                  title="More options"
                  onClick={(event) => setMenu({ id: exercise.id, anchor: anchorBelow(event.currentTarget) })}
                  className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-700"
                >
                  <EllipsisVertical color={color.textMuted} size={20} />
                </button>
              </div>
            })}
          </div>
          <button type="button" onClick={() => setAdding(true)} className="flex min-h-14 w-full items-center rounded-xl text-left hover:bg-surface-900 active:bg-surface-900">
            <Plus color={color.textSecondary} size={19} />
            <span className="ml-3 text-[16px] font-medium text-surface-200">Add exercises</span>
          </button>
          {problem && <p className="mb-2 mt-4 text-[15px] text-destructive">{problem}</p>}
          <Button size="lg" disabled={gym.writing} onClick={() => void save()} className="mt-6 w-full">{existing ? 'Save changes' : 'Create plan'}</Button>
          {existing && <Button variant="outline" size="lg" onClick={() => setDeleting(true)} className="mt-3 w-full border-destructive/40">
            <Trash2 color={color.destructive} size={18} />
            <span className="text-destructive">Delete plan</span>
          </Button>}
        </ScreenBody>}
    </GymGate>
    <ExercisePicker visible={adding} chosen={ids} onToggle={toggle} onClose={() => setAdding(false)} />
    <PopupMenu anchor={menu?.anchor ?? null} title={menu ? nameOf(menu.id) : undefined} items={menu ? menuItems(menu.id) : []} onClose={() => setMenu(null)} />
    <PickerSheet
      visible={pairingFor !== null}
      title={`Superset with ${pairingFor ? nameOf(pairingFor) : ''}`}
      options={items.filter((exercise) => exercise.id !== pairingFor).map((exercise) => ({ value: exercise.id, label: exercise.name, detail: exercise.categoryName }))}
      value={null}
      onPick={(other) => {
        const first = pairingFor
        if (first) setArrangement((current) => linkSuperset(current, first, other))
      }}
      onClose={() => setPairingFor(null)}
    />
    <ConfirmDialog
      visible={deleting}
      title={`Delete ${existing?.name ?? 'this plan'}?`}
      detail="Days you already started from it keep their exercises and sets."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(false)}
      onConfirm={() => void remove()}
    />
  </Screen>
}
