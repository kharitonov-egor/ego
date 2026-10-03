import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Play, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react'
import type { TaskCardRecord } from '@ego/api-contracts'
import type { TaskAttachment } from '@ego/core'
import { extensionLabel, sizeLabel } from '@ego/local/diary/format'
import { mediaUrl } from '../../../shared/local'
import { useBlur } from '../../lib/blur'
import { useTasks } from '../../lib/tasks/context'
import { useUploadProgress } from '../../lib/tasks/progress'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { ConfirmDialog, Modal } from '../ui/dialog'
import { Spinner } from '../ui/spinner'
import { TaskImage, imageVersion } from './ui'

function ViewerButton({ label, onClick, children, className }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={cn('flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/15', className)}
  >{children}</button>
}

/** Photos and videos one at a time over the whole window. Left and right arrows step through them. */
function Viewer({ items, start, onClose }: { items: readonly TaskAttachment[]; start: number | null; onClose: () => void }): React.ReactElement {
  const [index, setIndex] = useState(start ?? 0)
  useEffect(() => { if (start !== null) setIndex(start) }, [start])
  const visible = start !== null && items.length > 0
  const step = (delta: number): void => setIndex((current) => (current + delta + items.length) % items.length)
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLVideoElement) return
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const item = items[Math.min(index, items.length - 1)]
  return <Modal visible={visible} onClose={onClose} dismissOnBackdrop className="relative -m-6 flex h-[calc(100%+3rem)] w-[calc(100%+3rem)] flex-col bg-black p-6">
    {item && <>
      <div className="flex items-center gap-2 pb-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">{item.fileName ?? (item.kind === 'video' ? 'Video' : 'Photo')}</p>
          <p className="text-[13px] text-surface-300">{index + 1} of {items.length}</p>
        </div>
        <ViewerButton label="Close" onClick={onClose}><X size={22} /></ViewerButton>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        {item.kind === 'photo'
          ? <img key={item.id} src={mediaUrl(item.mediaId, 'tasks')} alt={item.fileName ?? 'Photo'} draggable={false} className="max-h-full max-w-full object-contain" />
          : <video
            key={item.id}
            src={mediaUrl(item.mediaId, 'tasks')}
            poster={item.previewId ? mediaUrl(item.previewId, 'tasks') : undefined}
            controls
            autoPlay
            className="max-h-full max-w-full"
          />}
      </div>
      {items.length > 1 && <>
        <ViewerButton label="Previous" onClick={() => step(-1)} className="absolute left-6 top-1/2 -translate-y-1/2"><ChevronLeft size={24} /></ViewerButton>
        <ViewerButton label="Next" onClick={() => step(1)} className="absolute right-6 top-1/2 -translate-y-1/2"><ChevronRight size={24} /></ViewerButton>
      </>}
    </>}
  </Modal>
}

function UploadBar({ mediaId }: { mediaId: string }): React.ReactElement | null {
  const share = useUploadProgress(mediaId)
  if (share === null) return null
  return <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
    <div className="h-1 bg-white transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
  </div>
}

function MediaTile({ item, version, onOpen, onRemove }: {
  item: TaskAttachment
  version: string
  onOpen: () => void
  onRemove: () => void
}): React.ReactElement {
  const { blurred } = useBlur()
  return <div
    className="group relative aspect-square overflow-hidden rounded-xl bg-surface-900"
    onContextMenu={(event) => {
      event.preventDefault()
      onRemove()
    }}
  >
    <button type="button" aria-label={item.kind === 'video' ? 'Play video' : 'View photo'} onClick={onOpen} className="absolute inset-0 hover:opacity-90">
      {!blurred && (item.previewId || item.kind === 'photo') && <TaskImage mediaId={item.previewId ?? item.mediaId} version={version} className="h-full w-full" />}
      {item.kind === 'video' && <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60"><Play color="#fafafa" fill="#fafafa" size={16} /></span>
      </span>}
    </button>
    <button
      type="button"
      aria-label={`Remove ${item.fileName ?? (item.kind === 'video' ? 'video' : 'photo')}`}
      title="Remove"
      onClick={onRemove}
      className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
    ><Trash2 color="#fafafa" size={15} /></button>
    <UploadBar mediaId={item.mediaId} />
  </div>
}

