import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AudioLines, MessagesSquare, Paperclip, Send, SquarePen, X } from 'lucide-react'
import type {
  AssistantChat, AssistantMessage, AssistantPendingWrite, AssistantStreamEvent, AssistantUnits
} from '@ego/api-contracts'
import { isoToday } from '@ego/local/dates'
import { fromFile, imageIn, type Attachment } from '../../components/assistant/attachments'
import {
  AssistantBubble, ChatList, ChatsSheet, ErrorBubble, Intro, PendingCard, StreamingBubble, UserBubble
} from '../../components/assistant/ui'
import { CenteredMessage, Screen, ScreenHeader } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { useAutosize } from '../../hooks/useAutosize'
import { assistantStream } from '../../lib/assistant'
import { useLedger } from '../../lib/ledger'
import { SecureStore } from '../../lib/preferences'
import { cn } from '../../lib/utils'

const UNITS_KEY = 'ego.health.units'

interface Streaming {
  text: string
  trail: string[]
}

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/** The phone's AI chat with the Worker assistant. Talk to AI, the voice call, opens from the header. */
export default function Assistant(): React.ReactElement {
  const navigate = useNavigate()
  const ledger = useLedger()
  const { api } = ledger
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [chats, setChats] = useState<AssistantChat[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [pending, setPending] = useState<AssistantPendingWrite | null>(null)
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [dragging, setDragging] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [deleting, setDeleting] = useState<AssistantChat | null>(null)
  const [units, setUnits] = useState<AssistantUnits>('imperial')
  const imageUris = useRef(new Map<string, string>())
  const pendingImage = useRef<string | null>(null)
  useAutosize(input, text)

  const scrollToEnd = useCallback((): void => {
    requestAnimationFrame(() => {
      const area = scroll.current
      area?.scrollTo({ top: area.scrollHeight, behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    const area = content.current
    if (!area) return
    const observer = new ResizeObserver(scrollToEnd)
    observer.observe(area)
    return () => observer.disconnect()
  }, [ledger.enabled, scrollToEnd])

  useEffect(() => {
    void SecureStore.getItemAsync(UNITS_KEY).then((value) => {
      if (value === 'metric' || value === 'imperial') setUnits(value)
    }).catch(() => undefined)
  }, [])

  const open = useCallback(async (chat: AssistantChat | null): Promise<void> => {
    setChatId(chat?.id ?? null)
    setPending(null)
    setStreaming(null)
    setError(null)
    if (!chat) {
      setMessages([])
      setLoading(false)
      input.current?.focus()
      return
    }
    setLoading(true)
    const result = await api.assistantMessages(chat.id)
    setLoading(false)
    if (!result.ok) {
      setMessages([])
      setError(result.error.message)
      return
    }
    setMessages(result.data.messages)
    setPending(result.data.pending)
    scrollToEnd()
  }, [api, scrollToEnd])

  useEffect(() => {
    if (!ledger.enabled) {
      setLoading(false)
      return
    }
    let active = true
    void api.assistantChats().then((result) => {
      if (!active) return
      if (!result.ok) {
        setLoading(false)
        setError(result.error.message)
        return
      }
      setChats(result.data.chats)
      void open(result.data.chats[0] ?? null)
    })
    return () => { active = false }
  }, [api, ledger.enabled, open])

  const handleEvent = useCallback((event: AssistantStreamEvent): void => {
    if (event.type === 'chat') {
      setChatId(event.chat.id)
      setChats((current) => [event.chat, ...current.filter((chat) => chat.id !== event.chat.id)])
    } else if (event.type === 'message') {
      if (event.message.role === 'user' && pendingImage.current) {
        imageUris.current.set(event.message.id, pendingImage.current)
        pendingImage.current = null
      }
      setMessages((current) => [...current.filter((message) => !message.id.startsWith('local-')), event.message])
      if (event.message.role === 'assistant') setStreaming(null)
    } else if (event.type === 'delta') {
      setStreaming((current) => ({ text: (current?.text ?? '') + event.text, trail: current?.trail ?? [] }))
    } else if (event.type === 'trail') {
      setStreaming((current) => ({ text: current?.text ?? '', trail: [...(current?.trail ?? []), event.line] }))
    } else if (event.type === 'pending') {
      setPending(event.pending)
    } else if (event.type === 'error') {
      setError(event.error.message)
    }
    scrollToEnd()
  }, [scrollToEnd])

  const finishTurn = useCallback((chat: string | null): void => {
    setBusy(false)
    setStreaming(null)
    if (chat) setChats((current) => current.map((item) => item.id === chat ? { ...item, updatedAt: new Date().toISOString() } : item))
    void ledger.sync()
  }, [ledger])

  const send = async (): Promise<void> => {
    const message = text.trim()
    const image = attachment
    if (busy || (!message && !image)) return
    setText('')
    setAttachment(null)
    setError(null)
    setPending(null)
    setBusy(true)
    setStreaming({ text: '', trail: [] })
    pendingImage.current = image?.uri ?? null
    const local: AssistantMessage = {
      id: `local-${Date.now()}`, chatId: chatId ?? '', seq: Number.MAX_SAFE_INTEGER, role: 'user', text: message,
      createdAt: new Date().toISOString(), trail: [], hasImage: image !== null, undo: []
    }
    if (image) imageUris.current.set(local.id, image.uri)
    setMessages((current) => [...current, local])
    scrollToEnd()
    const result = await assistantStream('turn', {
      chatId, text: message, ...(image ? { image: { base64: image.base64, mimeType: image.mimeType } } : {}),
      today: isoToday(), timeZone: timeZone(), units
    }, handleEvent)
    finishTurn(chatId)
    if (!result.ok) {
      setError(result.error.message)
      setMessages((current) => current.filter((item) => item.id !== local.id))
      setText(message)
      setAttachment(image)
    }
  }

  const answer = async (approved: boolean): Promise<void> => {
    if (!pending || busy) return
    const current = pending
    setPending(null)
    setError(null)
    setBusy(true)
    setStreaming({ text: '', trail: [] })
    const result = await assistantStream('confirm', {
      chatId: current.chatId, callId: current.callId, approved, today: isoToday(), timeZone: timeZone(), units
    }, handleEvent)
    finishTurn(current.chatId)
    if (!result.ok) setError(result.error.message)
  }

  const undo = async (callId: string): Promise<void> => {
    if (!chatId || undoing) return
    setUndoing(callId)
    const result = await api.assistantUndo({ chatId, callId })
    setUndoing(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setMessages((current) => [
      ...current.map((message) => ({ ...message, undo: message.undo.filter((item) => item.callId !== callId) })),
      result.data.message
    ])
    scrollToEnd()
    void ledger.sync()
  }

  const attach = async (file: File | null): Promise<void> => {
    if (!file || busy) return
    const result = await fromFile(file)
    if (result.ok) {
      setAttachment(result.attachment)
      input.current?.focus()
    } else if (result.message) {
      setError(result.message)
    }
  }

  const remove = async (chat: AssistantChat): Promise<void> => {
    setDeleting(null)
    const result = await api.assistantDeleteChat(chat.id)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const remaining = chats.filter((item) => item.id !== chat.id)
    setChats(remaining)
    if (chat.id === chatId) void open(remaining[0] ?? null)
  }

  const chatRows = {
    chats,
    currentId: chatId,
    onOpen: (chat: AssistantChat) => { setChatsOpen(false); void open(chat) },
    onNew: () => { setChatsOpen(false); void open(null) },
    onDelete: (chat: AssistantChat) => { setChatsOpen(false); setDeleting(chat) }
  }

  const header = <ScreenHeader title="AI" right={<>
    <IconButton label="Talk to AI" onClick={() => navigate('/ai/voice')}><AudioLines size={20} /></IconButton>
    {ledger.enabled && <>
      <IconButton label="Chats" onClick={() => setChatsOpen(true)} className="lg:hidden"><MessagesSquare size={20} /></IconButton>
      <IconButton label="New chat" onClick={() => void open(null)}><SquarePen size={20} /></IconButton>
    </>}
  </>} />

  if (!ledger.enabled) {
    return <Screen>
      {header}
      <CenteredMessage
        title="Sign in to talk to Ego"
        detail="Sign in once with Google on the start screen. The chat then reads and records your data through the Worker."
        action="Go to sign in"
        onAction={() => navigate('/')}
      />
    </Screen>
  }

  const canSend = !busy && (text.trim().length > 0 || attachment !== null)

  return <Screen>
    {header}
    <div className="flex min-h-0 flex-1">
      <ChatList {...chatRows} />
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) setDragging(false)
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDragging(false)
          void attach(imageIn(event.dataTransfer))
        }}
      >
        <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
          <div ref={content} className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-4 pt-4">
            {loading && messages.length === 0 && <div className="flex justify-center py-10"><Spinner /></div>}
            {!loading && messages.length === 0 && !streaming && <Intro onPick={(example) => {
              setText(example)
              input.current?.focus()
            }} />}
            {messages.map((message) => message.role === 'user'
              ? <UserBubble key={message.id} message={message} imageUri={imageUris.current.get(message.id) ?? null} />
              : <AssistantBubble key={message.id} message={message} undoing={undoing} onUndo={(callId) => void undo(callId)} />)}
            {streaming && <StreamingBubble text={streaming.text} trail={streaming.trail} />}
            {pending && !busy && <PendingCard pending={pending} busy={busy} onAnswer={(approved) => void answer(approved)} />}
            {error && <ErrorBubble text={error} onDismiss={() => setError(null)} />}
          </div>
        </div>

        <div className="border-t border-surface-800 bg-background px-6 pb-4 pt-3">
          <div className="mx-auto max-w-3xl">
            {attachment && <div className="mb-3 flex items-center rounded-2xl border border-border bg-card p-2.5">
              <img src={attachment.uri} alt="Receipt" className="h-12 w-12 rounded-xl object-cover" />
              <div className="ml-3 flex-1">
                <p className="text-[15px] font-semibold">Receipt attached</p>
                <p className="text-[14px] text-muted-foreground">Add a note or send it now</p>
              </div>
              <IconButton label="Remove the receipt" onClick={() => setAttachment(null)} className="h-11 w-11"><X size={18} /></IconButton>
            </div>}
            <div className="flex items-end rounded-3xl border border-input bg-surface-900 p-1.5 focus-within:border-surface-500">
              <IconButton label="Attach a receipt" disabled={busy} onClick={() => picker.current?.click()} className="h-11 w-11">
                <Paperclip size={20} />
              </IconButton>
              <textarea
                ref={input}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  void send()
                }}
                onPaste={(event) => {
                  const file = imageIn(event.clipboardData)
                  if (!file) return
                  event.preventDefault()
                  void attach(file)
                }}
                rows={1}
                maxLength={4000}
                readOnly={busy}
                autoFocus
                aria-label="Message to Ego"
                placeholder="Ask or tell me what happened"
                className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[17px] leading-6 text-foreground outline-none"
              />
              <button
                type="button"
                aria-label="Send"
                title="Send"
                disabled={!canSend}
                onClick={() => void send()}
                className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
                  canSend ? 'bg-primary hover:bg-primary/90 active:bg-primary/85' : 'bg-surface-800')}
              ><Send color={canSend ? '#0a0a0a' : '#737373'} size={18} /></button>
            </div>
          </div>
        </div>

        {dragging && <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-3xl border-2 border-dashed border-surface-500 bg-background/85">
          <p className="text-[18px] font-semibold">Drop a receipt photo</p>
        </div>}
      </div>
    </div>

    <input
      ref={picker}
      type="file"
      accept="image/*"
      hidden
      onChange={(event) => {
        void attach(event.target.files?.[0] ?? null)
        event.target.value = ''
      }}
    />
    <ChatsSheet visible={chatsOpen} onClose={() => setChatsOpen(false)} {...chatRows} />
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this chat?"
      detail="The messages are removed from the list. Anything already recorded in the other apps stays."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(null)}
      onConfirm={() => { if (deleting) void remove(deleting) }}
    />
  </Screen>
}
