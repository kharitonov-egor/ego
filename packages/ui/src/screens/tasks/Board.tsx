import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Activity, Archive, ArchiveRestore, Ellipsis, Eye, EyeOff, ListFilter, Pencil, Plus, Tag, Trash2, X
} from 'lucide-react'
import type { TaskListRecord } from '@ego/api-contracts'
import { boardLabels, boardLists, isFiltering, listCards, matchesFilter, NO_FILTER, type CardFilter } from '@ego/local/tasks/board'
import { Screen, ScreenHeader } from '../../components/screen'
import { DragBoard } from '../../components/tasks/DragBoard'
import { BoardSheet, FilterSheet, LabelSheet, TextSheet } from '../../components/tasks/sheets'
import { MenuSheet, TasksError, TasksGate, TasksMessage } from '../../components/tasks/ui'
import { IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { activityPath, archivePath, useOpenCard } from './nav'

function Board({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const navigate = useNavigate()
  const openCard = useOpenCard()
  const [filter, setFilter] = useState<CardFilter>(NO_FILTER)
  const [filtering, setFiltering] = useState(false)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [labelling, setLabelling] = useState(false)
  const [listMenu, setListMenu] = useState<TaskListRecord | null>(null)
  const [renaming, setRenaming] = useState<TaskListRecord | null>(null)
  const [addingTop, setAddingTop] = useState<TaskListRecord | null>(null)
  const [deletingList, setDeletingList] = useState<TaskListRecord | null>(null)
  const [archiving, setArchiving] = useState(false)

  const data = tasks.data
  const board = data?.boards.find((item) => item.id === boardId)
  const active = isFiltering(filter)

  const lists = useMemo(() => data ? boardLists(data, boardId) : [], [boardId, data])
  const labels = useMemo(() => data ? boardLabels(data, boardId) : [], [boardId, data])
  const cards = useMemo(() => {
    const shown = new Map<string, ReturnType<typeof listCards>>()
    if (!data || !board) return shown
    for (const list of lists) {
      shown.set(list.id, listCards(data, list.id).filter((card) =>
        !(board.hideDone && card.doneAt !== null) && matchesFilter(card, filter, tasks.now)))
    }
    return shown
  }, [board, data, filter, lists, tasks.now])
  const matching = useMemo(() => [...cards.values()].reduce((total, list) => total + list.length, 0), [cards])

  if (!data || !board) {
    return <Screen>
      <ScreenHeader title="" back="/tasks" />
      <div className="min-h-0 flex-1">
        <TasksMessage title="This board is gone" detail="It was deleted, maybe on another device." action="Back to boards" onAction={() => navigate('/tasks')} />
      </div>
    </Screen>
  }

  return <Screen>
    <ScreenHeader title={`${board.icon ? `${board.icon} ` : ''}${board.name}`} back="/tasks" right={<>
      <IconButton label="Filter cards" onClick={() => setFiltering(true)} className="relative">
        <ListFilter size={20} />
        {active && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-white" />}
      </IconButton>
      <IconButton label="Board menu" onClick={() => setMenu(true)}><Ellipsis size={21} /></IconButton>
    </>} />
    {(tasks.error || board.archivedAt !== null || active) && <div className="flex flex-col gap-2 px-3 pt-3">
      <TasksError />
      {board.archivedAt !== null && <div className="flex items-center rounded-2xl bg-surface-900 px-4 py-3">
        <Archive color={color.textMuted} size={18} />
        <span className="ml-3 flex-1 text-[15px] text-surface-300">This board is archived.</span>
        <button type="button" onClick={() => void tasks.updateBoard(board.id, { archivedAt: null })} className="rounded-lg px-1.5 py-0.5 text-[15px] font-semibold text-white hover:bg-surface-800">Restore</button>
      </div>}
      {active && <div className="flex items-center rounded-2xl bg-surface-900 px-4 py-2.5">
        <ListFilter color={color.textMuted} size={17} />
        <span className="ml-2 flex-1 text-[15px] text-surface-300">{matching === 1 ? '1 card matches' : `${matching} cards match`}</span>
        <button type="button" aria-label="Clear the filter" onClick={() => setFilter(NO_FILTER)} className="flex items-center rounded-lg px-1.5 py-0.5 hover:bg-surface-800">
          <X color={color.text} size={16} />
          <span className="ml-1 text-[15px] font-semibold text-white">Clear</span>
        </button>
      </div>}
    </div>}
    <DragBoard
      lists={lists}
      cards={cards}
      labels={labels}
      now={tasks.now}
      uploads={data.uploads}
      onOpenCard={(id) => openCard(id)}
      onToggleDone={(id) => void tasks.updateCard(id, (input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
      onMoveCard={(cardId, listId, index, siblingIds) => void tasks.moveCard(cardId, { listId, index, siblingIds })}
      onMoveList={(listId, index) => void tasks.moveList(listId, index)}
      onAddCard={async (listId, title) => (await tasks.createCard(listId, title)) !== null}
      onListMenu={setListMenu}
      onAddList={async (name) => (await tasks.createList(boardId, name)) !== null}
    />
    <MenuSheet
      visible={menu}
      title={board.name}
      onClose={() => setMenu(false)}
      items={[
        { label: 'Name and emoji', Icon: Pencil, onPress: () => setEditing(true) },
        { label: 'Labels', Icon: Tag, onPress: () => setLabelling(true) },
        {
          label: board.hideDone ? 'Show done cards' : 'Hide done cards',
          Icon: board.hideDone ? Eye : EyeOff,
          onPress: () => void tasks.updateBoard(board.id, { hideDone: !board.hideDone })
        },
        { label: 'Activity', Icon: Activity, onPress: () => navigate(activityPath(board.id)) },
        { label: 'Archived items', Icon: ArchiveRestore, onPress: () => navigate(archivePath(board.id)) },
        board.archivedAt === null
          ? { label: 'Archive board', Icon: Archive, onPress: () => setArchiving(true) }
          : { label: 'Restore board', Icon: ArchiveRestore, onPress: () => void tasks.updateBoard(board.id, { archivedAt: null }) }
      ]}
    />
    <MenuSheet
      visible={listMenu !== null}
      title={listMenu?.name ?? ''}
      onClose={() => setListMenu(null)}
      items={listMenu ? [
        { label: 'Rename list', Icon: Pencil, onPress: () => setRenaming(listMenu) },
        { label: 'Add a card to the top', Icon: Plus, onPress: () => setAddingTop(listMenu) },
        { label: 'Archive all cards in this list', Icon: Archive, onPress: () => void tasks.archiveListCards(listMenu.id) },
        { label: 'Archive this list', Icon: Archive, onPress: () => void tasks.updateList(listMenu.id, { archivedAt: new Date().toISOString() }) },
        { label: 'Delete this list', Icon: Trash2, destructive: true, onPress: () => setDeletingList(listMenu) }
      ] : []}
    />
    <TextSheet
      visible={renaming !== null}
      title="Rename list"
      value={renaming?.name ?? ''}
      placeholder="List name"
      confirm="Save"
      onClose={() => setRenaming(null)}
      onSave={(text) => {
        if (renaming) void tasks.updateList(renaming.id, { name: text })
        setRenaming(null)
      }}
    />
    <TextSheet
      visible={addingTop !== null}
      title={`New card in ${addingTop?.name ?? ''}`}
      value=""
      placeholder="Card title"
      confirm="Add card"
      onClose={() => setAddingTop(null)}
      onSave={(text) => {
        if (addingTop) void tasks.createCard(addingTop.id, text, 'top')
        setAddingTop(null)
      }}
    />
    <BoardSheet
      visible={editing}
      title="Board"
      name={board.name}
      icon={board.icon}
      confirm="Save"
      onClose={() => setEditing(false)}
      onSave={(name, icon) => {
        setEditing(false)
        void tasks.updateBoard(board.id, { name, icon })
      }}
    />
    <LabelSheet visible={labelling} boardId={board.id} onClose={() => setLabelling(false)} />
    <FilterSheet visible={filtering} boardId={board.id} filter={filter} onChange={setFilter} onClose={() => setFiltering(false)} />
    <ConfirmDialog
      visible={deletingList !== null}
      title="Delete this list?"
      detail="Its cards go with it, on every device. Archive the list instead to keep them."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeletingList(null)}
      onConfirm={() => {
        if (deletingList) void tasks.deleteList(deletingList.id)
        setDeletingList(null)
      }}
    />
    <ConfirmDialog
      visible={archiving}
      title="Archive this board?"
      detail="It leaves the board list and stops sending reminders. Restore it from Archived boards."
      confirmLabel="Archive"
      onCancel={() => setArchiving(false)}
      onConfirm={() => {
        setArchiving(false)
        void tasks.updateBoard(board.id, { archivedAt: new Date().toISOString() }).then((saved) => { if (saved) navigate('/tasks') })
      }}
    />
  </Screen>
}

export default function BoardScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title="" back="/tasks"><Board key={id} boardId={id} /></TasksGate>
}
