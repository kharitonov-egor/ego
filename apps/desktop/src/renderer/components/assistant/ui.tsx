import React from 'react'
import { Check, MessageSquarePlus, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import type { AssistantChat, AssistantMessage, AssistantPendingWrite } from '@ego/api-contracts'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'

const EXAMPLES = [
  'What was my mood yesterday?',
  'Max bench press in the past month?',
  'How many times did I read this month?',
  'Publix $42 and gas $30',
  'Bench 3x8 at 185, squats 5x5 at 225',
  'Mood 4 today, slept well'
]

export function Trail({ lines }: { lines: readonly string[] }): React.ReactElement | null {
  if (lines.length === 0) return null
  return <ul className="mt-1.5 flex flex-col gap-0.5 pl-1">
    {lines.map((line, index) => <li key={`${index}-${line}`} className="flex items-start">
      <span className="mr-2 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-surface-500" />
      <span className="flex-1 text-[13px] leading-5 text-muted-foreground">{line}</span>
    </li>)}
  </ul>
}

export function UserBubble({ message, imageUri }: { message: AssistantMessage; imageUri: string | null }): React.ReactElement {
  return <div className="mb-3 flex flex-col items-end">
    <div className="max-w-[86%] overflow-hidden rounded-3xl rounded-br-lg bg-primary px-4 py-3">
      {imageUri
        ? <img src={imageUri} alt="Receipt" className="mb-2 h-36 w-52 rounded-2xl object-cover" />
        : message.hasImage && <Badge variant="outline" className="mb-2 border-black/20 text-primary-foreground">Receipt image</Badge>}
      {message.text.length > 0 && <p className="whitespace-pre-wrap break-words text-[16px] leading-6 text-primary-foreground">{message.text}</p>}
    </div>
  </div>
}

export function AssistantBubble({ message, undoing, onUndo }: {
  message: AssistantMessage
  undoing: string | null
  onUndo: (callId: string) => void
}): React.ReactElement {
  return <div className="mb-3 flex flex-col items-start">
    {message.text.length > 0 && <div className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
      <p className="select-text whitespace-pre-wrap break-words text-[16px] leading-6">{message.text}</p>
    </div>}
    <Trail lines={message.trail} />
    {message.undo.map((undo) => <button
      key={undo.callId}
      type="button"
      aria-label={`Undo the ${undo.label}`}
      disabled={undoing !== null}
      onClick={() => onUndo(undo.callId)}
      className="mt-1.5 flex items-center self-start rounded-full border border-surface-700 px-3 py-1.5 transition-colors hover:bg-surface-800 active:bg-surface-800 disabled:opacity-60"
    >
      {undoing === undo.callId ? <Spinner size={14} color="#d4d4d4" /> : <Undo2 color="#d4d4d4" size={14} />}
      <span className="ml-1.5 text-[13px] font-medium text-surface-200">Undo the {undo.label}</span>
    </button>)}
  </div>
}

export function StreamingBubble({ text, trail }: { text: string; trail: readonly string[] }): React.ReactElement {
  return <div className="mb-3 flex flex-col items-start" aria-live="polite">
    {text.trim().length > 0
      ? <div className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-[16px] leading-6">{text.trimStart()}</p>
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

export function PendingCard({ pending, busy, onAnswer }: {
  pending: AssistantPendingWrite
  busy: boolean
  onAnswer: (approved: boolean) => void
}): React.ReactElement {
  return <Card className="mb-4 overflow-hidden">
    <div className="border-b border-surface-800 px-5 py-4">
      <h2 className="text-[17px] font-semibold">{pending.title}</h2>
    </div>
    <div className="px-5 py-4">
      {pending.lines.map((line, index) => <p key={`${index}-${line}`} className={cn('text-[15px] leading-6', index ? 'mt-1.5' : '')}>{line}</p>)}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="lg" disabled={busy} onClick={() => onAnswer(false)} className="flex-1">
          <X color="#d4d4d4" size={18} />
          Reject
        </Button>
        <Button size="lg" disabled={busy} onClick={() => onAnswer(true)} className="flex-1">
          <Check color="#0a0a0a" size={18} />
          Confirm
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">Or just keep typing to drop it.</p>
    </div>
  </Card>
}

export function Intro({ onPick }: { onPick: (text: string) => void }): React.ReactElement {
  return <div className="mb-4">
    <div className="mb-5 flex items-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Sparkles color="#fafafa" size={22} /></div>
      <div className="ml-3 flex-1">
        <h2 className="text-[18px] font-semibold">Ask, or tell me what happened</h2>
        <p className="text-[15px] text-muted-foreground">Money, gym, health, mood, habits, and study</p>
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
  onOpen: (chat: AssistantChat) => void
  onNew: () => void
  onDelete: (chat: AssistantChat) => void
}

/** New chat, then every earlier chat, newest first. */
function ChatRows({ chats, currentId, onOpen, onNew, onDelete }: ChatRowsProps): React.ReactElement {
  return <>
    <button type="button" onClick={onNew} className="mb-2 flex min-h-14 w-full items-center gap-4 rounded-2xl bg-surface-900 px-4 text-left transition-colors hover:bg-surface-800 active:bg-surface-800">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary"><MessageSquarePlus color="#0a0a0a" size={20} /></span>
      <span className="text-[16px] font-semibold">New chat</span>
    </button>
    {chats.length === 0 && <p className="px-1 py-3 text-[15px] text-muted-foreground">No chats yet.</p>}
    {chats.map((chat) => <div key={chat.id} className={cn('group mb-2 flex items-center rounded-2xl border pl-4 pr-1',
      chat.id === currentId ? 'border-surface-500 bg-surface-900' : 'border-surface-800 bg-surface-900/50 hover:bg-surface-900')}>
      <button
        type="button"
        aria-current={chat.id === currentId ? 'true' : undefined}
        onClick={() => onOpen(chat)}
        className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 text-left"
      >
        <span className="w-full truncate text-[16px] font-medium">{chat.title || 'Chat'}</span>
        <span className="text-[13px] text-muted-foreground">{chatDate(chat.updatedAt)}</span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${chat.title || 'this chat'}`}
        title="Delete"
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
