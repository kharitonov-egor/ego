import React, { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Activity, Archive, ArchiveRestore, Briefcase, Ellipsis, Eye, EyeOff, GraduationCap, Inbox, LayoutGrid, ListChecks, ListFilter,
  Pencil, Plus, Tag, Trash2, X
} from 'lucide-react'
import type { TaskListRecord } from '@ego/api-contracts'
import {
  boardLabels, boardLists, doneList, homeBoardId, isFiltering, listCards, matchesFilter, NO_FILTER, type CardFilter
} from '@ego/local/tasks/board'
import { Screen, ScreenHeader } from '../../components/screen'
import { DragBoard, type ListExtras } from '../../components/tasks/DragBoard'
import { QuickEdit, type QuickEditTarget } from '../../components/tasks/QuickEdit'
import { BoardSheet, FilterSheet, LabelSheet, TextSheet } from '../../components/tasks/sheets'
import { MenuSheet, TasksError, TasksGate, TasksMessage, type MenuItem } from '../../components/tasks/ui'
import { NO_USF_FILTER, UsfAssignments, UsfControls, UsfRefresh, inCourse, type UsfFilter } from '../../components/tasks/UsfColumn'
import { WorkProblem, WorkRefresh } from '../../components/tasks/WorkColumn'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { StudyProvider } from '../../lib/study/context'
import { useTasks } from '../../lib/tasks/context'
import { useTrelloWork } from '../../lib/tasks/trello-work'
import { color } from '../../lib/tokens'
import { CardPanel } from './Card'
import { BOARDS_PATH, activityPath, archivePath } from './nav'

function openedHere(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'panel' in state && state.panel === true
}

/** Canvas is read only for a board that shows it. */
function MaybeStudy({ active, children }: { active: boolean; children: React.ReactNode }): React.ReactElement {
  return active ? <StudyProvider>{children}</StudyProvider> : <>{children}</>
}

