import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Activity, AlignLeft, Archive, ArchiveRestore, ArrowRightLeft, Check, Clock, Copy, Ellipsis, Flag, Paperclip, Plus,
  SquareCheckBig, Tag, Trash2, type LucideIcon
} from 'lucide-react'
import { TASK_PRIORITY_LABELS, taskReminderLabel } from '@ego/core'
import { newId } from '@ego/local/sync/commands'
import { boardLabels, coverOf, dueBadge } from '@ego/local/tasks/board'
import { toggleTaskLine } from '@ego/local/tasks/markdown'
import { Screen, ScreenHeader } from '../../components/screen'
import { ActivityRow } from '../../components/tasks/ActivityList'
import { CardAttachments } from '../../components/tasks/CardAttachments'
import { Checklists } from '../../components/tasks/Checklists'
import { MarkdownEditor, MarkdownView } from '../../components/tasks/Markdown'
import { DueSheet, LabelSheet, MoveSheet, PrioritySheet, TextSheet } from '../../components/tasks/sheets'
import {
  DueChip, LabelChip, MenuSheet, PriorityIcon, SectionTitle, TaskImage, TasksError, TasksGate, TasksMessage, TextAction,
  imageVersion
} from '../../components/tasks/ui'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Blurred, useBlur } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { transferredFiles } from '../../lib/tasks/files'
import { color } from '../../lib/tokens'
import { BOARDS_PATH, boardPath, useBack, useOpenCard } from './nav'

const ACTIVITY_PAGE = 5

function Action({ Icon, label, onPress }: { Icon: LucideIcon; label: string; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    onClick={onPress}
    className="inline-flex min-h-11 items-center rounded-xl bg-surface-900 px-3.5 transition-colors hover:bg-surface-800 active:bg-surface-800"
  >
    <Icon color={color.textSecondary} size={17} />
    <span className="ml-2 text-[15px] font-semibold text-surface-200">{label}</span>
  </button>
}

function SmallHeading({ children }: { children: string }): React.ReactElement {
  return <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-surface-500">{children}</h3>
}

function hasFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
}

