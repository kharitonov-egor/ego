import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Brain, Trash2 } from 'lucide-react'
import { AGENT_MEMORY_MAX_CHARS, type AgentMemory } from '@ego/api-contracts'
import { CenteredMessage, Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { Spinner } from '../../components/ui/spinner'
import { useAutosize } from '../../hooks/useAutosize'
import { dayLabel, noteCount, putFirst, sourceLabel } from '../../lib/agent'
import { Blurred } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'
import { useBackPath } from '../money/header'

const FIELD = cn(inputClass, 'block max-h-48 resize-none leading-6')

function keys(submit: () => void, cancel?: () => void): (event: React.KeyboardEvent<HTMLTextAreaElement>) => void {
  return (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape' && cancel) {
      event.preventDefault()
      cancel()
    }
  }
}

function Counter({ length }: { length: number }): React.ReactElement {
  return <span className={cn('tabular text-[13px]', length >= AGENT_MEMORY_MAX_CHARS ? 'text-attention' : 'text-surface-500')}>
    {length}/{AGENT_MEMORY_MAX_CHARS}
  </span>
}

function AddNote({ onAdd }: { onAdd: (text: string) => Promise<boolean> }): React.ReactElement {
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  useAutosize(field, text)

  const add = async (): Promise<void> => {
    const note = text.trim()
    if (!note || saving) return
    setSaving(true)
    const saved = await onAdd(note)
    setSaving(false)
    if (saved) setText('')
    field.current?.focus()
  }

  return <div className="mt-4">
    <textarea
      ref={field}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={keys(() => void add())}
      rows={1}
      maxLength={AGENT_MEMORY_MAX_CHARS}
      readOnly={saving}
      aria-label="New note"
      placeholder="Something Ego should know about you"
      className={FIELD}
    />
    <div className="mt-2 flex items-center justify-between gap-3">
      <Counter length={text.length} />
      <Button disabled={saving || !text.trim()} onClick={() => void add()}>{saving ? 'Saving...' : 'Add'}</Button>
    </div>
  </div>
}

function NoteEditor({ memory, onSave, onCancel }: {
  memory: AgentMemory
  /** Resolves to the server's message when the note was not saved. */
  onSave: (text: string) => Promise<string | null>
  onCancel: () => void
}): React.ReactElement {
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(memory.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useAutosize(field, text)

  useEffect(() => {
    const area = field.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [])

  const save = async (): Promise<void> => {
    if (saving) return
    const next = text.trim()
    if (next === memory.text) {
      onCancel()
      return
    }
    setSaving(true)
    const problem = await onSave(next)
    if (problem) {
      setSaving(false)
      setError(problem)
    }
  }

  return <div className="border-t border-surface-800 py-3 first:border-t-0">
    <textarea
      ref={field}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={keys(() => void save(), onCancel)}
      rows={1}
      maxLength={AGENT_MEMORY_MAX_CHARS}
      readOnly={saving}
      aria-label="Note"
      className={FIELD}
    />
    <div className="mt-2 flex items-center gap-2">
      <Counter length={text.length} />
      <span className="flex-1 text-[13px] text-surface-500">Enter saves, Escape cancels</span>
      <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>Cancel</Button>
      <Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Save'}</Button>
    </div>
    {error && <p role="alert" className="mt-2 text-[15px] leading-5 text-destructive">{error}</p>}
  </div>
}

function NoteRow({ memory, onEdit, onDelete }: { memory: AgentMemory; onEdit: () => void; onDelete: () => void }): React.ReactElement {
  return <div className="flex items-start gap-2 border-t border-surface-800 py-1.5 first:border-t-0">
    <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-surface-900">
      <Blurred><span className="block whitespace-pre-wrap break-words text-[16px] leading-6">{memory.text}</span></Blurred>
      <span className="mt-0.5 block text-[13px] text-muted-foreground">{sourceLabel(memory.source)} · {dayLabel(memory.updatedAt)}</span>
    </button>
    <IconButton label="Delete note" onClick={onDelete} className="mt-1.5"><Trash2 size={17} /></IconButton>
  </div>
}

function Empty(): React.ReactElement {
  return <div className="mt-12 flex flex-col items-center px-6 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Brain color="#a3a3a3" size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">No notes yet</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">
      The chat and Claude save short facts about you here as you talk. You can add your own above.
    </p>
  </div>
}

/** The short notes the chat and Claude keep about the user, which both read before they answer. */
export default function Memory(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const back = useBackPath('/ai')
  const [memories, setMemories] = useState<AgentMemory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentMemory | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.agentMemories()
    if (result.ok) {
      setMemories(result.data.memories)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    if (ledger.enabled) void load()
  }, [ledger.enabled, load])

  const add = async (text: string): Promise<boolean> => {
    const result = await ledger.api.addAgentMemory(text)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    setMemories((current) => putFirst(current ?? [], result.data))
    setError(null)
    return true
  }

  const save = async (memory: AgentMemory, text: string): Promise<string | null> => {
    const result = await ledger.api.updateAgentMemory(memory.id, text)
    if (!result.ok) return result.error.message
    const saved = result.data
    setMemories((current) => (current ?? []).map((item) => item.id === saved.id ? saved : item))
    setEditing(null)
    return null
  }

  const remove = async (): Promise<void> => {
    if (!deleting) return
    const gone = deleting
    setBusy(true)
    const result = await ledger.api.deleteAgentMemory(gone.id)
    setBusy(false)
    setDeleting(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') {
      setError(result.error.message)
      return
    }
    setMemories((current) => (current ?? []).filter((item) => item.id !== gone.id))
    setEditing((current) => current === gone.id ? null : current)
  }

  const header = <ScreenHeader title="Memory" back={back} />

  if (!ledger.loaded) {
    return <Screen>
      {header}
      <div className="flex flex-1 items-center justify-center"><Spinner /></div>
    </Screen>
  }

  if (!ledger.enabled) {
    return <Screen>
      {header}
      <CenteredMessage
        Icon={Brain}
        title="Sign in to see what Ego remembers"
        detail="Sign in once with Google on Home."
        action="Go to sign in"
        onAction={() => navigate('/')}
      />
    </Screen>
  }

  return <Screen>
    {header}
    <ScreenBody className="pb-10">
      <p className="text-[15px] leading-6 text-muted-foreground">
        The chat and Claude read these notes before they answer, so they know you without asking again. Click a note to edit it.
      </p>
      <AddNote onAdd={add} />
      {error && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{error}</p>}
      {memories === null && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {memories !== null && memories.length === 0 && <Empty />}
      {memories !== null && memories.length > 0 && <>
        <h2 className="mb-1 mt-8 text-[13px] font-semibold uppercase tracking-wide text-surface-400">{noteCount(memories.length)}</h2>
        <div>{memories.map((memory) => memory.id === editing
          ? <NoteEditor
            key={memory.id}
            memory={memory}
            onSave={(text) => save(memory, text)}
            onCancel={() => setEditing(null)}
          />
          : <NoteRow
            key={memory.id}
            memory={memory}
            onEdit={() => setEditing(memory.id)}
            onDelete={() => setDeleting(memory)}
          />)}</div>
      </>}
    </ScreenBody>
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this note?"
      detail="The chat and Claude stop seeing it. They may save it again if it comes up later."
      confirmLabel="Delete"
      destructive
      busy={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove()}
    />
  </Screen>
}