function Board({ boardId }: { boardId: string }): React.ReactElement {
  const tasks = useTasks()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [quick, setQuick] = useState<QuickEditTarget | null>(null)
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
  const [usfFilter, setUsfFilter] = useState<UsfFilter>(NO_USF_FILTER)

  const data = tasks.data
  const board = data?.boards.find((item) => item.id === boardId)
  const active = isFiltering(filter)
  const isHome = data ? homeBoardId(data) === boardId : false

  const lists = useMemo(() => data ? boardLists(data, boardId) : [], [boardId, data])
  const labels = useMemo(() => data ? boardLabels(data, boardId) : [], [boardId, data])
  const hasUsf = lists.some((list) => list.kind === 'usf')
  const trelloWork = useTrelloWork(lists.some((list) => list.kind === 'work'))
  const cards = useMemo(() => {
    const shown = new Map<string, ReturnType<typeof listCards>>()
    if (!data || !board) return shown
    const labelName = new Map(labels.map((label) => [label.id, label.name]))
    for (const list of lists) {
      const course = list.kind === 'usf' ? usfFilter.course : null
      shown.set(list.id, listCards(data, list.id).filter((card) =>
        !(board.hideDone && card.doneAt !== null) && matchesFilter(card, filter, tasks.now) &&
        (course === null || inCourse(card.labelIds.map((id) => labelName.get(id) ?? ''), course))))
    }
    return shown
  }, [board, data, filter, labels, lists, tasks.now, usfFilter.course])
  const listExtras = (list: TaskListRecord): ListExtras | null => {
    if (list.kind === 'usf') {
      return {
        action: <UsfRefresh />,
        top: <UsfControls filter={usfFilter} onChange={setUsfFilter} now={tasks.now} />,
        bottom: <UsfAssignments filter={usfFilter} now={tasks.now} />
      }
    }
    if (list.kind === 'work') {
      return { action: <WorkRefresh work={trelloWork} />, top: trelloWork.problem ? <WorkProblem text={trelloWork.problem} /> : undefined }
    }
    return null
  }
  const kindItems = (list: TaskListRecord): MenuItem[] => [
    ...(list.kind === 'inbox' ? [] : [{ label: 'Make this the Inbox', Icon: Inbox, onPress: () => void tasks.setListKind(list.id, 'inbox') }]),
    list.kind === 'usf'
      ? { label: 'Stop showing Canvas assignments', Icon: GraduationCap, onPress: () => void tasks.setListKind(list.id, 'cards') }
      : { label: 'Show Canvas assignments here', Icon: GraduationCap, onPress: () => void tasks.setListKind(list.id, 'usf') },
    list.kind === 'work'
      ? { label: 'Stop syncing with work Trello', Icon: Briefcase, onPress: () => void tasks.setListKind(list.id, 'cards') }
      : { label: 'Sync with work Trello', Icon: Briefcase, onPress: () => void tasks.setListKind(list.id, 'work') }
  ]
  const matching = useMemo(() => [...cards.values()].reduce((total, list) => total + list.length, 0), [cards])

  const panelCardId = params.get('card')
  const openCard = useCallback((cardId: string): void => setParams({ card: cardId }, { state: { panel: true } }), [setParams])
  const switchCard = (cardId: string): void => setParams({ card: cardId }, { replace: true, state: location.state })
  const closePanel = (): void => {
    if (openedHere(location.state)) void navigate(-1)
    else setParams({}, { replace: true })
  }
  const closeQuick = useCallback(() => setQuick(null), [])
  const toggleMoveDone = (): void => {
    if (!data || !board) return
    const on = !board.moveDone
    void tasks.updateBoard(board.id, { moveDone: on })
    if (on && !doneList(data, board.id)) void tasks.createList(board.id, 'Done')
  }

  if (!data || !board) {
    return <Screen>
      <ScreenHeader title="" back={BOARDS_PATH} />
      <div className="min-h-0 flex-1">
        <TasksMessage title="This board is gone" detail="It was deleted, maybe on another device." action="Back to boards" onAction={() => navigate(BOARDS_PATH)} />
      </div>
    </Screen>
  }

  return <Screen>
    <ScreenHeader title={`${board.icon ? `${board.icon} ` : ''}${board.name}`} back={isHome ? undefined : BOARDS_PATH} right={<>
      {isHome && <Button variant="ghost" size="sm" onClick={() => navigate(BOARDS_PATH)} className="text-surface-300">
        <LayoutGrid size={16} />All boards
      </Button>}
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
    <MaybeStudy active={hasUsf}><DragBoard
      lists={lists}
      cards={cards}
      labels={labels}
      now={tasks.now}
      uploads={data.uploads}
      onOpenCard={openCard}
      onCardMenu={(cardId, rect) => setQuick({ cardId, rect: { top: rect.top, left: rect.left, width: rect.width } })}
      onToggleDone={(id) => void tasks.updateCard(id, (input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
      onMoveCard={(cardId, listId, index, siblingIds) => void tasks.moveCard(cardId, { listId, index, siblingIds })}
      onMoveList={(listId, index) => void tasks.moveList(listId, index)}
      onAddCard={async (listId, title) => (await tasks.createCard(listId, title)) !== null}
      onListMenu={setListMenu}
      onAddList={async (name) => (await tasks.createList(boardId, name)) !== null}
      listExtras={listExtras}
    /></MaybeStudy>
    {quick && <QuickEdit target={quick} onOpen={openCard} onClose={closeQuick} />}
    {panelCardId && <CardPanel cardId={panelCardId} onClose={closePanel} onOpenCard={switchCard} />}
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
        { label: 'Move done cards to Done', Icon: ListChecks, checked: board.moveDone, onPress: toggleMoveDone },
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
        ...kindItems(listMenu),
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
        void tasks.updateBoard(board.id, { archivedAt: new Date().toISOString() }).then((saved) => { if (saved) navigate(BOARDS_PATH) })
      }}
    />
  </Screen>
}

export default function BoardScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title="" back={BOARDS_PATH}><Board key={id} boardId={id} /></TasksGate>
}
