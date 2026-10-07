import React, { useState } from 'react'
import { Check, Ellipsis, Eye, EyeOff, Pencil, Plus, SquareCheckBig, Trash2, X } from 'lucide-react'
import type { TaskCardRecord } from '@ego/api-contracts'
import type { TaskChecklist, TaskChecklistItem } from '@ego/core'
import { newId } from '@ego/local/sync/commands'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { TextSheet } from './sheets'
import { MenuSheet } from './ui'

function Box({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    onClick={onPress}
    className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
      checked ? 'border-transparent bg-primary' : 'border-surface-500 hover:border-surface-300')}
  >{checked && <Check color="#0a0a0a" size={16} strokeWidth={3} />}</button>
}

const FIELD = 'min-h-11 w-full rounded-xl border border-input bg-surface-900 px-3 py-2 text-[16px] text-foreground outline-none focus:border-surface-400'

function Item({ item, onToggle, onRename, onDelete }: {
  item: TaskChecklistItem
  onToggle: () => void
  onRename: (text: string) => void
  onDelete: () => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const done = item.doneAt !== null
  const save = (): void => {
    if (text.trim()) onRename(text.trim())
    setEditing(false)
  }
  const cancel = (): void => {
    setText(item.text)
    setEditing(false)
  }
  if (editing) {
    return <div className="py-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        autoFocus
        rows={1}
        maxLength={500}
        aria-label="Item text"
        className={cn(FIELD, 'resize-none [field-sizing:content]')}
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={save} className="min-h-10 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90">Save</button>
        <button type="button" aria-label="Delete item" title="Delete item" onClick={onDelete} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-surface-800">
          <Trash2 color={color.destructive} size={18} />
        </button>
        <button type="button" aria-label="Cancel" title="Cancel" onClick={cancel} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-surface-800">
          <X color={color.textMuted} size={18} />
        </button>
      </div>
    </div>
  }
  return <div className="flex min-h-11 items-center py-1.5">
    <Box checked={done} onPress={onToggle} label={item.text} />
    <button
      type="button"
      onClick={() => {
        setText(item.text)
        setEditing(true)
      }}
      className="ml-3 min-w-0 flex-1 rounded-md text-left hover:bg-surface-900"
    >
      <Blurred>
        <span className={cn('block whitespace-pre-wrap break-words text-[16px] leading-6', done ? 'text-surface-500 line-through' : 'text-surface-200')}>{item.text}</span>
      </Blurred>
    </button>
  </div>
}

function Checklist({ checklist, onChange, onDelete }: {
  checklist: TaskChecklist
  /** Applied to the checklist as last saved, so two quick clicks both land. */
  onChange: (change: (current: TaskChecklist) => TaskChecklist) => void
  onDelete: () => void
}): React.ReactElement {
  const [hideChecked, setHideChecked] = useState(false)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const done = checklist.items.filter((item) => item.doneAt !== null).length
  const total = checklist.items.length
  const share = total === 0 ? 0 : Math.round(done / total * 100)
  const items = hideChecked ? checklist.items.filter((item) => item.doneAt === null) : checklist.items
  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    const id = newId()
    onChange((current) => ({ ...current, items: [...current.items, { id, text, doneAt: null }] }))
    setDraft('')
  }
  const stopAdding = (): void => {
    setAdding(false)
    setDraft('')
  }
  const changeItem = (id: string, change: (item: TaskChecklistItem) => TaskChecklistItem | null): void => {
    onChange((current) => ({ ...current, items: current.items.flatMap((item) => {
      if (item.id !== id) return [item]
      const next = change(item)
      return next ? [next] : []
    }) }))
  }
  return <div className="mt-5">
    <div className="flex items-center">
      <SquareCheckBig color={color.textMuted} size={18} />
      <Blurred><h3 className="ml-2 line-clamp-2 min-w-0 flex-1 text-[17px] font-semibold text-surface-100">{checklist.title}</h3></Blurred>
      <button type="button" aria-label={`${checklist.title} menu`} onClick={() => setMenu(true)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-900">
        <Ellipsis color={color.textMuted} size={20} />
      </button>
    </div>
    <div className="mt-1 flex items-center">
      <span className="tabular w-10 text-[13px] font-semibold text-surface-400">{share}%</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-800">
        <div className="h-2 transition-[width]" style={{ width: `${share}%`, backgroundColor: share === 100 ? '#fafafa' : '#a3a3a3' }} />
      </div>
    </div>
    <div className="mt-1">
      {items.map((item) => <Item
        key={item.id}
        item={item}
        onToggle={() => changeItem(item.id, (current) => ({ ...current, doneAt: current.doneAt ? null : new Date().toISOString() }))}
        onRename={(text) => changeItem(item.id, (current) => ({ ...current, text }))}
        onDelete={() => changeItem(item.id, () => null)}
      />)}
      {hideChecked && done > 0 && <p className="py-1 text-[14px] text-surface-500">{done === 1 ? '1 checked item hidden' : `${done} checked items hidden`}</p>}
    </div>
    {adding
      ? <div className="mt-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              stopAdding()
            }
          }}
          placeholder="Add an item"
          aria-label="Add an item"
          autoFocus
          maxLength={500}
          className={FIELD}
        />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={add} className="min-h-10 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90">Add</button>
          <button type="button" aria-label="Stop adding items" title="Stop adding items" onClick={stopAdding} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-surface-800">
            <X color={color.textMuted} size={18} />
          </button>
        </div>
      </div>
      : <button type="button" onClick={() => setAdding(true)} className="mt-1 flex min-h-11 items-center rounded-lg pr-2 hover:bg-surface-900">
        <Plus color={color.textMuted} size={18} />
        <span className="ml-2 text-[15px] font-semibold text-surface-400">Add an item</span>
      </button>}
    <MenuSheet visible={menu} title={checklist.title} onClose={() => setMenu(false)} items={[
      { label: 'Rename', Icon: Pencil, onPress: () => setRenaming(true) },
      { label: hideChecked ? 'Show checked items' : 'Hide checked items', Icon: hideChecked ? Eye : EyeOff, disabled: done === 0 && !hideChecked, onPress: () => setHideChecked(!hideChecked) },
      { label: 'Delete checklist', Icon: Trash2, destructive: true, onPress: onDelete }
    ]} />
    <TextSheet
      visible={renaming}
      title="Rename checklist"
      value={checklist.title}
      placeholder="Checklist title"
      confirm="Save"
      onClose={() => setRenaming(false)}
      onSave={(title) => {
        onChange((current) => ({ ...current, title: title.trim() }))
        setRenaming(false)
      }}
    />
  </div>
}

/** Every checklist on a card. Each tick is a card edit, logged the way Trello logs it. */
export function Checklists({ card }: { card: TaskCardRecord }): React.ReactElement | null {
  const tasks = useTasks()
  if (card.checklists.length === 0) return null
  const update = (change: (checklists: TaskChecklist[]) => TaskChecklist[]): void => {
    void tasks.updateCard(card.id, (input) => ({ ...input, checklists: change(input.checklists) }))
  }
  return <div>
    {card.checklists.map((checklist) => <Checklist
      key={checklist.id}
      checklist={checklist}
      onChange={(change) => update((all) => all.map((item) => item.id === checklist.id ? change(item) : item))}
      onDelete={() => update((all) => all.filter((item) => item.id !== checklist.id))}
    />)}
  </div>
}
