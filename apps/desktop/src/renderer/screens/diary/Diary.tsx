import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, BookOpen, ChevronDown, Search, X } from 'lucide-react'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { Composer, type ComposerHandle } from '../../components/diary/Composer'
import { ChatContext, type ChatContextValue } from '../../components/diary/context'
import { MediaViewer } from '../../components/diary/MediaViewer'
import { DaySeparator, Message } from '../../components/diary/Message'
import { MessageMenu, PinnedBar, SearchPanel, type MenuActions, type MenuTarget } from '../../components/diary/Panels'
import { ink } from '../../components/diary/theme'
import { CenteredMessage, Screen } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { DiaryAudioProvider } from '../../lib/diary/audio'
import { buildRows, buildViewerItems, subtitle, tagCounts } from '../../lib/diary/chat'
import { mediaSource } from '../../lib/diary/media'
import { followUploadProgress } from '../../lib/diary/progress'
import { useDiary } from '../../lib/diary/use-diary'
import { useLedger } from '../../lib/ledger'

/** Rows drawn at first, and added each time the reader scrolls near the oldest one drawn. */
const PAGE = 60
/** How far from the newest message the jump-down button appears, in pixels. */
const AWAY = 600

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function Header({ messages, onSearch }: { messages: readonly LocalDiaryMessage[] | null; onSearch?: () => void }): React.ReactElement {
  return <header className="flex min-h-14 shrink-0 select-none items-center gap-3 border-b border-border px-5">
    <div className="min-w-0">
      <h1 className="text-[17px] font-bold leading-tight">Diary</h1>
      {messages && <p className="text-[12px] text-muted-foreground">{subtitle(messages)}</p>}
    </div>
    {onSearch && <div className="ml-auto flex items-center gap-1">
      <IconButton label="Search the diary" onClick={onSearch}><Search size={20} /></IconButton>
    </div>}
  </header>
}

