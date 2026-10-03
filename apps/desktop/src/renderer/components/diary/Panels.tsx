import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Hash, Pencil, Pin, PinOff, Reply, RotateCw, Search, Trash2, type LucideIcon } from 'lucide-react'
import { diaryPreviewText, matchesDiaryQuery } from '@ego/core'
import { dateTimeLabel } from '@ego/local/diary/format'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { VISUAL_KINDS } from '../../lib/diary/chat'
import { useChat } from './context'
import { ink } from './theme'

function MenuRow({ Icon, label, destructive = false, onPress }: { Icon: LucideIcon; label: string; destructive?: boolean; onPress: () => void }): React.ReactElement {
  const color = destructive ? ink.failed : ink.text
  return <button
    type="button"
    role="menuitem"
    onClick={onPress}
    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors hover:bg-surface-800 focus-visible:bg-surface-800"
  >
    <Icon color={color} size={18} />
    <span style={{ color }} className="text-[15px] font-medium">{label}</span>
  </button>
}

export interface MenuActions {
  reply: (message: LocalDiaryMessage) => void
  copy: (message: LocalDiaryMessage) => void
  edit: (message: LocalDiaryMessage) => void
  pin: (message: LocalDiaryMessage, pinned: boolean) => void
  retry: (message: LocalDiaryMessage) => void
  remove: (message: LocalDiaryMessage) => void
}

export interface MenuTarget {
  message: LocalDiaryMessage
  x: number
  y: number
}

/**
 * The phone's long-press sheet, as a right-click menu at the pointer. A click elsewhere, Escape,
 * or scrolling the chat closes it.
 */
export function MessageMenu({ target, actions, onClose }: {
  target: MenuTarget | null
  actions: MenuActions
  onClose: () => void
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const element = panel.current
    if (!target || !element) {
      setPlace(null)
      return
    }
    const { width, height } = element.getBoundingClientRect()
    setPlace({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8))
    })
  }, [target])

  useEffect(() => {
    if (place) panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [place])

  useEffect(() => {
    if (!target) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const close = (): void => closeRef.current()
    const outside = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close()
    }
    const keys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      const at = items.findIndex((item) => item === document.activeElement)
      const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', keys, true)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('keydown', keys, true)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      if (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement)) previous?.focus()
    }
  }, [target])

  if (!target) return null
  const { message } = target
  const run = (action: (item: LocalDiaryMessage) => void): void => {
    onClose()
    action(message)
  }
  const hasText = Boolean(message.text.trim())
  const note = [message.source === 'telegram' ? 'Imported from Telegram' : null, message.editedAt ? `Edited ${dateTimeLabel(message.editedAt)}` : null]
    .filter(Boolean).join('. ')
  return createPortal(<div
    ref={panel}
    role="menu"
    aria-label={dateTimeLabel(message.sentAt)}
    onContextMenu={(event) => event.preventDefault()}
    className="fixed z-50 w-64 rounded-2xl border border-surface-800 bg-popover p-1.5 shadow-2xl shadow-black/60"
    style={{ left: place?.left ?? target.x, top: place?.top ?? target.y, visibility: place ? 'visible' : 'hidden' }}
  >
    <div className="px-3 pb-1.5 pt-1">
      <p className="text-[13px] font-semibold text-surface-300">{dateTimeLabel(message.sentAt)}</p>
      {note && <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{note}</p>}
    </div>
    <MenuRow Icon={Reply} label="Reply" onPress={() => run(actions.reply)} />
    {hasText && <MenuRow Icon={Copy} label="Copy text" onPress={() => run(actions.copy)} />}
    <MenuRow Icon={Pencil} label={hasText ? 'Edit' : 'Add a caption'} onPress={() => run(actions.edit)} />
    <MenuRow Icon={message.pinnedAt ? PinOff : Pin} label={message.pinnedAt ? 'Unpin' : 'Pin'} onPress={() => run((item) => actions.pin(item, !item.pinnedAt))} />
    {message.delivery === 'failed' && <MenuRow Icon={RotateCw} label="Try sending again" onPress={() => run(actions.retry)} />}
    <MenuRow Icon={Trash2} label="Delete" destructive onPress={() => run(actions.remove)} />
  </div>, document.body)
}

