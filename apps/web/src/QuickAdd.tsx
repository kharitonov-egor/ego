import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { TrelloListSummary } from '@ego/core'
import { Button, IconButton } from '@ego/ui/components/ui/button'
import { Modal } from '@ego/ui/components/ui/dialog'
import { inputClass } from '@ego/ui/components/ui/input'
import { useLedger } from '@ego/ui/lib/ledger'
import type { QuickAddImage } from '@ego/ui/platform/types'

interface Pasted extends QuickAddImage {
  preview: string
}

interface Toast {
  ok: boolean
  text: string
  link?: string
}

function isQuickAddKey(event: KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyN'
}

/**
 * The desktop's Alt+N capture window as a dialog in the tab. Browsers keep Ctrl+number for
 * switching tabs, so the list is a picker instead of the desktop's list shortcuts.
 */
export function QuickAdd(): React.ReactElement {
  const ledger = useLedger()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<Pasted[]>([])
  const [lists, setLists] = useState<TrelloListSummary[]>([])
  const [listId, setListId] = useState('')
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
    if (!open || !ledger.enabled) return
    let active = true
    void (async () => {
      const [boardId, savedList] = await Promise.all([window.api.getTrelloBoardId(), window.api.getTrelloListId()])
      setListId(savedList)
      if (!boardId) return
      const result = await window.api.listTrelloLists(boardId)
      if (active && result.ok && result.data) setLists(result.data)
    })()
    requestAnimationFrame(() => titleInput.current?.focus())
    return () => { active = false }
  }, [open, ledger.enabled])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.ok ? 4000 : 8000)
    return () => clearTimeout(timer)
  }, [toast])

  const close = (): void => {
    setOpen(false)
    reset()
  }

  const paste = async (event: React.ClipboardEvent): Promise<void> => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    const added = await Promise.all(files.map(async (file, index): Promise<Pasted> => ({
      name: file.name || `screenshot-${Date.now()}-${index}.png`,
      mimeType: file.type,
      data: await file.arrayBuffer(),
      preview: URL.createObjectURL(file)
    })))
    setImages((current) => [...current, ...added])
  }

  const send = async (): Promise<void> => {
    if (!title.trim() || sending) return
    setSending(true)
    setError(null)
    const result = await window.api.submitQuickAdd({
      title: title.trim(),
      description,
      images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
      ...(listId ? { listId } : {})
    })
    setSending(false)
    if (!result.ok) {
      setError(result.detail ?? 'Trello did not take the card.')
      return
    }
    close()
    setToast({ ok: true, text: 'Card added to Trello', link: result.detail })
  }

  const submitOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return <>
    <Modal visible={open} onClose={close} labelledBy={titleId} className="w-full max-w-lg rounded-3xl border border-surface-800 bg-card p-6">
      <div onPaste={(event) => void paste(event)}>
        <h2 id={titleId} className="text-[20px] font-bold">Quick add to Trello</h2>
        {!ledger.enabled
          ? <p className="mt-3 text-[15px] text-muted-foreground">Sign in to Ego first.</p>
          : <>
            <input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={submitOnEnter} placeholder="Title" aria-label="Title" className={`${inputClass} mt-4`} />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={submitOnEnter} placeholder="Description" aria-label="Description" rows={4} className={`${inputClass} mt-3 h-auto resize-none py-3`} />
            {images.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{images.map((image, index) => <div key={image.preview} className="relative">
              <img src={image.preview} alt="" className="h-20 w-20 rounded-xl object-cover" />
              <IconButton label="Remove screenshot" onClick={() => setImages((current) => current.filter((_, at) => at !== index))} className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-surface-800">
                <X size={14} />
              </IconButton>
            </div>)}</div>}
            {lists.length > 0 && <select aria-label="List" value={listId} onChange={(event) => setListId(event.target.value)} className={`${inputClass} mt-3`}>
              {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>}
            {!listId && <p className="mt-3 text-[14px] text-attention">Choose a board and list under Quick add in Settings.</p>}
            <p className="mt-3 flex items-center gap-2 text-[13px] text-surface-500"><ImagePlus size={14} />Paste screenshots with Ctrl+V. Enter sends, Shift+Enter adds a line.</p>
            {error && <p role="alert" className="mt-3 text-[14px] leading-5 text-destructive">{error}</p>}
            <div className="mt-5 flex gap-3">
              <Button variant="outline" size="lg" onClick={close} className="flex-1">Cancel</Button>
              <Button size="lg" disabled={!title.trim() || !listId || sending} onClick={() => void send()} className="flex-1">{sending ? 'Sending...' : 'Send'}</Button>
            </div>
          </>}
      </div>
    </Modal>
    {toast && <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-surface-800 bg-popover px-4 py-3 text-[15px] shadow-lg">
      <span className={toast.ok ? 'text-positive' : 'text-destructive'}>{toast.text}</span>
      {toast.link && <a href={toast.link} target="_blank" rel="noreferrer" className="ml-3 font-semibold underline">Open</a>}
    </div>}
  </>
}