function Notice({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <CenteredMessage Icon={BookOpen} title={title} detail={detail} action={action} onAction={onAction} />
}

/** The phone's diary: Telegram's Saved Messages, newest at the bottom. */
export default function Diary(): React.ReactElement {
  return <DiaryAudioProvider><DiaryChat /></DiaryAudioProvider>
}

function DiaryChat(): React.ReactElement {
  const ledger = useLedger()
  const diary = useDiary()
  const navigate = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const [replyTo, setReplyTo] = useState<LocalDiaryMessage | null>(null)
  const [editing, setEditing] = useState<LocalDiaryMessage | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [deleting, setDeleting] = useState<LocalDiaryMessage | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [viewerStart, setViewerStart] = useState<number | null>(null)
  const [pinIndex, setPinIndex] = useState(0)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingJump, setPendingJump] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [dragging, setDragging] = useState(false)

  useEffect(() => followUploadProgress(), [])

  const syncOnOpen = useRef(ledger.sync)
  useEffect(() => {
    void syncOnOpen.current()
  }, [])

  const messages = diary.messages
  const byId = useMemo(() => new Map((messages ?? []).map((message) => [message.id, message])), [messages])
  const rows = useMemo(() => buildRows(messages ?? []), [messages])
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows])
  const pinned = useMemo(() => (messages ?? []).filter((message) => message.pinnedAt)
    .sort((left, right) => (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '')), [messages])
  const viewerItems = useMemo(() => buildViewerItems(messages ?? []), [messages])
  const tags = useMemo(() => tagCounts(messages ?? []), [messages])
  const visibleRows = useMemo(() => rows.slice(Math.max(0, rows.length - shown)), [rows, shown])

  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 1600)
    return () => clearTimeout(timer)
  }, [highlight])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  const jumpTo = useCallback((id: string) => {
    if (!rowIndex.has(`m-${id}`)) {
      setToast('That message is no longer in the diary')
      return
    }
    setSearching(false)
    setPendingJump(id)
  }, [rowIndex])

  useEffect(() => {
    if (!pendingJump) return
    const index = rowIndex.get(`m-${pendingJump}`)
    if (index === undefined) {
      setPendingJump(null)
      return
    }
    const needed = rows.length - index + PAGE / 2
    if (needed > shown) {
      setShown(needed)
      return
    }
    const target = pendingJump
    setPendingJump(null)
    setHighlight(target)
    requestAnimationFrame(() => {
      scroller.current?.querySelector(`[data-message-id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [pendingJump, rowIndex, rows.length, shown])

  /** Draws older rows while the oldest drawn is close to the top, or while the column does not fill the window. */
  const fillOlder = useCallback((): void => {
    const area = scroller.current
    if (!area) return
    const fromBottom = -area.scrollTop
    const fromTop = area.scrollHeight - area.clientHeight - fromBottom
    setAwayFromBottom(fromBottom > AWAY)
    if (fromTop < AWAY * 1.5) setShown((count) => count < rows.length ? Math.min(rows.length, count + PAGE) : count)
  }, [rows.length])

  useEffect(() => {
    if (!searching) fillOlder()
  }, [fillOlder, searching, visibleRows])

  const toNewest = useCallback((): void => {
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const chat = useMemo<ChatContextValue>(() => ({
    source: (mediaId) => mediaSource(diary.localFiles, mediaId),
    openViewer: (mediaId) => {
      const index = viewerItems.findIndex((item) => item.attachment.mediaId === mediaId)
      if (index >= 0) setViewerStart(index)
    },
    onHashtag: (tag) => {
      setQuery(tag)
      setSearching(true)
    }
  }), [diary.localFiles, viewerItems])

  const { setPinned, retry } = diary
  const actions = useMemo<MenuActions>(() => ({
    reply: (message) => {
      setEditing(null)
      setReplyTo(message)
    },
    copy: (message) => {
      void navigator.clipboard.writeText(message.text).then(() => setToast('Copied'), () => undefined)
    },
    edit: (message) => {
      setReplyTo(null)
      setEditing(message)
    },
    pin: (message, pin) => {
      void setPinned(message, pin)
    },
    retry: (message) => {
      void retry(message)
    },
    remove: setDeleting
  }), [retry, setPinned])

  const openMenu = useCallback((message: LocalDiaryMessage, at: { x: number; y: number }) => {
    setMenu({ message, ...at })
  }, [])

  const openSearch = useCallback((): void => {
    setQuery('')
    setSearching(true)
  }, [])

  const ready = Boolean(messages && ledger.db)
  useEffect(() => {
    if (!ready) return
    const keys = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setSearching(true)
    }
    const paste = (event: ClipboardEvent): void => {
      const pasted = Array.from(event.clipboardData?.files ?? [])
      if (event.defaultPrevented || pasted.length === 0 || searching) return
      event.preventDefault()
      composer.current?.addFiles(pasted)
    }
    window.addEventListener('keydown', keys)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', keys)
      window.removeEventListener('paste', paste)
    }
  }, [ready, searching])

  const header = searching
    ? <header className="flex min-h-14 shrink-0 items-center gap-1 border-b px-3" style={{ borderColor: ink.line }}>
      <IconButton label="Close search" onClick={() => setSearching(false)}><ArrowLeft size={20} /></IconButton>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          setSearching(false)
        }}
        autoFocus
        type="search"
        aria-label="Search the diary"
        placeholder="Search the diary"
        className="min-w-0 flex-1 bg-transparent py-2 text-[17px] outline-none placeholder:text-surface-500 [&::-webkit-search-cancel-button]:hidden"
        style={{ color: ink.text }}
      />
      {query.length > 0 && <IconButton label="Clear" onClick={() => setQuery('')}><X size={20} /></IconButton>}
    </header>
    : <Header messages={messages} onSearch={ready ? openSearch : undefined} />

  if (!ledger.enabled) {
    return <Screen>{header}<Notice
      title="Sign in to keep a diary"
      detail="Sign in once with Google on the start screen. Messages then save on this computer and sync to D1."
      action="Go to sign in"
      onAction={() => navigate('/')}
    /></Screen>
  }
  if (ledger.error) return <Screen>{header}<Notice title="This computer cannot open its database" detail={ledger.error} /></Screen>
  if (!messages || !ledger.db) {
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <Screen>{header}<Notice title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} /></Screen>
    }
    if (stopped) {
      return <Screen>{header}<Notice
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, the diary opens offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      /></Screen>
    }
    return <Screen>{header}<div className="flex flex-1 items-center justify-center"><Spinner /></div></Screen>
  }

  return <ChatContext.Provider value={chat}>
    <Screen className="bg-background">
      {header}
      {searching && <SearchPanel query={query} messages={messages} tags={tags} onPick={(message) => jumpTo(message.id)} onTag={setQuery} />}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ display: searching ? 'none' : undefined }}
        onDragOver={(event) => {
          if (!hasFiles(event) || editing) return
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
          composer.current?.addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {pinned.length > 0 && <PinnedBar pinned={pinned} index={pinIndex % pinned.length} onPress={() => {
          const target = pinned[pinIndex % pinned.length]
          if (target) jumpTo(target.id)
          setPinIndex((current) => (current + 1) % pinned.length)
        }} />}
        {diary.error && <button type="button" onClick={diary.dismissError} className="flex w-full items-center gap-2 bg-red-500/10 px-5 py-2.5 text-left">
          <span className="flex-1 text-[14px] leading-5 text-red-300">{diary.error}</span>
          <X color="#fca5a5" size={16} />
        </button>}
        <div className="relative min-h-0 flex-1">
          {rows.length === 0
            ? ledger.current
              ? <Notice title="Your diary is empty" detail="Write something, or send a photo, a voice note, or a file. It stays on this computer and syncs to your account." />
              : <div className="flex h-full flex-col items-center justify-center">
                <Spinner />
                <p className="mt-3 text-[14px] text-muted-foreground">Downloading your diary</p>
              </div>
            : <div ref={scroller} onScroll={fillOlder} className="flex h-full flex-col-reverse overflow-y-auto [overflow-anchor:none]">
              <div className="mx-auto w-full max-w-3xl py-2">
                {visibleRows.map((row) => row.kind === 'day'
                  ? <DaySeparator key={row.key} label={row.label} />
                  : <Message
                    key={row.key}
                    message={row.message}
                    replyTarget={row.message.replyToId ? byId.get(row.message.replyToId) ?? null : undefined}
                    highlighted={highlight === row.message.id}
                    onMenu={openMenu}
                    onReply={actions.reply}
                    onJump={jumpTo}
                    onRetry={actions.retry}
                  />)}
              </div>
            </div>}
          {toast && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-2xl px-3.5 py-[7px] text-[14px]" style={{ backgroundColor: ink.tile }}>
            {toast}
          </div>}
          {awayFromBottom && <button
            type="button"
            aria-label="Go to the newest message"
            title="Go to the newest message"
            onClick={toNewest}
            className="absolute bottom-3.5 right-5 flex h-11 w-11 items-center justify-center rounded-full border transition-colors hover:bg-surface-700"
            style={{ backgroundColor: ink.tile, borderColor: ink.line }}
          ><ChevronDown color={ink.text} size={22} /></button>}
        </div>
        <Composer
          ref={composer}
          db={ledger.db}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSend={async (draft) => {
            const saved = await diary.send(draft)
            if (saved) toNewest()
            return saved
          }}
          onEdit={diary.edit}
        />
        {dragging && <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-3xl border-2 border-dashed border-surface-500 bg-background/85">
          <p className="text-[18px] font-semibold">Drop files to send them</p>
        </div>}
      </div>
      <MessageMenu target={menu} actions={actions} onClose={() => setMenu(null)} />
      <ConfirmDialog
        visible={deleting !== null}
        title="Delete this message?"
        detail="It disappears from the diary on every device."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) void diary.remove(target)
        }}
      />
      <MediaViewer items={viewerItems} start={viewerStart} onClose={() => setViewerStart(null)} />
    </Screen>
  </ChatContext.Provider>
}
