import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { Archive, Bell, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { TaskBoardRecord } from '@ego/api-contracts'
import { boardSummary, liveBoards } from '@ego/local/tasks/board'
import { Screen, ScreenHeader, TabLinks } from '../../components/screen'
import { ReorderList } from '../../components/tasks/ReorderList'
import { BoardSheet, TaskNotificationsSheet } from '../../components/tasks/sheets'
import { BoardIcon, TasksError, TasksGate } from '../../components/tasks/ui'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { TASKS_TABS, boardPath } from './nav'

function summaryText(open: number, dueSoon: number, overdue: number): string {
  const parts = [open === 1 ? '1 open card' : `${open} open cards`]
  if (overdue > 0) parts.push(`${overdue} overdue`)
  if (dueSoon > 0) parts.push(`${dueSoon} due soon`)
  return parts.join(' · ')
}

function BoardRow({ board, lifted }: { board: TaskBoardRecord; lifted: boolean }): React.ReactElement {
  const { data, now } = useTasks()
  const summary = data ? boardSummary(data, board.id, now) : { open: 0, dueSoon: 0, overdue: 0 }
  return <div className={cn('flex min-h-[76px] items-center rounded-3xl border-2 border-white px-4 py-3 transition-colors',
    lifted ? 'bg-surface-900' : 'bg-black hover:bg-white/[0.06]')}>
    <BoardIcon icon={board.icon} size={44} />
    <div className="ml-3 min-w-0 flex-1">
      <Blurred><p className="truncate text-[18px] font-semibold text-white">{board.name}</p></Blurred>
      <p className={cn('mt-0.5 text-[14px]', summary.overdue > 0 ? 'text-red-400' : 'text-surface-400')}>
        {summaryText(summary.open, summary.dueSoon, summary.overdue)}
      </p>
    </div>
    <ChevronRight color="#737373" size={20} />
  </div>
}

function ArchivedBoards({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const tasks = useTasks()
  const [deleting, setDeleting] = useState<TaskBoardRecord | null>(null)
  const archived = (tasks.data?.boards ?? []).filter((board) => board.archivedAt !== null)
  return <Sheet visible={visible} title="Archived boards" onClose={onClose}>
    {archived.length === 0 && <p className="text-[15px] text-muted-foreground">No archived boards.</p>}
    {archived.map((board) => <div key={board.id} className="flex min-h-16 items-center border-b border-surface-900">
      <BoardIcon icon={board.icon} size={36} />
      <Blurred><span className="ml-3 min-w-0 flex-1 truncate text-[17px] text-foreground">{board.name}</span></Blurred>
      <button type="button" aria-label={`Restore ${board.name}`} title="Restore" onClick={() => void tasks.updateBoard(board.id, { archivedAt: null })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800">
        <RotateCcw color={color.textSecondary} size={19} />
      </button>
      <button type="button" aria-label={`Delete ${board.name}`} title="Delete" onClick={() => setDeleting(board)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800">
        <Trash2 color={color.destructive} size={19} />
      </button>
    </div>)}
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this board?"
      detail="Its lists, cards, and labels go with it, on every device. This cannot be undone."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        if (deleting) void tasks.deleteBoard(deleting.id)
        setDeleting(null)
      }}
    />
  </Sheet>
}

function Boards(): React.ReactElement {
  const tasks = useTasks()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [archive, setArchive] = useState(false)

  const data = tasks.data
  const boards = data ? liveBoards(data) : []
  const archivedCount = (data?.boards ?? []).filter((board) => board.archivedAt !== null).length
  const open = (board: TaskBoardRecord): void => { void navigate(boardPath(board.id)) }

  return <Screen>
    <ScreenHeader title="Tasks" tabs={<TabLinks items={TASKS_TABS} />} right={<>
      <IconButton label="Notifications" onClick={() => setNotifications(true)}><Bell size={20} /></IconButton>
      <IconButton label="New board" onClick={() => setCreating(true)}><Plus size={23} /></IconButton>
    </>} />
    {boards.length === 0
      ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <TasksError className="mb-4 max-w-md" />
        <h2 className="text-[20px] font-semibold text-surface-100">No boards yet</h2>
        <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">
          A board holds lists, and lists hold cards. New boards start with To Do, Doing, and Done.
        </p>
        <Button className="mt-5" onClick={() => setCreating(true)}><Plus color="#0a0a0a" size={18} />Create a board</Button>
        {archivedCount > 0 && <Button variant="ghost" className="mt-2" onClick={() => setArchive(true)}>Archived boards</Button>}
      </div>
      : <ReorderList
        items={boards}
        label={(board) => board.name}
        onPress={open}
        onMove={(id, index) => void tasks.moveBoard(id, index)}
        renderItem={(board, lifted) => <BoardRow board={board} lifted={lifted} />}
        header={<TasksError className="mb-3" />}
        footer={<div className="mt-4 flex flex-col gap-3">
          <button type="button" onClick={() => setCreating(true)} className="flex min-h-14 items-center justify-center rounded-3xl border border-dashed border-surface-600 transition-colors hover:bg-surface-900 active:bg-surface-900">
            <Plus color={color.textMuted} size={20} />
            <span className="ml-2 text-[16px] font-semibold text-surface-300">New board</span>
          </button>
          {archivedCount > 0 && <button type="button" onClick={() => setArchive(true)} className="flex min-h-12 items-center justify-center rounded-2xl hover:bg-surface-900 active:opacity-70">
            <Archive color={color.textFaint} size={17} />
            <span className="ml-2 text-[15px] text-surface-500">{archivedCount === 1 ? '1 archived board' : `${archivedCount} archived boards`}</span>
          </button>}
        </div>}
      />}
    <BoardSheet
      visible={creating}
      title="New board"
      name=""
      icon="📋"
      confirm="Create"
      onClose={() => setCreating(false)}
      onSave={(name, icon) => {
        setCreating(false)
        void tasks.createBoard(name, icon).then((id) => { if (id) navigate(boardPath(id)) })
      }}
    />
    <TaskNotificationsSheet visible={notifications} onClose={() => setNotifications(false)} />
    <ArchivedBoards visible={archive} onClose={() => setArchive(false)} />
  </Screen>
}

export default function BoardsScreen(): React.ReactElement {
  return <TasksGate title="Tasks" tabs={<TabLinks items={TASKS_TABS} />}><Boards /></TasksGate>
}
