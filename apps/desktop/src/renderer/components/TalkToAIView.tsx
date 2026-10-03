import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Headphones, Keyboard, Mic, MicOff, PhoneOff, Send, Settings, Sparkles } from 'lucide-react'
import {
  LiveSessionController,
  type LiveSessionMode,
  type LiveSessionStatus,
  type LiveToolActivity,
  type LiveToolApproval,
  type TranscriptMessage
} from '../live/LiveSessionController'
import { IconButton } from './ui/button'

const statusCopy: Record<LiveSessionStatus, string> = {
  idle: 'Ready when you are',
  permission: 'Waiting for microphone permission',
  connecting: 'Connecting',
  listening: 'Listening',
  speaking: 'Speaking',
  muted: 'Microphone muted',
  'chat-ready': 'Chat is ready',
  thinking: 'Thinking',
  tool: 'Using a tool',
  approval: 'Waiting for your confirmation',
  ended: 'Call ended',
  error: 'Call could not continue'
}

export default function TalkToAIView({ onOpenSettings, onBack }: {
  onOpenSettings: () => void
  /** Shows a back arrow in the header, for the voice call opened from the AI chat. */
  onBack?: () => void
}): React.ReactElement {
  const [status, setStatus] = useState<LiveSessionStatus>('idle')
  const [detail, setDetail] = useState('')
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [serviceReady, setServiceReady] = useState<boolean | null>(null)
  const [mode, setMode] = useState<LiveSessionMode>('voice')
  const [draft, setDraft] = useState('')
  const [activity, setActivity] = useState<LiveToolActivity | null>(null)
  const [approval, setApproval] = useState<LiveToolApproval | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<LiveSessionController | null>(null)

  useEffect(() => {
    void window.api.moneyGetLedgerConfig().then((config) => setServiceReady(Boolean(config.url && config.hasToken)))
  }, [])

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    const stop = (): void => controllerRef.current?.end()
    const removeIpcListener = window.api.onLiveSessionStopRequested(stop)
    window.addEventListener('beforeunload', stop)
    return () => {
      removeIpcListener()
      window.removeEventListener('beforeunload', stop)
      controllerRef.current?.dispose()
      controllerRef.current = null
    }
  }, [])

  const start = async (): Promise<void> => {
    if (!audioRef.current || !serviceReady) return
    controllerRef.current?.dispose()
    setDetail('')
    const controller = new LiveSessionController({
      audio: audioRef.current,
      onStatus: (next, message) => {
        setStatus(next)
        setDetail(message ?? '')
      },
      onTranscript: setMessages,
      onToolActivity: setActivity,
      onApproval: setApproval
    })
    controllerRef.current = controller
    await controller.start(mode)
  }

  const active = !['idle', 'ended', 'error'].includes(status)
  const canMute = status === 'listening' || status === 'speaking' || status === 'muted'

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    controllerRef.current?.sendText(text)
    setDraft('')
  }

  const selectMode = (next: LiveSessionMode): void => {
    if (active) controllerRef.current?.end()
    setMode(next)
    setStatus('idle')
    setDetail('')
  }

  return <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_14%,rgba(250,250,250,0.06),transparent_34%)]">
    <header className="border-b border-surface-800 px-6 py-4">
      <div className="flex items-center gap-2 text-surface-100">
        {onBack && <IconButton label="Go back" onClick={onBack} className="-my-2 -ml-2"><ArrowLeft size={20} /></IconButton>}
        <Sparkles size={16} className="text-surface-200" /><h1 className="text-base font-semibold">Talk to AI</h1>
      </div>
      <p className="mt-1 text-xs text-surface-500">A temporary conversation. Messages and audio are not saved.</p>
    </header>

    <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr_auto]">
      <section className="px-6 pb-5 pt-7 text-center" aria-live="polite">
        <div className={`voice-orbit mx-auto ${status === 'speaking' ? 'is-speaking' : status === 'listening' ? 'is-listening' : ''}`} aria-hidden="true">
          <div className="voice-orbit__core"><Headphones size={28} /></div>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">{statusCopy[status]}</h2>
        <p className={`mx-auto mt-1 min-h-5 max-w-lg text-xs ${status === 'error' ? 'text-red-300' : 'text-surface-400'}`}>
          {detail || activity?.message || (status === 'idle' ? 'Ask anything. Connected tools work in voice and chat.' : status === 'ended' ? 'The transcript stays here until you leave or start again.' : '')}
        </p>
        {!active && <div className="mx-auto mt-4 flex w-fit rounded-lg border border-surface-700 bg-surface-900 p-1" aria-label="Conversation mode">
          <button type="button" onClick={() => selectMode('voice')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${mode === 'voice' ? 'bg-surface-700 text-foreground' : 'text-surface-400'}`}><Mic size={13} />Voice</button>
          <button type="button" onClick={() => selectMode('chat')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${mode === 'chat' ? 'bg-surface-700 text-foreground' : 'text-surface-400'}`}><Keyboard size={13} />Chat</button>
        </div>}
      </section>

      <section className="min-h-0 px-6 pb-4">
        {serviceReady === false ? <div className="mx-auto flex h-full max-w-xl items-center justify-center">
          <div className="w-full rounded-xl border border-surface-800 bg-card p-6 text-center shadow-2xl shadow-black/20">
            <Settings className="mx-auto text-surface-300" size={22} />
            <h2 className="mt-3 text-sm font-semibold text-surface-100">Connect the Ego service first</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-surface-400">Sign in on Home, or add a device token in Settings. The OpenAI key stays on the Worker.</p>
            <button type="button" onClick={onOpenSettings} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Open settings</button>
          </div>
        </div> : <div ref={transcriptRef} className="mx-auto h-full max-w-2xl overflow-y-auto rounded-xl border border-surface-800 bg-surface-950/55 p-4" aria-label="Live transcript" aria-live="polite">
          {messages.length === 0 ? <div className="flex h-full min-h-28 items-center justify-center text-center text-xs text-surface-500">Your conversation will appear here while the session is open.</div> : <div className="space-y-4">
            {messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[82%]' : 'mr-auto max-w-[82%]'}>
              <div className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${message.role === 'user' ? 'text-right text-surface-300' : 'text-surface-500'}`}>{message.role === 'user' ? 'You' : 'AI'}</div>
              <p className={`rounded-xl px-3.5 py-2.5 text-sm leading-5 ${message.role === 'user' ? 'bg-surface-800 text-foreground' : 'border border-surface-800 bg-surface-900 text-surface-200'}`}>{message.text}</p>
            </div>)}
          </div>}
          {activity && <div role="status" className={`mt-4 rounded-lg border px-3 py-2 text-xs ${activity.state === 'failed' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-surface-700 bg-surface-900 text-surface-200'}`}>{activity.state === 'failed' ? activity.message : `Using ${activity.toolName.replaceAll('_', ' ')}`}</div>}
          {approval && <ApprovalCard approval={approval} onConfirm={() => controllerRef.current?.approve(approval.callId)} onReject={() => controllerRef.current?.reject(approval.callId)} />}
        </div>}
      </section>

      <footer className="flex items-center justify-center gap-3 border-t border-surface-800 bg-surface-950/70 px-6 py-4">
        {!active ? <button type="button" aria-label={status === 'error' ? (mode === 'voice' ? 'Try voice call again' : 'Try chat again') : mode === 'voice' ? 'Start voice call' : 'Start chat'} disabled={serviceReady !== true} onClick={() => void start()} className="inline-flex min-w-32 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-black/40 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">{mode === 'voice' ? <Mic size={17} /> : <Keyboard size={17} />}{status === 'error' ? 'Try again' : mode === 'voice' ? 'Start voice' : 'Start chat'}</button> : mode === 'chat' ? <form className="flex w-full max-w-2xl items-end gap-2" onSubmit={(event) => { event.preventDefault(); send() }}>
          <textarea aria-label="Message" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} placeholder="Message the agent" className="max-h-32 min-h-10 flex-1 resize-y rounded-xl border border-surface-700 bg-surface-900 px-3 py-2.5 text-sm text-surface-100 outline-none focus:border-surface-400" />
          <button type="submit" aria-label="Send message" disabled={!draft.trim() || status === 'connecting'} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"><Send size={17} /></button>
          <button type="button" aria-label="End chat" onClick={() => controllerRef.current?.end()} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-500/90 text-white"><PhoneOff size={17} /></button>
        </form> : <>
          <button type="button" aria-label={status === 'muted' ? 'Unmute microphone' : 'Mute microphone'} disabled={!canMute} onClick={() => controllerRef.current?.toggleMute()} className={`inline-flex h-11 w-11 items-center justify-center rounded-full border disabled:opacity-40 ${status === 'muted' ? 'border-amber-400/50 bg-amber-400/10 text-amber-300' : 'border-surface-700 bg-surface-800 text-surface-200 hover:bg-surface-700'}`}>{status === 'muted' ? <MicOff size={18} /> : <Mic size={18} />}</button>
          <button type="button" aria-label="End voice call" onClick={() => controllerRef.current?.end()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-500/90 text-white hover:bg-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"><PhoneOff size={18} /></button>
        </>}
      </footer>
    </div>
    <audio ref={audioRef} autoPlay className="hidden" />
  </div>
}

function ApprovalCard({ approval, onConfirm, onReject }: {
  approval: LiveToolApproval
  onConfirm: () => void
  onReject: () => void
}): React.ReactElement {
  const args = approval.arguments
  const rows = approval.toolName === 'ego_record_transaction'
    ? [
      ['Account', String(args.accountId ?? '')],
      ['Amount', typeof args.amountCents === 'number' ? `$${(args.amountCents / 100).toFixed(2)}` : ''],
      ['Merchant', String(args.merchant ?? args.notes ?? '')],
      ['Date', String(args.date ?? '')],
      ['Category', String(args.categoryId ?? '')]
    ]
    : [
      ['Board', String(args.boardId ?? '')],
      ['List', String(args.listId ?? '')],
      ['Title', String(args.title ?? '')],
      ['Description', String(args.description ?? '')]
    ]
  return <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4" role="alert">
    <div className="text-sm font-semibold text-amber-100">{approval.summary}</div>
    <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([label, value]) => <React.Fragment key={label}><span className="text-amber-200/60">{label}</span><span className="break-words text-surface-100">{value || 'None'}</span></React.Fragment>)}
    </div>
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onReject} className="rounded-lg border border-surface-600 px-3 py-2 text-xs text-surface-200">Reject</button>
      <button type="button" onClick={onConfirm} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-amber-950">Confirm</button>
    </div>
  </div>
}
