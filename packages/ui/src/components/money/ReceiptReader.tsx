import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileImage, RotateCcw, ScanLine, Upload } from 'lucide-react'
import { MAX_TRANSACTION_IMAGE_BYTES, splitImageDataUrl, type AnalyzedTransactionDraft, type MoneySnapshot } from '@ego/core'
import { isWeb } from '../../lib/platform'
import { useMoney } from '../../lib/money'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'
import AnalyzedTransactionEditor from './AnalyzedTransactionEditor'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** What `analyzeTransactionImage` answers without a key, so the note and the error are one line. */
const KEY_NEEDED = 'Add an OpenRouter API key in Settings.'

async function readImage(file: File): Promise<{ base64: string; mimeType: string } | { error: string }> {
  if (!IMAGE_TYPES.includes(file.type)) return { error: 'Choose a JPEG, PNG, or WebP image.' }
  if (file.size > MAX_TRANSACTION_IMAGE_BYTES) return { error: 'This image is larger than 10 MB. Choose a smaller image.' }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable image'))
    reader.onerror = () => reject(new Error('Unreadable image'))
    reader.readAsDataURL(file)
  }).catch(() => '')
  if (!data) return { error: 'The image could not be read. Choose it again.' }
  return splitImageDataUrl(data) ?? { error: 'The image could not be read. Choose it again.' }
}

