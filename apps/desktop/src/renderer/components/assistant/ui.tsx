import React from 'react'
import { MessageSquarePlus, Sparkles, Trash2, X } from 'lucide-react'
import type { AssistantChat, AssistantMessage, AssistantPendingWrite } from '@ego/api-contracts'
import { Blurred, useBlur } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { SAVE_DELAY_MS, SaveCountdown } from '../ui/countdown'
import { Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'

const EXAMPLES = [
  'What was my mood yesterday?',
  'Max bench press in the past month?',
  'Publix $42 and gas $30',
  'Bench 3x8 at 185, squats 5x5 at 225',
  'Two eggs and toast for breakfast',
  'How much protein today?',
  'What\'s in my fridge?'
]

export function Trail({ lines }: { lines: readonly string[] }): React.ReactElement | null {
  if (lines.length === 0) return null
  return <ul className="mt-1.5 flex flex-col gap-0.5 pl-1">
    {lines.map((line, index) => <li key={`${index}-${line}`} className="flex items-start">
      <span className="mr-2 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-surface-500" />
      <Blurred><span className="flex-1 text-[13px] leading-5 text-muted-foreground">{line}</span></Blurred>
    </li>)}
  </ul>
}

export function UserBubble({ message, imageUri }: { message: AssistantMessage; imageUri: string | null }): React.ReactElement {
  const { blurred } = useBlur()
  return <div className="mb-3 flex flex-col items-end">
    <div className="max-w-[86%] overflow-hidden rounded-3xl rounded-br-lg bg-primary px-4 py-3">
      {imageUri
        ? <div className="mb-2 h-36 w-52 overflow-hidden rounded-2xl">
          <img src={imageUri} alt="Photo" className={cn('h-36 w-52 object-cover', blurred && 'ego-blurred-media')} />
        </div>
        : message.hasImage && <Badge variant="outline" className="mb-2 border-black/20 text-primary-foreground">Photo</Badge>}
      {message.text.length > 0 && <Blurred><p className="whitespace-pre-wrap break-words text-[16px] leading-6 text-primary-foreground">{message.text}</p></Blurred>}
    </div>
  </div>
}

export function AssistantBubble({ message }: { message: AssistantMessage }): React.ReactElement {
  return <div className="mb-3 flex flex-col items-start">
    {message.text.length > 0 && <div className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
      <Blurred><p className="select-text whitespace-pre-wrap break-words text-[16px] leading-6">{message.text}</p></Blurred>
    </div>}
    <Trail lines={message.trail} />
  </div>
}

export function StreamingBubble({ text, trail }: { text: string; trail: readonly string[] }): React.ReactElement {
  return <div className="mb-3 flex flex-col items-start" aria-live="polite">
    {text.trim().length > 0
      ? <div className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <Blurred><p className="whitespace-pre-wrap break-words text-[16px] leading-6">{text.trimStart()}</p></Blurred>
      </div>
      : <div className="flex items-center rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <Spinner size={18} />
        <span className="ml-2.5 text-[15px] text-muted-foreground">{trail.length > 0 ? 'Working' : 'Thinking'}</span>
      </div>}
    <Trail lines={trail} />
  </div>
}

export function ErrorBubble({ text, onDismiss }: { text: string; onDismiss: () => void }): React.ReactElement {
  return <button
    type="button"
    title="Dismiss"
    onClick={onDismiss}
    className="mb-3 flex max-w-[86%] items-center self-start rounded-3xl rounded-bl-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-left transition-colors hover:bg-destructive/15"
  >
    <span className="flex-1 text-[15px] leading-6 text-rose-200">{text}</span>
    <X color="#fca5a5" size={16} className="ml-2 shrink-0" />
  </button>
}

/** Everything one reply asked to save. It saves itself unless Undo comes first; sending a new message saves it too. */
export function PendingCard({ pending, onSave, onUndo }: {
  pending: AssistantPendingWrite
  onSave: () => void
  onUndo: () => void
}): React.ReactElement {
  const seconds = SAVE_DELAY_MS / 1000
  const changes = pending.changes ?? [{ toolName: pending.toolName, title: pending.title, lines: pending.lines }]
  return <Card className="mb-4 overflow-hidden">
    <div className="border-b border-surface-800 px-5 py-4">
      <SaveCountdown
        runKey={pending.callId}
        paused={false}
        label={changes.length === 1 ? `Saves in ${seconds} seconds` : `Saves ${changes.length} changes in ${seconds} seconds`}
        onElapsed={onSave}
        onUndo={onUndo}
      />
    </div>
    <div className="flex flex-col gap-4 px-5 py-4">
      {changes.map((change, index) => <div key={`${index}-${change.toolName}`}>
        <Blurred><h2 className="text-[17px] font-semibold">{change.title}</h2></Blurred>
        {change.lines.map((line, row) => <Blurred key={`${row}-${line}`}><p className="mt-1 text-[15px] leading-6 text-surface-200">{line}</p></Blurred>)}
      </div>)}
    </div>
  </Card>
}

export function Intro({ onPick }: { onPick: (text: string) => void }): React.ReactElement {
  return <div className="mb-4">
    <div className="mb-5 flex items-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Sparkles color="#fafafa" size={22} /></div>
      <div className="ml-3 flex-1">
        <h2 className="text-[18px] font-semibold">Ask, or tell me what happened</h2>
        <p className="text-[15px] text-muted-foreground">Money, gym, health, mood, habits, study, and food</p>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      {EXAMPLES.map((example) => <button
        key={example}
        type="button"
        onClick={() => onPick(example)}
        className="rounded-full border border-surface-700 px-3.5 py-2 text-[14px] text-surface-200 transition-colors hover:bg-surface-800 active:bg-surface-800"
      >{example}</button>)}
    </div>
  </div>
}

function chatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface ChatRowsProps {
  chats: readonly AssistantChat[]
  currentId: string | null
  /** While a reply streams, the chat on screen stays put. */
  disabled: boolean
  onOpen: (chat: AssistantChat) => void
  onNew: () => void
  onDelete: (chat: AssistantChat) => void
}

/** New chat, then every earlier chat, newest first. */
function ChatRows({ chats, currentId, disabled, onOpen, onNew, onDelete }: ChatRowsProps): React.ReactElement {
  return <>
    <button type="button" disabled={disabled} onClick={onNew} className="mb-2 flex min-h-14 w-full items-center gap-4 rounded-2xl bg-surface-900 px-4 text-left transition-colors hover:bg-surface-800 active:bg-surface-800 disabled:opacity-50">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary"><MessageSquarePlus color="#0a0a0a" size={20} /></span>
      <span className="text-[16px] font-semibold">New chat</span>
    </button>
    {chats.length === 0 && <p className="px-1 py-3 text-[15px] text-muted-foreground">No chats yet.</p>}
    {chats.map((chat) => <div key={chat.id} className={cn('group mb-2 flex items-center rounded-2xl border pl-4 pr-1',
      chat.id === currentId ? 'border-surface-500 bg-surface-900' : 'border-surface-800 bg-surface-900/50 hover:bg-surface-900')}>
      <button
        type="button"
        aria-current={chat.id === currentId ? 'true' : undefined}
        disabled={disabled}
        onClick={() => onOpen(chat)}
        className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 text-left disabled:cursor-default"
      >
        <Blurred><span className="w-full truncate text-[16px] font-medium">{chat.title || 'Chat'}</span></Blurred>
        <span className="text-[13px] text-muted-foreground">{chatDate(chat.updatedAt)}</span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${chat.title || 'this chat'}`}
        title="Delete"
        disabled={disabled}
        onClick={() => onDelete(chat)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-surface-400 opacity-0 transition hover:bg-surface-800 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      ><Trash2 size={18} /></button>
    </div>)}
  </>
}

/** The phone's chats sheet, kept open beside the conversation when the window is wide. */
export function ChatList(props: ChatRowsProps): React.ReactElement {
  return <aside aria-label="Chats" className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-border px-3 py-4 lg:flex">
    <ChatRows {...props} />
  </aside>
}

export function ChatsSheet({ visible, onClose, ...props }: ChatRowsProps & { visible: boolean; onClose: () => void }): React.ReactElement {
  return <Sheet visible={visible} title="Chats" onClose={onClose} dismissOnBackdrop>
    <ChatRows {...props} />
  </Sheet>
}