function FileRow({ attachment, onRemove }: { attachment: TaskAttachment; onRemove: () => void }): React.ReactElement {
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const sending = useUploadProgress(attachment.mediaId)
  const open = async (): Promise<void> => {
    if (opening) return
    setProblem(null)
    setOpening(true)
    try {
      const failure = await window.api.mediaOpen({ mediaId: attachment.mediaId, scope: 'tasks', fileName: attachment.fileName, mimeType: attachment.mimeType })
      if (failure) setProblem('No app on this computer opened it')
    } catch {
      setProblem('No app on this computer opened it')
    } finally {
      setOpening(false)
    }
  }
  const detail = problem ?? (sending !== null
    ? `Uploading ${Math.round(sending * 100)}%`
    : [sizeLabel(attachment.size), extensionLabel(attachment.fileName, attachment.mimeType)].filter(Boolean).join(' · '))
  return <div
    className="flex min-h-16 items-center rounded-xl bg-surface-900 px-3 py-2 hover:bg-surface-800"
    onContextMenu={(event) => {
      event.preventDefault()
      onRemove()
    }}
  >
    <button type="button" aria-label={`Open ${attachment.fileName ?? 'file'}`} onClick={() => void open()} className="flex min-w-0 flex-1 items-center text-left">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-800">
        {opening ? <Spinner size={18} /> : <FileText color={color.textSecondary} size={21} />}
      </span>
      <span className="ml-3 min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-[15px] font-semibold text-surface-100">{attachment.fileName ?? 'File'}</span>
        <span className={cn('block text-[13px]', problem ? 'text-rose-300' : 'text-muted-foreground')}>{detail}</span>
      </span>
    </button>
    <button type="button" aria-label={`Remove ${attachment.fileName ?? 'file'}`} title="Remove" onClick={onRemove} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-700">
      <Trash2 color={color.textFaint} size={17} />
    </button>
  </div>
}

/** Photos and videos as a grid, other files as rows that open in the Windows app that handles them. */
export function CardAttachments({ card }: { card: TaskCardRecord }): React.ReactElement | null {
  const tasks = useTasks()
  const [viewing, setViewing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<TaskAttachment | null>(null)
  const media = card.attachments.filter((item) => item.kind !== 'file')
  const files = card.attachments.filter((item) => item.kind === 'file')
  const upload = tasks.data?.uploads.get(card.id)
  if (card.attachments.length === 0) return null
  return <div>
    {upload && <div className="mb-3 flex items-center rounded-xl bg-surface-900 px-3 py-2.5">
      {upload === 'sending'
        ? <><Spinner size={16} color="#a3a3a3" /><span className="ml-3 flex-1 text-[14px] text-surface-300">Uploading. The card saves on other devices once the files are up.</span></>
        : <>
          <TriangleAlert color={color.attention} size={18} />
          <span className="ml-3 flex-1 text-[14px] text-surface-300">A file did not upload.</span>
          <button type="button" onClick={() => void tasks.retryUploads(card.id)} className="flex items-center rounded-lg px-1.5 py-0.5 hover:bg-surface-800">
            <RotateCcw color="#fafafa" size={15} />
            <span className="ml-1 text-[14px] font-semibold text-white">Retry</span>
          </button>
        </>}
    </div>}
    {media.length > 0 && <div className="grid grid-cols-3 gap-1.5">
      {media.map((item, index) => <MediaTile key={item.id} item={item} version={imageVersion(card, upload)} onOpen={() => setViewing(index)} onRemove={() => setRemoving(item)} />)}
    </div>}
    {files.length > 0 && <div className={cn('flex flex-col gap-2', media.length > 0 && 'mt-3')}>
      {files.map((item) => <FileRow key={item.id} attachment={item} onRemove={() => setRemoving(item)} />)}
    </div>}
    {media.length > 0 && <p className="mt-2 text-[13px] text-surface-500">Right-click a photo to remove it.</p>}
    <Viewer items={media} start={viewing} onClose={() => setViewing(null)} />
    <ConfirmDialog
      visible={removing !== null}
      title="Remove this attachment?"
      detail="It comes off the card on every device."
      confirmLabel="Remove"
      destructive
      onCancel={() => setRemoving(null)}
      onConfirm={() => {
        if (removing) void tasks.removeFile(card.id, removing.id)
        setRemoving(null)
      }}
    />
  </div>
}