function imageIn(files: FileList | null | undefined): File | null {
  return Array.from(files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

type Phase =
  | { step: 'waiting' }
  | { step: 'reading' }
  | { step: 'checking'; draft: AnalyzedTransactionDraft }

interface ReceiptReaderValue {
  /** Opens the reader, ready for a paste, a drop, or the file picker. */
  open: () => void
  available: boolean
}

const ReceiptReaderContext = createContext<ReceiptReaderValue | null>(null)

/**
 * The desktop's own receipt reader, anywhere in Finance: paste an image with Ctrl+V, drop one on
 * the window, or pick one. The image goes to OpenRouter with this computer's key from Settings, or
 * the Worker's in a browser, and what comes back opens the phone's editor, which saves through the
 * outbox like any entry.
 */
export function ReceiptReaderProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { snapshot } = useMoney()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>({ step: 'waiting' })
  const [error, setError] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [keyMissing, setKeyMissing] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const live = useRef({ snapshot, visible, phase })
  live.current = { snapshot, visible, phase }

  useEffect(() => {
    if (!visible) return
    let active = true
    void window.api.getTransactionImageSettings()
      .then((settings) => { if (active) setKeyMissing(!settings.hasApiKey) })
      .catch(() => undefined)
    return () => { active = false }
  }, [visible])

  const analyze = useCallback(async (file: File): Promise<void> => {
    const current = live.current.snapshot
    if (!current) return
    setVisible(true)
    setError(null)
    const image = await readImage(file)
    if ('error' in image) {
      setError(image.error)
      return
    }
    setPhase({ step: 'reading' })
    try {
      const result = await window.api.analyzeTransactionImage({
        ...image,
        categories: current.categories
          .filter((item) => !item.archivedAt)
          .map(({ id, name, kind }) => ({ id, name, kind }))
      })
      if (result.ok) setPhase({ step: 'checking', draft: result.data })
      else {
        setPhase({ step: 'waiting' })
        setError(result.message)
      }
    } catch {
      setPhase({ step: 'waiting' })
      setError('Ego could not start image analysis. Try again.')
    }
  }, [])

  /**
   * Only while the reader waits for an image: an open entry or a receipt being checked keeps its
   * work, and pasted text goes where it always would.
   */
  useEffect(() => {
    const accepting = (): boolean => {
      const { snapshot: current, visible: open, phase: step } = live.current
      return Boolean(current) && step.step === 'waiting' && (open || !document.querySelector('[aria-modal="true"]'))
    }
    const paste = (event: ClipboardEvent): void => {
      if (!accepting()) return
      const file = imageIn(event.clipboardData?.files)
      if (!file) {
        if (live.current.visible) setError('The clipboard has no supported image.')
        return
      }
      event.preventDefault()
      void analyze(file)
    }
    const dragOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      const ok = accepting()
      if (event.dataTransfer) event.dataTransfer.dropEffect = ok ? 'copy' : 'none'
      setDropping(ok && !live.current.visible)
    }
    const dragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDropping(false)
    }
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      setDropping(false)
      if (!accepting()) return
      const file = imageIn(event.dataTransfer?.files)
      if (file) void analyze(file)
      else {
        setVisible(true)
        setError('Choose a JPEG, PNG, or WebP image.')
      }
    }
    document.addEventListener('paste', paste)
    document.addEventListener('dragover', dragOver)
    document.addEventListener('dragleave', dragLeave)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('paste', paste)
      document.removeEventListener('dragover', dragOver)
      document.removeEventListener('dragleave', dragLeave)
      document.removeEventListener('drop', drop)
    }
  }, [analyze])

  const close = (): void => {
    if (phase.step === 'reading') return
    setVisible(false)
    setPhase({ step: 'waiting' })
    setError(null)
  }
  const reset = (): void => {
    setPhase({ step: 'waiting' })
    setError(null)
  }

  const open = useCallback((): void => {
    if (live.current.snapshot) setVisible(true)
  }, [])
  const value = useMemo(() => ({ open, available: Boolean(snapshot) }), [open, snapshot])

  return <ReceiptReaderContext.Provider value={value}>
    <div className="relative flex h-full min-h-0 flex-col">
      {children}
      {dropping && <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-surface-400 bg-background/85">
        <ScanLine color="#fafafa" size={34} />
        <p className="mt-3 text-[20px] font-semibold">Drop a receipt to read it</p>
        <p className="mt-1 text-[15px] text-muted-foreground">Ego discards the image after OpenRouter reads it.</p>
      </div>}
    </div>

    <input
      ref={picker}
      type="file"
      accept={IMAGE_TYPES.join(',')}
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void analyze(file)
        event.target.value = ''
      }}
    />

    <Sheet visible={visible} title="Read a receipt" onClose={close} wide={phase.step === 'checking'}>
      {phase.step === 'checking' && snapshot
        ? <ReceiptCheck snapshot={snapshot} draft={phase.draft} onReset={reset} onSaved={(target) => {
          close()
          navigate(target === 'purchases' ? '/money/purchases' : '/money/transactions')
        }} />
        : <div className="flex flex-col items-center pb-2 text-center">
          <p className="max-w-sm text-[15px] leading-6 text-muted-foreground">Paste, drop, or choose one check, receipt, invoice, card slip, or screenshot. Ego discards the image after OpenRouter reads it.</p>
          {phase.step === 'reading'
            ? <div className="mt-8 flex items-center gap-2 text-[15px] text-surface-300"><Spinner size={18} />Reading image...</div>
            : <div className="mt-6 w-full rounded-2xl border border-dashed border-surface-700 bg-surface-950/60 p-6">
              <Upload className="mx-auto" color="#737373" size={22} />
              <p className="mt-2 text-[14px] text-surface-400">Drop an image here or press Ctrl+V</p>
              <Button onClick={() => picker.current?.click()} className="mt-4"><FileImage size={16} />Choose image</Button>
            </div>}
          {error && error !== KEY_NEEDED && <p aria-live="polite" className="mt-4 text-[15px] leading-5 text-destructive">{error}</p>}
          {(keyMissing || error === KEY_NEEDED) && phase.step === 'waiting' && (isWeb()
            ? <p className="mt-4 text-[15px] leading-5 text-attention">Add OPENROUTER_API_KEY to the Worker to read receipts.</p>
            : <div className="mt-4 flex flex-col items-center">
              <p className="text-[15px] leading-5 text-attention">{KEY_NEEDED}</p>
              <Button variant="outline" size="sm" onClick={() => { close(); navigate('/settings') }} className="mt-3">Open settings</Button>
            </div>)}
        </div>}
    </Sheet>
  </ReceiptReaderContext.Provider>
}

function ReceiptCheck({ snapshot, draft, onReset, onSaved }: {
  snapshot: MoneySnapshot
  draft: AnalyzedTransactionDraft
  onReset: () => void
  onSaved: (target: 'transactions' | 'purchases') => void
}): React.ReactElement {
  return <div>
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-[17px] font-semibold">Check the transaction</h3>
        <p className="mt-0.5 text-[15px] text-muted-foreground">Correct anything the model misread before saving.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onReset}><RotateCcw size={15} />Try another</Button>
    </div>
    <AnalyzedTransactionEditor snapshot={snapshot} draft={draft} onSaved={onSaved} />
  </div>
}

export function useReceiptReader(): ReceiptReaderValue {
  const context = useContext(ReceiptReaderContext)
  if (!context) throw new Error('useReceiptReader must be used inside ReceiptReaderProvider')
  return context
}
