import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, Check, FileText, Film, Mic, Music, Paperclip, Pencil, Reply, X, type LucideIcon } from 'lucide-react'
import { DIARY_ATTACHMENT_LIMIT, diaryPreviewText } from '@ego/core'
import type { LocalDatabase } from '@ego/local/database/types'
import { diaryDraftStore } from '@ego/local/diary/draft'
import { durationLabel, levelFromDecibels, sizeLabel, waveformBars } from '@ego/local/diary/format'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { useAutosize } from '../../hooks/useAutosize'
import { discardDraft, draftsFromFiles, voiceDraft, type DraftFile } from '../../lib/diary/compose'
import type { DiaryDraft } from '../../lib/diary/use-diary'
import { cn } from '../../lib/utils'
import { ink } from './theme'

const VOICE_TYPE = 'audio/webm;codecs=opus'
const SHORTEST_VOICE_SECONDS = 0.7
/** A press shorter than this is a click: the recording keeps going until the send button. */
const HOLD_MS = 350

function RoundButton({ label, onPress, Icon, filled = false, disabled = false }: {
  label: string
  onPress: () => void
  Icon: LucideIcon
  filled?: boolean
  disabled?: boolean
}): React.ReactElement {
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onPress}
    disabled={disabled}
    style={{ backgroundColor: filled ? ink.text : undefined }}
    className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
      filled ? 'hover:opacity-90' : 'hover:bg-surface-800')}
  >
    <Icon color={filled ? ink.screen : ink.secondary} size={filled ? 20 : 23} strokeWidth={filled ? 2.5 : 2} />
  </button>
}

function ContextBar({ Icon, title, detail, onClose }: { Icon: LucideIcon; title: string; detail: string; onClose: () => void }): React.ReactElement {
  return <div className="flex items-center pl-3.5 pr-1.5 pt-2">
    <Icon color={ink.text} size={18} className="shrink-0" />
    <div className="ml-2.5 min-w-0 flex-1 border-l-2 pl-2" style={{ borderColor: ink.text }}>
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="truncate text-[13px] text-surface-300">{detail}</p>
    </div>
    <button type="button" aria-label={`Cancel ${title.toLowerCase()}`} title="Cancel" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-800">
      <X color={ink.meta} size={18} />
    </button>
  </div>
}

function DraftThumb({ draft, onRemove }: { draft: DraftFile; onRemove: () => void }): React.ReactElement {
  const Icon = draft.kind === 'video' ? Film : draft.kind === 'audio' || draft.kind === 'voice' ? Music : FileText
  return <div style={{ backgroundColor: ink.tile }} className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl" title={draft.fileName ?? undefined}>
    {draft.kind === 'photo'
      ? <img src={draft.uri} alt="" draggable={false} className="h-[72px] w-[72px] object-cover" />
      : <div className="flex h-full flex-col items-center justify-center px-1">
        <Icon color={ink.secondary} size={22} />
        <span className="mt-1 w-full truncate text-center text-[11px] text-surface-300">
          {draft.kind === 'video' && draft.durationSeconds !== null ? durationLabel(draft.durationSeconds) : draft.fileName ?? sizeLabel(draft.size)}
        </span>
      </div>}
    <button
      type="button"
      aria-label="Remove this attachment"
      title="Remove"
      onClick={onRemove}
      style={{ backgroundColor: ink.scrim }}
      className="absolute right-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full hover:bg-black"
    ><X color={ink.text} size={13} /></button>
  </div>
}

interface Recording {
  recorder: MediaRecorder
  stream: MediaStream
  audio: AudioContext
  chunks: Blob[]
  levels: number[]
  startedAt: number
  timer: ReturnType<typeof setInterval>
}

/**
 * Hold the microphone to record and let go to send, or click it to start and click send to finish.
 * Escape throws the recording away. Levels come from the microphone stream, for the waveform.
 */