function CardDetail({ cardId }: { cardId: string }): React.ReactElement {
  const tasks = useTasks()
  const { blurred } = useBlur()
  const navigate = useNavigate()
  const openCard = useOpenCard()
  const card = tasks.data?.cards.find((item) => item.id === cardId)
  const board = tasks.data?.boards.find((item) => item.id === card?.boardId)
  const list = tasks.data?.lists.find((item) => item.id === card?.listId)
  const back = useBack(card ? boardPath(card.boardId) : BOARDS_PATH)
  const [title, setTitle] = useState(card?.title ?? '')
  const [describing, setDescribing] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'labels' | 'due' | 'priority' | 'move' | 'copy' | 'checklist' | 'menu' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [allActivity, setAllActivity] = useState(false)
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const reverting = useRef(false)
  const addFiles = tasks.addFiles

  const savedTitle = card?.title
  useEffect(() => { if (savedTitle !== undefined) setTitle(savedTitle) }, [savedTitle])

  const present = card !== undefined
  useEffect(() => {
    if (!present) return
    const onPaste = (event: ClipboardEvent): void => {
      const files = event.clipboardData ? transferredFiles(event.clipboardData) : []
      if (files.length === 0) return
      if (isEditable(event.target) && event.clipboardData?.types.includes('text/plain')) return
      event.preventDefault()
      void addFiles(cardId, files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles, cardId, present])

  const labels = useMemo(() => tasks.data && card ? boardLabels(tasks.data, card.boardId) : [], [card, tasks.data])
  if (!tasks.data || !card) {
    return <Screen>
      <ScreenHeader title="" back={back} />
      <div className="min-h-0 flex-1">
        <TasksMessage title="This card is gone" detail="It was deleted, maybe on another device." action="Back" onAction={() => navigate(back)} />
      </div>
    </Screen>
  }

  const update = tasks.updateCard.bind(null, card.id)
  const done = card.doneAt !== null
  const due = dueBadge(card, tasks.now)
  const cover = coverOf(card)
  const shownLabels = card.labelIds.flatMap((id) => labels.filter((label) => label.id === id))
  const activity = [...card.activity].reverse()

  const saveTitle = (): void => {
    const next = title.trim()
    if (!next) {
      setTitle(card.title)
      return
    }
    if (next !== card.title) void update((input) => ({ ...input, title: next }))
  }

  const saveDescription = (): void => {
    const next = describing
    setDescribing(null)
    if (next !== null && next !== card.description) void update((input) => ({ ...input, description: next }))
  }

  return <Screen>
    <ScreenHeader title={list ? list.name : ''} back={back} right={
      <IconButton label="Card menu" onClick={() => setSheet('menu')}><Ellipsis size={21} /></IconButton>
    } />
    <div
      className="relative min-h-0 flex-1"
      onDragEnter={(event) => { if (hasFiles(event)) setDropping(true) }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropping(false) }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDropping(false)
        const files = transferredFiles(event.dataTransfer)
        if (files.length > 0) void addFiles(card.id, files)
      }}
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 pb-12 pt-4">
          {cover && !blurred && <TaskImage mediaId={cover.mediaId} version={imageVersion(card, tasks.data.uploads.get(card.id))} className="mb-4 h-[190px] w-full rounded-2xl bg-card" />}
          <TasksError className="mb-3" />
          {card.archivedAt !== null && <div className="mb-3 flex items-center rounded-2xl bg-surface-900 px-4 py-3">
            <Archive color={color.textMuted} size={18} />
            <span className="ml-3 flex-1 text-[15px] text-surface-300">This card is archived.</span>
            <TextAction onClick={() => void update((input) => ({ ...input, archivedAt: null }))}>Send to board</TextAction>
          </div>}
          {blurred
            ? <Blurred><h1 className="text-[24px] font-bold leading-8 text-white">{card.title}</h1></Blurred>
            : <textarea
              value={title}
              onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
              onBlur={() => {
                if (!reverting.current) saveTitle()
                else setTitle(card.title)
                reverting.current = false
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== 'Escape') return
                event.preventDefault()
                reverting.current = event.key === 'Escape'
                event.currentTarget.blur()
              }}
              rows={1}
              aria-label="Card title"
              maxLength={500}
              className="-mx-2 block w-[calc(100%+16px)] resize-none rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[24px] font-bold leading-8 text-white outline-none transition-colors [field-sizing:content] hover:bg-surface-900 focus:border-surface-600 focus:bg-surface-900"
            />}
          <button type="button" onClick={() => setSheet('move')} className="mt-1 rounded-md py-1 text-left text-[15px] text-surface-400 hover:text-surface-300">
            in list <span className="font-semibold text-surface-200 underline">{list?.name ?? 'a list'}</span>{board ? ` on ${board.icon ? `${board.icon} ` : ''}${board.name}` : ''}
          </button>

          <Button
            size="lg"
            variant={done ? 'default' : 'outline'}
            className="mt-4 w-full"
            aria-pressed={done}
            onClick={() => void update((input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
          >
            {done ? <Check color="#0a0a0a" size={20} strokeWidth={3} /> : <Check color="#fafafa" size={20} />}
            {done ? 'Done' : 'Mark done'}
          </Button>

          <div className="mt-4 flex flex-wrap gap-2">
            <Action Icon={Tag} label="Labels" onPress={() => setSheet('labels')} />
            <Action Icon={Clock} label="Dates" onPress={() => setSheet('due')} />
            <Action Icon={Flag} label="Priority" onPress={() => setSheet('priority')} />
            <Action Icon={SquareCheckBig} label="Checklist" onPress={() => setSheet('checklist')} />
            <Action Icon={Paperclip} label="Attachment" onPress={() => picker.current?.click()} />
          </div>

          {(shownLabels.length > 0 || card.priority !== 'none' || due) && <div className="mt-5 flex flex-col items-start gap-4">
            {shownLabels.length > 0 && <div>
              <SmallHeading>Labels</SmallHeading>
              <div className="flex flex-wrap items-center gap-2">
                {shownLabels.map((label) => <button key={label.id} type="button" onClick={() => setSheet('labels')} className="rounded-full hover:opacity-85"><LabelChip label={label} size="large" /></button>)}
                <button type="button" aria-label="Edit labels" title="Edit labels" onClick={() => setSheet('labels')} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-900 hover:bg-surface-800">
                  <Plus color={color.textMuted} size={18} />
                </button>
              </div>
            </div>}
            {card.priority !== 'none' && <button type="button" onClick={() => setSheet('priority')} className="text-left">
              <SmallHeading>Priority</SmallHeading>
              <span className="flex items-center rounded-md bg-surface-900 px-2.5 py-1.5 hover:bg-surface-800">
                <PriorityIcon priority={card.priority} size={16} />
                <span className="ml-2 text-[15px] font-semibold text-surface-200">{TASK_PRIORITY_LABELS[card.priority]}</span>
              </span>
            </button>}
            {due && <button type="button" onClick={() => setSheet('due')} className="text-left">
              <SmallHeading>Due</SmallHeading>
              <span className="flex items-center gap-2">
                <DueChip due={due} large />
                {card.reminderMinutes !== null && !done && <span className="text-[14px] text-surface-500">Reminder: {taskReminderLabel(card.reminderMinutes, card.dueTime !== null).toLowerCase()}</span>}
              </span>
            </button>}
          </div>}

          <SectionTitle Icon={AlignLeft} title="Description" right={describing === null && card.description.trim() !== '' && !blurred
            ? <TextAction onClick={() => setDescribing(card.description)}>Edit</TextAction>
            : undefined} />
          {describing !== null
            ? <div>
              <MarkdownEditor value={describing} onChange={setDescribing} onSave={saveDescription} onCancel={() => setDescribing(null)} />
              <div className="mt-3 flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDescribing(null)}>Cancel</Button>
                <Button className="flex-1" onClick={saveDescription}>Save</Button>
              </div>
              <p className="mt-2 text-[13px] leading-5 text-surface-500">Markdown: **bold**, _italic_, ~~strike~~, `code`, # heading, - list, - [ ] checkbox, [link](https://...)</p>
            </div>
            : card.description.trim() === ''
              ? <button type="button" onClick={() => setDescribing('')} className="flex min-h-16 w-full items-center rounded-xl bg-surface-900 px-4 text-left transition-colors hover:bg-surface-800">
                <span className="text-[15px] text-surface-500">Add a more detailed description...</span>
              </button>
              : <div onDoubleClick={(event) => {
                if (blurred || (event.target instanceof Element && event.target.closest('a, button'))) return
                setDescribing(card.description)
              }}>
                <MarkdownView source={card.description} onToggleTask={(line) => void update((input) => ({ ...input, description: toggleTaskLine(input.description, line) }))} />
              </div>}

          <Checklists card={card} />

          {card.attachments.length > 0 && <>
            <SectionTitle Icon={Paperclip} title="Attachments" right={<TextAction onClick={() => picker.current?.click()}>Add</TextAction>} />
            <CardAttachments card={card} />
          </>}

          <SectionTitle Icon={Activity} title="Activity" />
          {activity.slice(0, allActivity ? activity.length : ACTIVITY_PAGE).map((entry, index) => <ActivityRow key={`${entry.at}-${index}`} entry={entry} now={tasks.now} />)}
          {activity.length === 0 && <p className="text-[15px] text-surface-500">Nothing yet.</p>}
          {activity.length > ACTIVITY_PAGE && <button type="button" onClick={() => setAllActivity(!allActivity)} className="mt-1 flex min-h-11 items-center rounded-lg text-[15px] font-semibold text-white hover:text-surface-300">
            {allActivity ? 'Show less' : `Show all ${activity.length}`}
          </button>}
        </div>
      </div>
      {dropping && <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-3xl border-2 border-dashed border-surface-400 bg-black/80">
        <span className="flex items-center gap-2 text-[17px] font-semibold text-white"><Paperclip size={20} />Drop files to attach them</span>
      </div>}
    </div>
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        if (files.length > 0) void addFiles(card.id, files)
      }}
    />

    <LabelSheet
      visible={sheet === 'labels'}
      boardId={card.boardId}
      selected={card.labelIds}
      onToggle={(labelId) => void update((input) => ({
        ...input,
        labelIds: input.labelIds.includes(labelId) ? input.labelIds.filter((id) => id !== labelId) : [...input.labelIds, labelId]
      }))}
      onClose={() => setSheet(null)}
    />
    <DueSheet
      visible={sheet === 'due'}
      card={card}
      onSave={(value) => void update((input) => ({ ...input, ...value }))}
      onClose={() => setSheet(null)}
    />
    <PrioritySheet
      visible={sheet === 'priority'}
      value={card.priority}
      onChange={(priority) => void update((input) => ({ ...input, priority }))}
      onClose={() => setSheet(null)}
    />
    <MoveSheet visible={sheet === 'move'} mode="move" card={card} onDone={() => undefined} onClose={() => setSheet(null)} />
    <MoveSheet
      visible={sheet === 'copy'}
      mode="copy"
      card={card}
      onDone={(id) => openCard(id, { back })}
      onClose={() => setSheet(null)}
    />
    <TextSheet
      visible={sheet === 'checklist'}
      title="Add checklist"
      value="Checklist"
      placeholder="Checklist title"
      confirm="Add"
      onClose={() => setSheet(null)}
      onSave={(text) => {
        setSheet(null)
        void update((input) => ({ ...input, checklists: [...input.checklists, { id: newId(), title: text.trim(), items: [] }] }))
      }}
    />
    <MenuSheet visible={sheet === 'menu'} title={card.title} onClose={() => setSheet(null)} items={[
      { label: 'Move', Icon: ArrowRightLeft, onPress: () => setSheet('move') },
      { label: 'Copy', Icon: Copy, onPress: () => setSheet('copy') },
      card.archivedAt === null
        ? { label: 'Archive', Icon: Archive, onPress: () => void update((input) => ({ ...input, archivedAt: new Date().toISOString() })) }
        : { label: 'Send to board', Icon: ArchiveRestore, onPress: () => void update((input) => ({ ...input, archivedAt: null })) },
      { label: 'Delete', Icon: Trash2, destructive: true, onPress: () => setDeleting(true) }
    ]} />
    <ConfirmDialog
      visible={deleting}
      title="Delete this card?"
      detail="It is gone for good, on every device, with its checklists and activity. Archive it instead to keep it."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(false)}
      onConfirm={() => {
        setDeleting(false)
        navigate(back)
        void tasks.deleteCard(card.id)
      }}
    />
  </Screen>
}

export default function CardScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title=""><CardDetail key={id} cardId={id} /></TasksGate>
}
