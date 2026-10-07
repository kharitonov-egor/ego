import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { EllipsisVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { GymCategoryView, GymExerciseView } from '@ego/local/repositories/gym'
import { CategorySheet } from '../../components/gym/sheets'
import { Dot, GymGate, trackPath } from '../../components/gym/ui'
import { PopupMenu, anchorAtPointer, anchorBelow, type MenuAnchor, type MenuItem } from '../../components/ui/menu'
import { Screen, ScreenHeader } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

function matches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

function Row({ title, detail, swatch, selected = false, onPress, onMenu }: {
  title: string
  detail?: string
  swatch?: string
  selected?: boolean
  onPress: () => void
  onMenu?: (anchor: MenuAnchor) => void
}): React.ReactElement {
  return <div
    onContextMenu={onMenu ? (event) => {
      event.preventDefault()
      onMenu(anchorAtPointer(event))
    } : undefined}
    className={cn('flex min-h-[58px] items-center border-b border-border', selected ? 'bg-surface-800' : 'hover:bg-surface-900')}
  >
    <button type="button" aria-pressed={selected} onClick={onPress} className="flex min-h-[58px] min-w-0 flex-1 items-center pl-4 text-left">
      {swatch && <span className="mr-3 flex"><Dot color={swatch} size={10} /></span>}
      <span className="flex min-w-0 flex-1 flex-col py-2">
        <span className="truncate text-[17px]">{title}</span>
        {detail && <span className="text-[14px] text-muted-foreground">{detail}</span>}
      </span>
    </button>
    {onMenu && <button
      type="button"
      aria-label={`Options for ${title}`}
      title="More options"
      onClick={(event) => onMenu(anchorBelow(event.currentTarget))}
      className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-700"
    >
      <EllipsisVertical color={color.textMuted} size={20} />
    </button>}
  </div>
}

type OpenMenu =
  | { kind: 'category'; item: GymCategoryView; anchor: MenuAnchor }
  | { kind: 'exercise'; item: GymExerciseView; anchor: MenuAnchor }

/**
 * FitNotes' exercise picker, with the categories beside their exercises. Search looks across the
 * chosen category, or all of them. Picking an exercise opens it for the day being logged.
 */
export default function Exercises(): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [editingCategory, setEditingCategory] = useState<GymCategoryView | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [deletingExercise, setDeletingExercise] = useState<GymExerciseView | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<GymCategoryView | null>(null)
  const category = gym.categories.find((item) => item.id === categoryId) ?? null
  const searching = query.trim().length > 0

  const exercises = useMemo(() => gym.exercises.filter((exercise) =>
    (!categoryId || exercise.categoryId === categoryId) && (!searching || matches(exercise.name, query.trim()))),
  [categoryId, gym.exercises, query, searching])

  const open = (exercise: GymExerciseView): void => {
    void navigate(trackPath(exercise.id), { replace: true })
  }

  const editor = (params: Record<string, string>): void => {
    navigate(`/gym/exercise-editor?${new URLSearchParams(params).toString()}`, { state: { back: '/gym/exercises' } })
  }

  const removeExercise = async (): Promise<void> => {
    const target = deletingExercise
    setDeletingExercise(null)
    if (target) await gym.deleteExercise(target.id)
  }

  const removeCategory = async (): Promise<void> => {
    const target = deletingCategory
    setDeletingCategory(null)
    if (target && await gym.deleteCategory(target.id) && categoryId === target.id) setCategoryId(null)
  }

  const menuItems = (target: OpenMenu): MenuItem[] => target.kind === 'category'
    ? [
      { label: 'Edit category', Icon: Pencil, onPress: () => setEditingCategory(target.item) },
      { label: 'Delete category', Icon: Trash2, destructive: true, onPress: () => setDeletingCategory(target.item) }
    ]
    : [
      { label: 'Edit exercise', Icon: Pencil, onPress: () => editor({ id: target.item.id }) },
      { label: 'Delete exercise', Icon: Trash2, destructive: true, onPress: () => setDeletingExercise(target.item) }
    ]

  return <Screen>
    <ScreenHeader title={category?.name ?? 'All exercises'} back="/gym" right={
      <IconButton label="New exercise" onClick={() => editor(categoryId ? { categoryId } : {})}><Plus color={color.text} size={22} /></IconButton>
    } />
    <GymGate>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Categories" className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
          <Row title="All exercises" detail={`${gym.exercises.length} ${gym.exercises.length === 1 ? 'exercise' : 'exercises'}`} selected={categoryId === null} onPress={() => setCategoryId(null)} />
          {gym.categories.map((item) => <Row
            key={item.id}
            title={item.name}
            detail={`${item.exerciseCount} ${item.exerciseCount === 1 ? 'exercise' : 'exercises'}`}
            swatch={item.color}
            selected={item.id === categoryId}
            onPress={() => setCategoryId(item.id)}
            onMenu={(anchor) => setMenu({ kind: 'category', item, anchor })}
          />)}
          <button type="button" onClick={() => setCreatingCategory(true)} className="flex min-h-[58px] items-center px-4 text-left hover:bg-surface-900 active:bg-surface-900">
            <Plus color={color.textSecondary} size={19} />
            <span className="ml-3 text-[16px] font-medium text-surface-200">New category</span>
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-border px-4">
            <Search color={color.textFaint} size={18} />
            <input
              aria-label="Search exercises"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && searching) {
                  event.preventDefault()
                  setQuery('')
                } else if (event.key === 'Enter' && searching && exercises[0]) {
                  event.preventDefault()
                  open(exercises[0])
                }
              }}
              placeholder={category ? `Search ${category.name}` : 'Search exercises'}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="ml-2 min-h-[52px] flex-1 bg-transparent text-[17px] text-foreground outline-none"
            />
            {searching && <IconButton label="Clear search" onClick={() => setQuery('')}><X color={color.textMuted} size={18} /></IconButton>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {exercises.map((item) => <Row
              key={item.id}
              title={item.name}
              detail={!categoryId ? item.categoryName : undefined}
              onPress={() => open(item)}
              onMenu={(anchor) => setMenu({ kind: 'exercise', item, anchor })}
            />)}
            {exercises.length === 0 && <div className="flex flex-col items-center px-8 py-10">
              <p className="text-center text-[16px] leading-6 text-muted-foreground">
                {searching ? `Nothing called "${query.trim()}".` : 'No exercises in this category yet.'}
              </p>
              <button
                type="button"
                onClick={() => editor({ ...(categoryId ? { categoryId } : {}), ...(searching ? { name: query.trim() } : {}) })}
                className="mt-4 flex min-h-12 items-center rounded-xl border border-input px-4 hover:bg-surface-900 active:bg-surface-900"
              >
                <Plus color={color.text} size={18} />
                <span className="ml-2 text-[16px] font-semibold">Create exercise</span>
              </button>
            </div>}
          </div>
        </div>
      </div>
    </GymGate>

    <PopupMenu anchor={menu?.anchor ?? null} title={menu?.item.name} items={menu ? menuItems(menu) : []} onClose={() => setMenu(null)} />
    <CategorySheet visible={creatingCategory || editingCategory !== null} category={editingCategory} onClose={() => {
      setCreatingCategory(false)
      setEditingCategory(null)
    }} />
    <ConfirmDialog
      visible={deletingExercise !== null}
      title={`Delete ${deletingExercise?.name ?? 'this exercise'}?`}
      detail={deletingExercise && deletingExercise.setCount > 0
        ? `Its ${deletingExercise.setCount} logged ${deletingExercise.setCount === 1 ? 'set disappears' : 'sets disappear'} from your history and graphs on every device.`
        : 'It leaves the list on every device.'}
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeletingExercise(null)}
      onConfirm={() => void removeExercise()}
    />
    <ConfirmDialog
      visible={deletingCategory !== null}
      title={deletingCategory && deletingCategory.exerciseCount > 0 ? 'This category has exercises' : `Delete ${deletingCategory?.name ?? 'this category'}?`}
      detail={deletingCategory && deletingCategory.exerciseCount > 0
        ? `Move or delete its ${deletingCategory.exerciseCount} ${deletingCategory.exerciseCount === 1 ? 'exercise' : 'exercises'} first.`
        : 'It leaves the list on every device.'}
      confirmLabel={deletingCategory && deletingCategory.exerciseCount > 0 ? 'OK' : 'Delete'}
      destructive={!deletingCategory || deletingCategory.exerciseCount === 0}
      onCancel={() => setDeletingCategory(null)}
      onConfirm={() => deletingCategory && deletingCategory.exerciseCount > 0 ? setDeletingCategory(null) : void removeCategory()}
    />
  </Screen>
}