function useVoiceNote(onRecorded: (draft: DraftFile) => void, onNotice: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [latched, setLatched] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const session = useRef<Recording | null>(null)
  const starting = useRef<Promise<boolean> | null>(null)
  const pressedAt = useRef(0)
  const latest = useRef({ onRecorded, onNotice })
  latest.current = { onRecorded, onNotice }

  const start = useCallback(async (): Promise<boolean> => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      latest.current.onNotice('Allow the microphone for Ego in system settings to record voice messages.')
      return false
    }
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(VOICE_TYPE) ? VOICE_TYPE : undefined, audioBitsPerSecond: 64000
      })
      const audio = new AudioContext()
      void audio.resume().catch(() => undefined)
      const analyser = audio.createAnalyser()
      analyser.fftSize = 1024
      audio.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const chunks: Blob[] = []
      const levels: number[] = []
      const startedAt = performance.now()
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += sample * sample
        const rms = Math.sqrt(sum / samples.length)
        const next = levelFromDecibels(rms > 0 ? 20 * Math.log10(rms) : -60)
        levels.push(next)
        setLevel(next)
        setSeconds((performance.now() - startedAt) / 1000)
      }, 100)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.start(250)
      session.current = { recorder, stream, audio, chunks, levels, startedAt, timer }
      setSeconds(0)
      setLevel(0)
      setRecording(true)
      return true
    } catch {
      for (const track of stream.getTracks()) track.stop()
      latest.current.onNotice('This computer could not start recording.')
      return false
    }
  }, [])

  const finish = useCallback(async (keep: boolean): Promise<void> => {
    if (starting.current) await starting.current
    const active = session.current
    if (!active) return
    session.current = null
    setRecording(false)
    setLatched(false)
    clearInterval(active.timer)
    const length = (performance.now() - active.startedAt) / 1000
    const stopped = new Promise<void>((resolve) => {
      active.recorder.onstop = () => resolve()
    })
    try {
      if (active.recorder.state !== 'inactive') {
        active.recorder.stop()
        await stopped
      }
    } catch {
      latest.current.onNotice('The recording did not save.')
      return
    } finally {
      for (const track of active.stream.getTracks()) track.stop()
      void active.audio.close().catch(() => undefined)
    }
    if (!keep || length < SHORTEST_VOICE_SECONDS) {
      if (keep) latest.current.onNotice('Hold the microphone to record, and let go to send.')
      return
    }
    const blob = new Blob(active.chunks, { type: 'audio/webm' })
    if (blob.size === 0) {
      latest.current.onNotice('The recording did not save.')
      return
    }
    latest.current.onRecorded(voiceDraft(blob, 'audio/webm', Math.max(1, Math.round(length)), waveformBars(active.levels, 48)))
  }, [])

  const begin = useCallback((latch: boolean): void => {
    if (session.current || starting.current) return
    setLatched(latch)
    const begun = start()
    starting.current = begun
    void begun.finally(() => {
      if (starting.current === begun) starting.current = null
    })
  }, [start])

  useEffect(() => {
    if (!recording) return
    const keys = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void finish(false)
    }
    document.addEventListener('keydown', keys, true)
    return () => document.removeEventListener('keydown', keys, true)
  }, [finish, recording])

  useEffect(() => () => { void finish(false) }, [finish])

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pressedAt.current = performance.now()
      begin(false)
    },
    onPointerUp: (): void => {
      if (performance.now() - pressedAt.current < HOLD_MS) setLatched(true)
      else void finish(true)
    },
    onPointerCancel: (): void => { void finish(false) },
    onClick: (event: React.MouseEvent<HTMLButtonElement>): void => {
      if (event.detail === 0) begin(true)
    }
  }

  return { recording, latched, seconds, level, handlers, send: () => void finish(true), cancel: () => void finish(false) }
}

export interface ComposerHandle {
  /** Files dropped anywhere on the chat. */
  addFiles: (files: readonly File[]) => void
}

