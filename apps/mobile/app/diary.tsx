import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, BackHandler, FlatList, Keyboard, Pressable, TextInput, View,
  type ViewToken
} from 'react-native'
import { useKeyboardVisible } from '../components/ui/keyboard'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { ArrowLeft, BookOpen, ChevronDown, LayoutGrid, Search, X } from 'lucide-react-native'
import { diaryHashtags } from '@ego/core'
import { ConflictEntries } from '../components/ConflictEntries'
import { Composer } from '../components/diary/Composer'
import { ChatContext, VisibleContext, type ChatContextValue } from '../components/diary/context'
import { VISUAL_KINDS } from '../components/diary/MediaGrid'
import { MediaViewer, type ViewerItem } from '../components/diary/MediaViewer'
import { DaySeparator, Message } from '../components/diary/Message'
import { MessageMenu, PinnedBar, SearchPanel, type MenuActions } from '../components/diary/Panels'
import { ink } from '../components/diary/theme'
import { HeaderIcon } from '../components/gym/ui'
import { BottomSheet, ConfirmDialog } from '../components/money/Common'
import { SyncButton } from '../components/money/SyncButton'
import { PrivateGate, useLocked } from '../components/PrivateGate'
import { Button } from '../components/ui/button'
import { Text } from '../components/ui/text'
import { DiaryAudioProvider } from '../lib/diary/audio'
import { dayKeyOf, dayLabel } from '../lib/diary/format'
import type { LocalDiaryMessage } from '../lib/diary/repository'
import { useDiary } from '../lib/diary/use-diary'
import { useLedger } from '../lib/ledger-context'

type Row =
  | { kind: 'message'; key: string; message: LocalDiaryMessage }
  | { kind: 'day'; key: string; label: string }

/** Newest first, because the list is inverted so it opens at the bottom like a chat. */
function buildRows(messages: readonly LocalDiaryMessage[]): Row[] {
  const now = new Date()
  const before = new Date(now)
  before.setDate(before.getDate() - 1)
  const today = dayKeyOf(now.toISOString())
  const yesterday = dayKeyOf(before.toISOString())
  const rows: Row[] = []
  let lastDay = ''
  for (const message of messages) {
    const day = dayKeyOf(message.sentAt)
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `d-${day}`, label: dayLabel(day, today, yesterday) })
      lastDay = day
    }
    rows.push({ kind: 'message', key: `m-${message.id}`, message })
  }
  return rows.reverse()
}

function buildViewerItems(messages: readonly LocalDiaryMessage[]): ViewerItem[] {
  const items: ViewerItem[] = []
  for (const message of messages) {
    message.attachments.forEach((attachment, index) => {
      if (!VISUAL_KINDS.has(attachment.kind) || (!attachment.mediaId && !attachment.previewId)) return
      items.push({ key: `${message.id}-${index}`, messageId: message.id, attachment, sentAt: message.sentAt, caption: message.text })
    })
  }
  return items
}

function tagCounts(messages: readonly LocalDiaryMessage[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const tag of diaryHashtags(message.text, message.entities)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, 60)
}

