import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ImagePlus, X } from 'lucide-react'
import { Button, IconButton } from '@ego/ui/components/ui/button'
import { Modal } from '@ego/ui/components/ui/dialog'
import { inputClass } from '@ego/ui/components/ui/input'
import { useLedger } from '@ego/ui/lib/ledger'
import { useTasks } from '@ego/ui/lib/tasks/context'
import { cardPath } from '@ego/ui/screens/tasks/nav'

interface Pasted {
  file: File
  preview: string
}

interface Toast {
  ok: boolean
  text: string
  cardId?: string
}

function isQuickAddKey(event: KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyN'
}

/** The desktop's Alt+N capture window as a dialog in the tab. Every card goes to the bottom of the Inbox. */
export function QuickAdd(): React.ReactElement {
  const ledger = useLedger()
  const tasks = useTasks()
  const navigate = useNavigate()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<Pasted[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)

  const reset = useCallback((): void => {
    setTitle('')
    setDescription('')
    setImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.preview)
      return []
    })
    setError(null)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isQuickAddKey(event)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) requestAnimationFrame(() => titleInput.current?.focus())
  }, [open])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.ok ? 4000 : 8000)
    return () => clearTimeout(timer)
  }, [toast])

  const close = (): void => {
    setOpen(false)
    reset()
  }

  const paste = (event: React.ClipboardEvent): void => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    const stamp = Date.now()
    setImages((current) => [...current, ...files.map((file, index): Pasted => ({
      file: file.name ? file : new File([file], `screenshot-${stamp}-${index}.png`, { type: file.type }),
      preview: URL.createObjectURL(file)
    }))])
  }

  const send = async (): Promise<void> => {
    if (!title.trim() || sending) return
    setSending(true)
    setError(null)
    const result = await tasks.addInboxCard(title, description, images.map((image) => image.file))
    setSending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    close()
    setToast({ ok: true, text: 'Card added to Inbox', cardId: result.id })
  }

  const submitOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return <>
    <Modal visible={open} onClose={close} labelledBy={titleId} className="w-full max-w-lg rounded-3xl border border-surface-800 bg-card p-6">
      <div onPaste={paste}>
        <h2 id={titleId} className="text-[20px] font-bold">New card in Inbox</h2>
        {!ledger.enabled
          ? <p className="mt-3 text-[15px] text-muted-foreground">Sign in to Ego first.</p>
          : <>
            <input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={submitOnEnter} placeholder="Title" aria-label="Title" maxLength={500} className={`${inputClass} mt-4`} />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={submitOnEnter} placeholder="Description" aria-label="Description" rows={4} className={`${inputClass} mt-3 h-auto resize-none py-3`} />
            {images.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{images.map((image, index) => <div key={image.preview} className="relative">
              <img src={image.preview} alt="" className="h-20 w-20 rounded-xl object-cover" />
              <IconButton label="Remove screenshot" onClick={() => setImages((current) => current.filter((_, at) => at !== index))} className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-surface-800">
                <X size={14} />
              </IconButton>
            </div>)}</div>}
            <p className="mt-3 flex items-center gap-2 text-[13px] text-surface-500"><ImagePlus size={14} />Paste screenshots with Ctrl+V. Enter sends, Shift+Enter adds a line.</p>
            {error && <p role="alert" className="mt-3 text-[14px] leading-5 text-destructive">{error}</p>}
            <div className="mt-5 flex gap-3">
              <Button variant="outline" size="lg" onClick={close} className="flex-1">Cancel</Button>
              <Button size="lg" disabled={!title.trim() || sending || !tasks.data} onClick={() => void send()} className="flex-1">{sending ? 'Adding...' : 'Add'}</Button>
            </div>
          </>}
      </div>
    </Modal>
    {toast && <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-surface-800 bg-popover px-4 py-3 text-[15px] shadow-lg">
      <span className={toast.ok ? 'text-positive' : 'text-destructive'}>{toast.text}</span>
      {toast.cardId && <button
        type="button"
        onClick={() => {
          if (toast.cardId) navigate(cardPath(toast.cardId))
          setToast(null)
        }}
        className="ml-3 font-semibold underline"
      >Open</button>}
    </div>}
  </>
}