export function Composer({ ref, db, replyTo, editing, onCancelReply, onCancelEdit, onSend, onEdit }: {
  ref?: React.Ref<ComposerHandle>
  db: LocalDatabase
  replyTo: LocalDiaryMessage | null
  editing: LocalDiaryMessage | null
  onCancelReply: () => void
  onCancelEdit: () => void
  onSend: (draft: DiaryDraft) => Promise<boolean>
  onEdit: (message: LocalDiaryMessage, text: string) => Promise<boolean>
}): React.ReactElement {
  const store = useMemo(() => diaryDraftStore(db), [db])
  const draftState = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [editText, setEditText] = useState('')
  const text = editing ? editText : draftState.text
  const setText = editing ? setEditText : store.setText
  const [sending, setSending] = useState(false)
  const submitting = useRef(false)
  const [files, setFiles] = useState<DraftFile[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const editingId = editing?.id ?? null
  useAutosize(input, text)

  const editingNow = useRef(editing)
  editingNow.current = editing
  useEffect(() => {
    if (editingNow.current) setEditText(editingNow.current.text)
  }, [editingId])

  useEffect(() => {
    const area = input.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [editingId, replyTo?.id])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const sendVoice = (draft: DraftFile): void => {
    void onSend({ text: '', files: [draft], replyToId: replyTo?.id ?? null })
    onCancelReply()
  }
  const voice = useVoiceNote(sendVoice, setNotice)

  const addFiles = useCallback((picked: readonly File[]): void => {
    if (editingNow.current || picked.length === 0) return
    const next = draftsFromFiles(picked)
    setFiles((current) => {
      const room = DIARY_ATTACHMENT_LIMIT - current.length
      if (next.length > room) {
        setNotice(`One message holds up to ${DIARY_ATTACHMENT_LIMIT} files.`)
        next.slice(Math.max(0, room)).forEach(discardDraft)
      }
      return [...current, ...next.slice(0, Math.max(0, room))]
    })
    input.current?.focus()
  }, [])

  useImperativeHandle(ref, () => ({ addFiles }), [addFiles])

  const submit = async (): Promise<void> => {
    if (submitting.current || !draftState.ready) return
    if (!editing && !text.trim() && files.length === 0) return
    submitting.current = true
    setSending(true)
    try {
      if (editing) {
        if (await onEdit(editing, text)) onCancelEdit()
        return
      }
      const draft: DiaryDraft = { text, files, replyToId: replyTo?.id ?? null }
      if (await onSend(draft)) {
        if (store.getSnapshot().text === draft.text) store.setText('')
        setFiles([])
        onCancelReply()
      }
    } finally {
      submitting.current = false
      setSending(false)
    }
  }

  const canSend = editing !== null || text.trim().length > 0 || files.length > 0

  return <div className="shrink-0 border-t" style={{ backgroundColor: ink.screen, borderColor: ink.line }}>
    <div className="mx-auto max-w-3xl">
      {draftState.error && <p className="px-4 pt-2 text-[13px] text-red-300">This device could not save or load your draft.</p>}
      {notice && <button type="button" onClick={() => setNotice(null)} className="block px-3.5 pt-2 text-left text-[13px] text-surface-300">{notice}</button>}
      {editing
        ? <ContextBar Icon={Pencil} title="Edit message" detail={diaryPreviewText(editing)} onClose={onCancelEdit} />
        : replyTo && <ContextBar Icon={Reply} title="Reply" detail={diaryPreviewText(replyTo)} onClose={onCancelReply} />}
      {files.length > 0 && !editing && <div className="flex gap-2 overflow-x-auto px-3 pt-2.5">
        {files.map((draft) => <DraftThumb key={draft.key} draft={draft} onRemove={() => {
          discardDraft(draft)
          setFiles((current) => current.filter((item) => item.key !== draft.key))
        }} />)}
      </div>}
      <div className="flex min-h-14 items-end gap-1 px-1.5 py-1.5">
        {voice.recording
          ? <div key="recording" className="flex min-h-11 flex-1 items-center self-center pl-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ink.failed, opacity: 0.5 + voice.level / 200 }} />
            <span className="tabular ml-2.5 text-[16px] font-medium">{durationLabel(voice.seconds)}</span>
            <span className="flex flex-1 justify-center">
              {voice.latched
                ? <button type="button" onClick={voice.cancel} className="rounded-full px-3 py-1.5 text-[15px] font-semibold text-surface-300 hover:bg-surface-800">Cancel</button>
                : <span className="text-[15px] text-muted-foreground">Let go to send, or press Esc to cancel</span>}
            </span>
          </div>
          : <div key="typing" className="flex flex-1 items-end gap-1">
            {!editing && <RoundButton label="Attach photos, videos, or files" onPress={() => picker.current?.click()} Icon={Paperclip} />}
            <textarea
              ref={input}
              readOnly={!draftState.ready || sending}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && (editing || replyTo)) {
                  event.preventDefault()
                  if (editing) onCancelEdit()
                  else onCancelReply()
                  return
                }
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                void submit()
              }}
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData.files)
                if (pasted.length === 0 || editing) return
                event.preventDefault()
                addFiles(pasted)
              }}
              rows={1}
              autoFocus
              aria-label="Message"
              placeholder="Message"
              className="max-h-[150px] min-h-11 flex-1 resize-none rounded-[22px] px-4 py-[11px] text-[16px] leading-[21px] outline-none placeholder:text-surface-500"
              style={{ color: ink.text, backgroundColor: ink.bubble }}
            />
          </div>}
        {voice.recording && voice.latched
          ? <RoundButton key="send-voice" label="Send the voice message" onPress={voice.send} Icon={ArrowUp} filled />
          : canSend && !voice.recording
            ? <RoundButton key="send" disabled={!draftState.ready || sending} label={editing ? 'Save the edit' : 'Send'} onPress={() => void submit()} Icon={editing ? Check : ArrowUp} filled />
            : <button
              key="microphone"
              type="button"
              aria-label="Hold to record a voice message"
              title="Hold to record, or click to start"
              {...voice.handlers}
              style={{
                backgroundColor: voice.recording ? ink.text : undefined,
                transform: voice.recording ? 'scale(1.3)' : undefined
              }}
              className={cn('flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-full transition-transform', !voice.recording && 'hover:bg-surface-800')}
            >
              <Mic color={voice.recording ? ink.screen : ink.secondary} size={23} />
            </button>}
      </div>
    </div>
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        addFiles(Array.from(event.target.files ?? []))
        event.target.value = ''
      }}
    />
  </div>
}