/** The newest pin first. A click jumps to it, and the next click moves to the pin before. */
export function PinnedBar({ pinned, index, onPress }: { pinned: readonly LocalDiaryMessage[]; index: number; onPress: () => void }): React.ReactElement | null {
  const message = pinned[index % Math.max(pinned.length, 1)]
  if (!message) return null
  return <button
    type="button"
    aria-label="Go to the pinned message"
    onClick={onPress}
    className="flex w-full shrink-0 items-center border-b px-5 py-2 text-left transition-colors hover:bg-surface-900"
    style={{ borderColor: ink.line }}
  >
    <span className="mr-2.5 flex flex-col gap-0.5">
      {pinned.length > 1
        ? pinned.slice(0, 4).map((item, position) => <span key={item.id} className="block w-0.5 rounded-sm" style={{
          height: Math.max(6, 32 / Math.min(pinned.length, 4) - 2),
          backgroundColor: position === index % 4 ? ink.text : ink.faint
        }} />)
        : <span className="block h-8 w-0.5 rounded-sm" style={{ backgroundColor: ink.text }} />}
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[13px] font-semibold">{pinned.length > 1 ? `Pinned message ${index + 1} of ${pinned.length}` : 'Pinned message'}</span>
      <span className="truncate text-[14px] text-surface-300">{diaryPreviewText(message)}</span>
    </span>
    <Pin color={ink.meta} size={16} className="shrink-0" />
  </button>
}

function ResultRow({ message, onPress }: { message: LocalDiaryMessage; onPress: () => void }): React.ReactElement {
  const { source } = useChat()
  const visual = message.attachments.find((item) => VISUAL_KINDS.has(item.kind))
  const thumbId = visual?.previewId ?? (visual?.kind === 'photo' ? visual.mediaId : null)
  return <button type="button" onClick={onPress} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-900 active:bg-surface-900">
    {thumbId
      ? <img src={source(thumbId)} alt="" draggable={false} loading="lazy" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
      : <span style={{ backgroundColor: ink.tile }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"><Search color={ink.faint} size={18} /></span>}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[13px] text-muted-foreground">{dateTimeLabel(message.sentAt)}</span>
      <span className="line-clamp-2 break-words text-[15px] leading-5">{diaryPreviewText(message)}</span>
    </span>
  </button>
}

const RESULT_PAGE = 100

/**
 * Search runs over this computer's own copy, so it works offline and answers as you type. With no
 * query it offers the hashtags you use most.
 */
export function SearchPanel({ query, messages, tags, onPick, onTag }: {
  query: string
  messages: readonly LocalDiaryMessage[]
  tags: ReadonlyArray<{ tag: string; count: number }>
  onPick: (message: LocalDiaryMessage) => void
  onTag: (tag: string) => void
}): React.ReactElement {
  const results = useMemo(() => query.trim()
    ? messages.filter((message) => matchesDiaryQuery(message.searchText, query)).reverse()
    : [], [messages, query])
  const [shown, setShown] = useState(RESULT_PAGE)
  const more = useRef<HTMLDivElement>(null)

  useEffect(() => setShown(RESULT_PAGE), [query])

  useEffect(() => {
    const sentinel = more.current
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setShown((count) => count + RESULT_PAGE)
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [results, shown])

  if (!query.trim()) {
    return <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <h2 className="mb-3 text-[14px] font-semibold text-muted-foreground">Hashtags</h2>
        {tags.length === 0 && <p className="text-[15px] text-muted-foreground">Type to search every message, file name, and song.</p>}
        <div className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => <button
            key={tag}
            type="button"
            onClick={() => onTag(tag)}
            className="flex items-center gap-1.5 rounded-full bg-surface-900 px-3 py-2 transition-colors hover:bg-surface-800 active:bg-surface-800"
          >
            <Hash color={ink.meta} size={13} />
            <span className="text-[15px]">{tag.slice(1)}</span>
            <span className="text-[13px] text-muted-foreground">{count}</span>
          </button>)}
        </div>
      </div>
    </div>
  }
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-3xl">
      <p className="px-4 py-2 text-[13px] text-muted-foreground">{results.length === 1 ? '1 message' : `${results.length} messages`}</p>
      {results.slice(0, shown).map((message) => <ResultRow key={message.id} message={message} onPress={() => onPick(message)} />)}
      {shown < results.length && <div ref={more} className="h-10" />}
    </div>
  </div>
}
