import React, { useState } from 'react'
import { useParams } from 'react-router'
import { ArchiveRestore, Circle, CircleCheck, Trash2 } from 'lucide-react'
import type { TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import { boardLabels } from '@ego/local/tasks/board'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { CardFace, TasksError, TasksGate } from '../../components/tasks/ui'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { boardPath, useOpenCard } from './nav'

type Target = { kind: 'card'; card: TaskCardRecord } | { kind: 'list'; list: TaskListRecord }

/** An imported board can archive thousands of cards, so they come a page at a time. */
const PAGE = 100

function shortDate(at: string): string {
  const day = new Date(at)
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

function Archived({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const openCard = useOpenCard()
  const [view, setView] = useState<'cards' | 'lists'>('cards')
  const [deleting, setDeleting] = useState<Target | null>(null)
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const data = tasks.data
  const header = <ScreenHeader title="Archived items" back={boardPath(boardId)} />
  if (!data) return <Screen>{header}</Screen>
  const liveLists = new Set(data.lists.filter((list) => list.boardId === boardId && list.archivedAt === null).map((list) => list.id))
  const query = search.trim().toLowerCase()
  const archived = data.cards
    .filter((card) => card.boardId === boardId && card.archivedAt !== null && liveLists.has(card.listId))
  const cards = archived
    .filter((card) => !query || card.title.toLowerCase().includes(query) || card.description.toLowerCase().includes(query))
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const listName = new Map(data.lists.map((list) => [list.id, list.name]))
  const lists = data.lists
    .filter((list) => list.boardId === boardId && list.archivedAt !== null)
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const labels = boardLabels(data, boardId)

  return <Screen>
    {header}
    <ScreenBody className="pb-10">
      <TasksError className="mb-3" />
      <SegmentedControl
        options={[{ value: 'cards', label: `Cards (${archived.length})` }, { value: 'lists', label: `Lists (${lists.length})` }]}
        value={view}
        onValueChange={setView}
      />
      {view === 'cards' && archived.length > 0 && <input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setShown(PAGE)
        }}
        placeholder="Search archived cards"
        aria-label="Search archived cards"
        className={`${inputClass} mt-4`}
      />}
      <div className="mt-4 flex flex-col gap-3">
        {view === 'cards' && archived.length === 0 && <p className="text-[15px] text-muted-foreground">No archived cards. Cards in an archived list come back with the list.</p>}
        {view === 'cards' && archived.length > 0 && cards.length === 0 && <p className="text-[15px] text-muted-foreground">No archived card matches.</p>}
        {view === 'lists' && lists.length === 0 && <p className="text-[15px] text-muted-foreground">No archived lists.</p>}
        {view === 'cards' && cards.slice(0, shown).map((card) => <div key={card.id}>
          <button type="button" onClick={() => openCard(card.id)} className="block w-full rounded-xl text-left transition-[filter] hover:brightness-125">
            <CardFace card={card} labels={labels} now={tasks.now} />
          </button>
          <div className="mt-1 flex items-center gap-4">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] text-surface-400">
              {card.doneAt
                ? <><CircleCheck color="#0a0a0a" fill={color.positive} size={16} className="shrink-0" /><span className="font-semibold text-positive">Done</span></>
                : <><Circle color={color.textFaint} size={16} className="shrink-0" /><span>Not done</span></>}
              <Blurred><span className="truncate">· {listName.get(card.listId) ?? 'A list'} · archived {shortDate(card.archivedAt ?? card.updatedAt)}</span></Blurred>
            </span>
            <button type="button" onClick={() => void tasks.updateCard(card.id, (input) => ({ ...input, archivedAt: null }))} className="flex min-h-11 items-center rounded-lg px-1.5 hover:bg-surface-900">
              <ArchiveRestore color={color.textSecondary} size={17} />
              <span className="ml-1.5 text-[15px] font-semibold text-surface-200">Send to board</span>
            </button>
            <button type="button" onClick={() => setDeleting({ kind: 'card', card })} className="flex min-h-11 items-center rounded-lg px-1.5 hover:bg-surface-900">
              <Trash2 color={color.destructive} size={17} />
              <span className="ml-1.5 text-[15px] font-semibold text-destructive">Delete</span>
            </button>
          </div>
        </div>)}
        {view === 'cards' && cards.length > shown && <Button variant="secondary" onClick={() => setShown((count) => count + PAGE)}>
          Show {Math.min(PAGE, cards.length - shown)} more of {cards.length - shown}
        </Button>}
        {view === 'lists' && lists.map((list) => {
          const count = data.cards.filter((card) => card.listId === list.id && card.archivedAt === null).length
          return <div key={list.id} className="flex items-center rounded-2xl bg-surface-900 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Blurred><p className="truncate text-[17px] font-semibold text-surface-100">{list.name}</p></Blurred>
              <p className="text-[14px] text-surface-500">{count === 1 ? '1 card' : `${count} cards`}</p>
            </div>
            <button type="button" aria-label={`Send ${list.name} back to the board`} title="Send to board" onClick={() => void tasks.updateList(list.id, { archivedAt: null })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800">
              <ArchiveRestore color={color.textSecondary} size={19} />
            </button>
            <button type="button" aria-label={`Delete ${list.name}`} title="Delete" onClick={() => setDeleting({ kind: 'list', list })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800">
              <Trash2 color={color.destructive} size={19} />
            </button>
          </div>
        })}
      </div>
    </ScreenBody>
    <ConfirmDialog
      visible={deleting !== null}
      title={deleting?.kind === 'list' ? 'Delete this list?' : 'Delete this card?'}
      detail={deleting?.kind === 'list' ? 'Its cards go with it, on every device. This cannot be undone.' : 'It is gone for good, on every device.'}
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting?.kind === 'list') void tasks.deleteList(deleting.list.id)
        if (deleting?.kind === 'card') void tasks.deleteCard(deleting.card.id)
        setDeleting(null)
      }}
    />
  </Screen>
}

export default function ArchiveScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title="Archived items" back={boardPath(id)}><Archived boardId={id} /></TasksGate>
}
