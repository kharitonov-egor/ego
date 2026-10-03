import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Check, Ellipsis, EyeOff, Eye, Pencil, Plus, SquareCheckBig, Trash2, X } from 'lucide-react-native'
import type { TaskCardRecord } from '@ego/api-contracts'
import type { TaskChecklist, TaskChecklistItem } from '@ego/core'
import { Blurred } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { newId } from '@ego/local/sync/commands'
import { MenuSheet } from '../gym/ui'
import { color } from '../money/tokens'
import { TextSheet } from './sheets'

function Box({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked }}
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={10}
    className={`h-6 w-6 items-center justify-center rounded-md border ${checked ? 'border-transparent bg-primary' : 'border-surface-500'}`}
  >{checked && <Check color="#0a0a0a" size={16} strokeWidth={3} />}</Pressable>
}

function Item({ item, onToggle, onRename, onDelete }: {
  item: TaskChecklistItem
  onToggle: () => void
  onRename: (text: string) => void
  onDelete: () => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const done = item.doneAt !== null
  if (editing) {
    return <View className="py-2">
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        multiline
        accessibilityLabel="Item text"
        className="min-h-11 rounded-xl border border-input bg-surface-900 px-3 py-2 text-[16px] text-foreground"
      />
      <View className="mt-2 flex-row items-center gap-2">
        <Pressable accessibilityRole="button" onPress={() => {
          if (text.trim()) onRename(text.trim())
          setEditing(false)
        }} className="min-h-10 flex-1 items-center justify-center rounded-xl bg-primary">
          <Text className="text-[15px] font-semibold text-primary-foreground">Save</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete item" onPress={onDelete} className="h-10 w-10 items-center justify-center rounded-xl active:bg-surface-800">
          <Trash2 color={color.destructive} size={18} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => {
          setText(item.text)
          setEditing(false)
        }} className="h-10 w-10 items-center justify-center rounded-xl active:bg-surface-800">
          <X color={color.textMuted} size={18} />
        </Pressable>
      </View>
    </View>
  }
  return <View className="min-h-11 flex-row items-center py-1.5">
    <Box checked={done} onPress={onToggle} label={item.text} />
    <Pressable accessibilityRole="button" accessibilityHint="Edits the item" onPress={() => setEditing(true)} className="ml-3 flex-1">
      <Blurred tint={done ? '#737373' : '#e5e5e5'}>
        <Text className={`text-[16px] leading-6 ${done ? 'text-surface-500 line-through' : 'text-surface-200'}`}>{item.text}</Text>
      </Blurred>
    </Pressable>
  </View>
}

function Checklist({ checklist, onChange, onDelete }: {
  checklist: TaskChecklist
  /** Applied to the checklist as last saved, so two quick taps both land. */
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
  const changeItem = (id: string, change: (item: TaskChecklistItem) => TaskChecklistItem | null): void => {
    onChange((current) => ({ ...current, items: current.items.flatMap((item) => {
      if (item.id !== id) return [item]
      const next = change(item)
      return next ? [next] : []
    }) }))
  }
  return <View className="mt-5">
    <View className="flex-row items-center">
      <SquareCheckBig color={color.textMuted} size={18} />
      <Blurred tint="#fafafa"><Text numberOfLines={2} className="ml-2 flex-1 text-[17px] font-semibold text-surface-100">{checklist.title}</Text></Blurred>
      <Pressable accessibilityRole="button" accessibilityLabel={`${checklist.title} menu`} onPress={() => setMenu(true)} hitSlop={8} className="h-10 w-10 items-center justify-center">
        <Ellipsis color={color.textMuted} size={20} />
      </Pressable>
    </View>
    <View className="mt-1 flex-row items-center">
      <Text className="w-10 text-[13px] font-semibold text-surface-400">{share}%</Text>
      <View className="h-2 flex-1 overflow-hidden rounded-full bg-surface-800">
        <View style={{ width: `${share}%`, height: 8, backgroundColor: share === 100 ? '#fafafa' : '#a3a3a3' }} />
      </View>
    </View>
    <View className="mt-1">
      {items.map((item) => <Item
        key={item.id}
        item={item}
        onToggle={() => changeItem(item.id, (current) => ({ ...current, doneAt: current.doneAt ? null : new Date().toISOString() }))}
        onRename={(text) => changeItem(item.id, (current) => ({ ...current, text }))}
        onDelete={() => changeItem(item.id, () => null)}
      />)}
      {hideChecked && done > 0 && <Text className="py-1 text-[14px] text-surface-500">{done === 1 ? '1 checked item hidden' : `${done} checked items hidden`}</Text>}
    </View>
    {adding
      ? <View className="mt-1">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add an item"
          placeholderTextColor="#737373"
          autoFocus
          blurOnSubmit={false}
          onSubmitEditing={add}
          returnKeyType="done"
          className="min-h-11 rounded-xl border border-input bg-surface-900 px-3 text-[16px] text-foreground"
        />
        <View className="mt-2 flex-row items-center gap-2">
          <Pressable accessibilityRole="button" onPress={add} className="min-h-10 flex-1 items-center justify-center rounded-xl bg-primary">
            <Text className="text-[15px] font-semibold text-primary-foreground">Add</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Stop adding items" onPress={() => { setAdding(false); setDraft('') }} className="h-10 w-10 items-center justify-center rounded-xl active:bg-surface-800">
            <X color={color.textMuted} size={18} />
          </Pressable>
        </View>
      </View>
      : <Pressable accessibilityRole="button" onPress={() => setAdding(true)} className="mt-1 min-h-11 flex-row items-center active:opacity-70">
        <Plus color={color.textMuted} size={18} />
        <Text className="ml-2 text-[15px] font-semibold text-surface-400">Add an item</Text>
      </Pressable>}
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
  </View>
}

/** Every checklist on a card. Each tick is a card edit, logged the way Trello logs it. */
export function Checklists({ card }: { card: TaskCardRecord }): React.ReactElement | null {
  const tasks = useTasks()
  if (card.checklists.length === 0) return null
  const update = (change: (checklists: TaskChecklist[]) => TaskChecklist[]): void => {
    void tasks.updateCard(card.id, (input) => ({ ...input, checklists: change(input.checklists) }))
  }
  return <View>
    {card.checklists.map((checklist) => <Checklist
      key={checklist.id}
      checklist={checklist}
      onChange={(change) => update((all) => all.map((item) => item.id === checklist.id ? change(item) : item))}
      onDelete={() => update((all) => all.filter((item) => item.id !== checklist.id))}
    />)}
  </View>
}
