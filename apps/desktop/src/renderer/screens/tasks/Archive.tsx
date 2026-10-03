import React, { useState } from 'react'
import { useParams } from 'react-router'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import type { TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import { boardLabels } from '@ego/local/tasks/board'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { CardFace, TasksError, TasksGate } from '../../components/tasks/ui'
import { ConfirmDialog } from '../../components/ui/dialog'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { boardPath, useOpenCard } from './nav'

type Target = { kind: 'card'; card: TaskCardRecord } | { kind: 'list'; list: TaskListRecord }

function Archived({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const openCard = useOpenCard()
  const [view, setView] = useState<'cards' | 'lists'>('cards')
  const [deleting, setDeleting] = useState<Target | null>(null)
  const data = tasks.data
  const header = <ScreenHeader title="Archived items" back={boardPath(boardId)} />
  if (!data) return <Screen>{header}</Screen>
  const liveLists = new Set(data.lists.filter((list) => list.boardId === boardId && list.archivedAt === null).map((list) => list.id))
  const cards = data.cards
    .filter((card) => card.boardId === boardId && card.archivedAt !== null && liveLists.has(card.listId))
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const lists = data.lists
    .filter((list) => list.boardId === boardId && list.archivedAt !== null)
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const labels = boardLabels(data, boardId)

  return <Screen>
    {header}
    <ScreenBody className="pb-10">
      <TasksError className="mb-3" />
      <SegmentedControl
        options={[{ value: 'cards', label: `Cards (${cards.length})` }, { value: 'lists', label: `Lists (${lists.length})` }]}
        value={view}
        onValueChange={setView}
      />
      <div className="mt-4 flex flex-col gap-3">
        {view === 'cards' && cards.length === 0 && <p className="text-[15px] text-muted-foreground">No archived cards. Cards in an archived list come back with the list.</p>}
        {view === 'lists' && lists.length === 0 && <p className="text-[15px] text-muted-foreground">No archived lists.</p>}
        {view === 'cards' && cards.map((card) => <div key={card.id}>
          <button type="button" onClick={() => openCard(card.id)} className="block w-full rounded-xl text-left transition-[filter] hover:brightness-125">
            <CardFace card={card} labels={labels} now={tasks.now} />
          </button>
          <div className="mt-1 flex justify-end gap-4">
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
