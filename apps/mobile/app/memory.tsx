import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Brain, Plus, Trash2, X } from 'lucide-react-native'
import { AGENT_MEMORY_MAX_CHARS, type AgentMemory, type AgentMemorySource } from '@ego/api-contracts'
import { PrivateGate } from '../components/PrivateGate'
import { BottomSheet, ConfirmDialog, inputClass } from '../components/money/Common'
import { tabular } from '../components/money/tokens'
import { Button } from '../components/ui/button'
import { Card, CardHeader, CardTitle } from '../components/ui/card'
import { KeyboardScrollView } from '../components/ui/keyboard'
import { Text } from '../components/ui/text'
import { Blurred, useBlur } from '../lib/blur'
import { useLedger } from '../lib/ledger-context'

const MIN_CHARS = 3

const SOURCES: Record<AgentMemorySource, string> = { chat: 'Chat', agent: 'Claude', user: 'You' }

function noteDate(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function withNote(memories: AgentMemory[], memory: AgentMemory): AgentMemory[] {
  return [memory, ...memories.filter((item) => item.id !== memory.id)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function Counter({ length }: { length: number }): React.ReactElement {
  const full = length >= AGENT_MEMORY_MAX_CHARS
  return <Text className={`text-[14px] ${full ? 'text-attention' : 'text-muted-foreground'}`} style={tabular}>
    {length}/{AGENT_MEMORY_MAX_CHARS}
  </Text>
}

function Message({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <Brain color="#737373" size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

function NoteSheet({ memory, busy, error, onSave, onDelete, onClose }: {
  memory: AgentMemory | null
  busy: boolean
  error: string | null
  onSave: (memory: AgentMemory, text: string) => void
  onDelete: (memory: AgentMemory) => void
  onClose: () => void
}): React.ReactElement {
  const [text, setText] = useState(memory?.text ?? '')
  useEffect(() => { if (memory) setText(memory.text) }, [memory])
  const trimmed = text.trim()
  const canSave = memory !== null && !busy && trimmed.length >= MIN_CHARS && trimmed !== memory.text
  const save = (): void => { if (memory && canSave) onSave(memory, trimmed) }
  return <BottomSheet visible={memory !== null} title="Edit note" onClose={onClose}>
    <TextInput
      value={text}
      onChangeText={setText}
      accessibilityLabel="Note"
      autoFocus
      multiline
      maxLength={AGENT_MEMORY_MAX_CHARS}
      submitBehavior="blurAndSubmit"
      returnKeyType="done"
      onSubmitEditing={save}
      textAlignVertical="top"
      className={`${inputClass} min-h-[112px] leading-6`}
    />
    <View className="mt-2 flex-row justify-end"><Counter length={text.length} /></View>
    {error && <Text className="mt-2 text-[15px] leading-5 text-destructive">{error}</Text>}
    <Button size="lg" disabled={!canSave} onPress={save} className="mt-4">
      <Text>{busy ? 'Saving...' : 'Save'}</Text>
    </Button>
    <Button variant="ghost" disabled={busy || memory === null} onPress={() => { if (memory) onDelete(memory) }} className="mt-2">
      <Trash2 color="#fb7185" size={17} />
      <Text className="text-destructive">Delete note</Text>
    </Button>
  </BottomSheet>
}

export default function MemoryScreen(): React.ReactElement {
  return <PrivateGate label="Memory"><Memory /></PrivateGate>
}

function Memory(): React.ReactElement {
  const ledger = useLedger()
  const { api } = ledger
  const router = useRouter()
  const { blurred } = useBlur()
  const [memories, setMemories] = useState<AgentMemory[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AgentMemory | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentMemory | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => {
    if (!ledger.enabled) return
    let active = true
    setLoadError(null)
    void api.agentMemories().then((result) => {
      if (!active) return
      if (result.ok) setMemories(result.data.memories)
      else setLoadError(result.error.message)
    })
    return () => { active = false }
  }, [api, ledger.enabled, attempt])

  if (!ledger.enabled) {
    return <Message
      title="Sign in to see Memory"
      detail="Sign in once with Google on the start screen. The notes the chat and Claude keep about you then show here."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }

  const forget = (id: string): void => {
    setMemories((current) => current?.filter((item) => item.id !== id) ?? null)
  }

  const add = async (): Promise<void> => {
    const text = draft.trim()
    if (adding || text.length < MIN_CHARS) return
    setAdding(true)
    setAddError(null)
    const result = await api.addAgentMemory(text)
    setAdding(false)
    if (!result.ok) {
      setAddError(result.error.message)
      return
    }
    setDraft('')
    setMemories((current) => withNote(current ?? [], result.data))
  }

  const save = async (memory: AgentMemory, text: string): Promise<void> => {
    setSaving(true)
    setEditError(null)
    const result = await api.updateAgentMemory(memory.id, text)
    setSaving(false)
    if (result.ok) {
      setMemories((current) => withNote(current ?? [], result.data))
      setEditing(null)
    } else if (result.error.code === 'NOT_FOUND') {
      forget(memory.id)
      setEditing(null)
      setListError(result.error.message)
    } else setEditError(result.error.message)
  }

  const remove = async (): Promise<void> => {
    if (!deleting) return
    const target = deleting
    setDeleteBusy(true)
    const result = await api.deleteAgentMemory(target.id)
    setDeleteBusy(false)
    setDeleting(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') {
      setListError(result.error.message)
      return
    }
    forget(target.id)
  }

  const canAdd = !adding && draft.trim().length >= MIN_CHARS

  return <View className="flex-1 bg-background">
    <KeyboardScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <Card className="p-5">
        <Text accessibilityRole="header" className="text-[18px] font-semibold">Add a note</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          accessibilityLabel="New note"
          placeholder="Something the chat and Claude should know about you"
          placeholderTextColor="#737373"
          multiline
          maxLength={AGENT_MEMORY_MAX_CHARS}
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          textAlignVertical="top"
          className={`${inputClass} mt-4 min-h-[96px] leading-6`}
        />
        <View className="mt-3 flex-row items-center justify-between">
          <Counter length={draft.length} />
          <Button disabled={!canAdd} onPress={() => void add()}>
            {adding ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Plus color="#0a0a0a" size={18} />}
            <Text>{adding ? 'Saving...' : 'Add note'}</Text>
          </Button>
        </View>
        {addError && <Text className="mt-3 text-[15px] leading-5 text-destructive">{addError}</Text>}
      </Card>

      {listError && <Pressable
        accessibilityRole="button"
        accessibilityHint="Dismisses this message"
        onPress={() => setListError(null)}
        className="flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
      >
        <Text className="flex-1 text-[15px] leading-5 text-destructive">{listError}</Text>
        <X color="#fb7185" size={16} />
      </Pressable>}

      {memories === null
        ? <Card className="items-center p-8">
          {loadError
            ? <>
              <Text className="text-center text-[15px] leading-5 text-destructive">{loadError}</Text>
              <Button variant="outline" onPress={() => setAttempt((current) => current + 1)} className="mt-4"><Text>Try again</Text></Button>
            </>
            : <ActivityIndicator color="#fafafa" />}
        </Card>
        : memories.length === 0
          ? <Card className="items-center px-8 py-10">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Brain color="#a3a3a3" size={30} /></View>
            <Text className="mt-4 text-center text-[18px] font-semibold">Nothing remembered yet</Text>
            <Text className="mt-2 text-center text-[15px] leading-6 text-muted-foreground">The chat and Claude save short facts about you here as you talk. You can add your own above.</Text>
          </Card>
          : <Card className="overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle>{memories.length === 1 ? '1 note' : `${memories.length} notes`}</CardTitle>
              {blurred && <Text className="text-[14px] leading-5 text-muted-foreground">Blur is on, so notes are read-only. Turn it off in Settings to edit.</Text>}
            </CardHeader>
            {memories.map((memory) => <Pressable
              key={memory.id}
              accessibilityRole="button"
              accessibilityHint={blurred ? undefined : 'Edits this note'}
              disabled={blurred}
              onPress={() => {
                setEditError(null)
                setEditing(memory)
              }}
              className="border-t border-surface-800 px-5 py-3.5 active:bg-surface-900"
            >
              <Blurred tint="#e5e5e5"><Text className="text-[16px] leading-6 text-surface-100">{memory.text}</Text></Blurred>
              <Text className="mt-1 text-[14px] text-muted-foreground">{SOURCES[memory.source]} · {noteDate(memory.updatedAt)}</Text>
            </Pressable>)}
          </Card>}
    </KeyboardScrollView>

    <NoteSheet
      memory={editing}
      busy={saving}
      error={editError}
      onSave={(memory, text) => void save(memory, text)}
      onDelete={(memory) => {
        setEditing(null)
        setDeleting(memory)
      }}
      onClose={() => setEditing(null)}
    />
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this note?"
      detail="The chat and Claude stop seeing it. They may save it again if it comes up."
      confirmLabel="Delete"
      destructive
      busy={deleteBusy}
      hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove()}
    />
  </View>
}