function Notice({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <BookOpen color="#737373" size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

export default function DiaryScreen(): React.ReactElement {
  return <PrivateGate label="Diary"><DiaryAudioProvider><DiaryChat /></DiaryAudioProvider></PrivateGate>
}

function DiaryChat(): React.ReactElement {
  const ledger = useLedger()
  const diary = useDiary()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const list = useRef<FlatList<Row>>(null)
  const [replyTo, setReplyTo] = useState<LocalDiaryMessage | null>(null)
  const [editing, setEditing] = useState<LocalDiaryMessage | null>(null)
  const [menuFor, setMenuFor] = useState<LocalDiaryMessage | null>(null)
  const [deleting, setDeleting] = useState<LocalDiaryMessage | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [viewerStart, setViewerStart] = useState<number | null>(null)
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set())
  const [pinIndex, setPinIndex] = useState(0)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingJump, setPendingJump] = useState<string | null>(null)
  const locked = useLocked()

  useEffect(() => {
    if (!locked) return
    setViewerStart(null)
    setMenuFor(null)
    setDeleting(null)
    setReviewing(false)
    setSearching(false)
    Keyboard.dismiss()
  }, [locked])

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
    Keyboard.dismiss()
    setPendingJump(id)
  }, [rowIndex])

  useEffect(() => {
    if (!pendingJump) return
    const target = pendingJump
    setPendingJump(null)
    const index = rowIndex.get(`m-${target}`)
    if (index === undefined) return
    setHighlight(target)
    // The list may have just become visible again, so the scroll waits a frame for its layout.
    setTimeout(() => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 }), 60)
  }, [pendingJump, rowIndex])

  useEffect(() => {
    if (!searching) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearching(false)
      return true
    })
    return () => subscription.remove()
  }, [searching])

  const chat = useMemo<ChatContextValue>(() => ({
    api: ledger.api,
    localFiles: diary.localFiles,
    openViewer: (mediaId) => {
      const index = viewerItems.findIndex((item) => item.attachment.mediaId === mediaId)
      if (index >= 0) {
        Keyboard.dismiss()
        setViewerStart(index)
      }
    },
    onHashtag: (tag) => {
      setQuery(tag)
      setSearching(true)
    }
  }), [diary.localFiles, ledger.api, viewerItems])

  const { setPinned, retry } = diary
  const actions = useMemo<MenuActions>(() => ({
    reply: (message) => {
      setEditing(null)
      setReplyTo(message)
    },
    copy: (message) => {
      void Clipboard.setStringAsync(message.text).then(() => setToast('Copied'))
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

  const onViewable = useRef(({ viewableItems }: { viewableItems: Array<ViewToken<Row>> }) => {
    const ids = new Set<string>()
    for (const token of viewableItems) if (token.item.kind === 'message') ids.add(token.item.message.id)
    setVisible(ids)
  }).current
  const viewability = useRef({ itemVisiblePercentThreshold: 40 }).current

  const openSearch = (): void => {
    setQuery('')
    setSearching(true)
  }

  const header = searching
    ? <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 6, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: ink.line }}>
        <HeaderIcon label="Close search" onPress={() => setSearching(false)}><ArrowLeft color="#fafafa" size={22} /></HeaderIcon>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search the diary"
          placeholderTextColor={ink.faint}
          returnKeyType="search"
          style={{ flex: 1, color: ink.text, fontSize: 17, paddingVertical: 8 }}
        />
        {query.length > 0 && <HeaderIcon label="Clear" onPress={() => setQuery('')}><X color="#a3a3a3" size={20} /></HeaderIcon>}
      </View>
    </>
    : <Stack.Screen options={{
      headerShown: true,
      headerTitle: () => <View style={{ alignItems: 'center' }}>
        <Text className="text-[17px] font-bold">Diary</Text>
        {messages && <Text className="text-[12px] text-muted-foreground">{subtitle(messages)}</Text>}
      </View>,
      headerTitleAlign: 'center',
      headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderIcon>,
      headerRight: () => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <HeaderIcon label="Search the diary" onPress={openSearch}><Search color="#fafafa" size={21} /></HeaderIcon>
        <SyncButton onReview={() => setReviewing(true)} />
      </View>
    }} />

  const review = <BottomSheet visible={reviewing} title="Needs attention" onClose={() => setReviewing(false)}>
    <ConflictEntries
      entries={ledger.conflicts}
      onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
      onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
    />
  </BottomSheet>

  if (!ledger.enabled) {
    return <>{header}<Notice
      title="Sign in to keep a diary"
      detail="Sign in once with Google on the start screen. Messages then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    /></>
  }
  if (ledger.error) return <>{header}<Notice title="This phone cannot open its database" detail={ledger.error} /></>
  if (!messages) {
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <>{header}<Notice title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} /></>
    }
    if (stopped) {
      return <>{header}<Notice
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, the diary opens offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      /></>
    }
    return <>{header}<View className="flex-1 items-center justify-center bg-background"><ActivityIndicator color="#fafafa" /></View></>
  }

  return <ChatContext.Provider value={chat}>
    <View style={{ flex: 1, backgroundColor: ink.screen }}>
      {header}
      {review}
      {searching && <View style={{ flex: 1 }}>
        <SearchPanel query={query} messages={messages} tags={tags} onPick={(message) => jumpTo(message.id)} onTag={setQuery} />
      </View>}
      <View style={{ flex: 1, display: searching ? 'none' : 'flex' }}>
        {pinned.length > 0 && <PinnedBar pinned={pinned} index={pinIndex % pinned.length} onPress={() => {
          const target = pinned[pinIndex % pinned.length]
          if (target) jumpTo(target.id)
          setPinIndex((current) => (current + 1) % pinned.length)
        }} />}
        {diary.error && <Pressable onPress={diary.dismissError} className="flex-row items-center gap-2 bg-red-500/10 px-4 py-2.5">
          <Text className="flex-1 text-[14px] leading-5 text-red-300">{diary.error}</Text>
          <X color="#fca5a5" size={16} />
        </Pressable>}
        <View style={{ flex: 1 }}>
          {rows.length === 0
            ? ledger.current
              ? <Notice title="Your diary is empty" detail="Write something, or send a photo, a voice note, or a file. It stays on this phone and syncs to your account." />
              : <View className="flex-1 items-center justify-center">
                <ActivityIndicator color="#fafafa" />
                <Text className="mt-3 text-[14px] text-muted-foreground">Downloading your diary</Text>
              </View>
            : <VisibleContext.Provider value={visible}>
              <FlatList
                ref={list}
                inverted
                data={rows}
                keyExtractor={(row) => row.key}
                extraData={highlight}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={14}
                maxToRenderPerBatch={10}
                windowSize={9}
                contentContainerStyle={{ paddingVertical: 8 }}
                onViewableItemsChanged={onViewable}
                viewabilityConfig={viewability}
                onScroll={(event) => {
                  const away = event.nativeEvent.contentOffset.y > 600
                  if (away !== awayFromBottom) setAwayFromBottom(away)
                }}
                scrollEventThrottle={100}
                onScrollToIndexFailed={(info) => {
                  list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
                  setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.4 }), 150)
                }}
                renderItem={({ item }) => item.kind === 'day'
                  ? <DaySeparator label={item.label} />
                  : <Message
                    message={item.message}
                    replyTarget={item.message.replyToId ? byId.get(item.message.replyToId) ?? null : undefined}
                    highlighted={highlight === item.message.id}
                    onLongPress={setMenuFor}
                    onReply={actions.reply}
                    onJump={jumpTo}
                    onRetry={actions.retry}
                  />}
              />
            </VisibleContext.Provider>}
          {toast && <View pointerEvents="none" style={{ position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: ink.tile, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 }}>
            <Text className="text-[14px]">{toast}</Text>
          </View>}
          {awayFromBottom && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to the newest message"
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
            style={{ position: 'absolute', right: 14, bottom: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: ink.tile, borderWidth: 1, borderColor: ink.line }}
            className="items-center justify-center"
          ><ChevronDown color={ink.text} size={22} /></Pressable>}
        </View>
        <Composer
          replyTo={replyTo}
          editing={editing}
          bottomInset={keyboardVisible ? 0 : insets.bottom}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSend={async (draft) => {
            const saved = await diary.send(draft)
            if (saved) list.current?.scrollToOffset({ offset: 0, animated: true })
            return saved
          }}
          onEdit={diary.edit}
        />
      </View>
      <MessageMenu message={menuFor} actions={actions} onClose={() => setMenuFor(null)} />
      <ConfirmDialog
        visible={deleting !== null}
        title="Delete this message?"
        detail="It disappears from the diary on every device."
        confirmLabel="Delete"
        destructive
        hideNavigation={false}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) void diary.remove(target)
        }}
      />
      <MediaViewer items={viewerItems} start={viewerStart} onClose={() => setViewerStart(null)} />
    </View>
  </ChatContext.Provider>
}

function subtitle(messages: readonly LocalDiaryMessage[]): string {
  const failed = messages.filter((message) => message.delivery === 'failed').length
  if (failed > 0) return failed === 1 ? '1 message did not send' : `${failed} messages did not send`
  const sending = messages.filter((message) => message.delivery === 'sending').length
  if (sending > 0) return sending === 1 ? 'Sending 1 message' : `Sending ${sending} messages`
  return messages.length === 1 ? '1 message' : `${messages.length} messages`
}
