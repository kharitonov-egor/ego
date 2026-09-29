import React, { useMemo } from 'react'
import { FlatList, Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { Copy, Hash, Pencil, Pin, PinOff, Reply, RotateCw, Search, Trash2, type LucideIcon } from 'lucide-react-native'
import { diaryPreviewText, matchesDiaryQuery } from '@ego/core'
import { dateTimeLabel } from '../../lib/diary/format'
import { mediaSource } from '../../lib/diary/media'
import type { LocalDiaryMessage } from '../../lib/diary/repository'
import { BottomSheet } from '../money/Common'
import { Text } from '../ui/text'
import { useChat } from './context'
import { VISUAL_KINDS } from './MediaGrid'
import { ink } from './theme'

function MenuRow({ Icon, label, destructive = false, onPress }: { Icon: LucideIcon; label: string; destructive?: boolean; onPress: () => void }): React.ReactElement {
  const color = destructive ? ink.failed : ink.text
  return <Pressable accessibilityRole="button" onPress={onPress} className="min-h-14 flex-row items-center gap-4 rounded-2xl px-2 active:bg-surface-900">
    <Icon color={color} size={21} />
    <Text style={{ color }} className="text-[16px] font-medium">{label}</Text>
  </Pressable>
}

export interface MenuActions {
  reply: (message: LocalDiaryMessage) => void
  copy: (message: LocalDiaryMessage) => void
  edit: (message: LocalDiaryMessage) => void
  pin: (message: LocalDiaryMessage, pinned: boolean) => void
  retry: (message: LocalDiaryMessage) => void
  remove: (message: LocalDiaryMessage) => void
}

export function MessageMenu({ message, actions, onClose }: {
  message: LocalDiaryMessage | null
  actions: MenuActions
  onClose: () => void
}): React.ReactElement {
  const run = (action: (target: LocalDiaryMessage) => void): void => {
    if (!message) return
    onClose()
    action(message)
  }
  const hasText = Boolean(message?.text.trim())
  return <BottomSheet visible={message !== null} title={message ? dateTimeLabel(message.sentAt) : ''} onClose={onClose} dismissOnBackdrop>
    {message && <>
      {(message.source === 'telegram' || message.editedAt) && <Text className="mb-3 text-[14px] leading-5 text-muted-foreground">
        {[message.source === 'telegram' ? 'Imported from Telegram' : null, message.editedAt ? `Edited ${dateTimeLabel(message.editedAt)}` : null].filter(Boolean).join('. ')}
      </Text>}
      <MenuRow Icon={Reply} label="Reply" onPress={() => run(actions.reply)} />
      {hasText && <MenuRow Icon={Copy} label="Copy text" onPress={() => run(actions.copy)} />}
      <MenuRow Icon={Pencil} label={hasText ? 'Edit' : 'Add a caption'} onPress={() => run(actions.edit)} />
      <MenuRow Icon={message.pinnedAt ? PinOff : Pin} label={message.pinnedAt ? 'Unpin' : 'Pin'} onPress={() => run((target) => actions.pin(target, !target.pinnedAt))} />
      {message.delivery === 'failed' && <MenuRow Icon={RotateCw} label="Try sending again" onPress={() => run(actions.retry)} />}
      <MenuRow Icon={Trash2} label="Delete" destructive onPress={() => run(actions.remove)} />
    </>}
  </BottomSheet>
}

/** The newest pin first. A tap jumps to it, and the next tap moves to the pin before. */
export function PinnedBar({ pinned, index, onPress }: { pinned: readonly LocalDiaryMessage[]; index: number; onPress: () => void }): React.ReactElement | null {
  const message = pinned[index % Math.max(pinned.length, 1)]
  if (!message) return null
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Go to the pinned message"
    onPress={onPress}
    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: ink.line, backgroundColor: ink.screen }}
  >
    <View style={{ gap: 2, marginRight: 10 }}>
      {pinned.length > 1
        ? pinned.slice(0, 4).map((item, position) => <View key={item.id} style={{ width: 2, height: Math.max(6, 32 / Math.min(pinned.length, 4) - 2), borderRadius: 1, backgroundColor: position === index % 4 ? ink.text : ink.faint }} />)
        : <View style={{ width: 2, height: 32, borderRadius: 1, backgroundColor: ink.text }} />}
    </View>
    <View style={{ flex: 1 }}>
      <Text className="text-[13px] font-semibold">{pinned.length > 1 ? `Pinned message ${index + 1} of ${pinned.length}` : 'Pinned message'}</Text>
      <Text numberOfLines={1} className="text-[14px] text-surface-300">{diaryPreviewText(message)}</Text>
    </View>
    <Pin color={ink.meta} size={16} />
  </Pressable>
}

function ResultRow({ message, onPress }: { message: LocalDiaryMessage; onPress: () => void }): React.ReactElement {
  const { api, localFiles } = useChat()
  const visual = message.attachments.find((item) => VISUAL_KINDS.has(item.kind))
  const thumbId = visual?.previewId ?? (visual?.kind === 'photo' ? visual.mediaId : null)
  return <Pressable onPress={onPress} className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-900">
    {thumbId
      ? <Image source={mediaSource(api, localFiles, thumbId)} style={{ width: 44, height: 44, borderRadius: 8 }} contentFit="cover" />
      : <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: ink.tile }} className="items-center justify-center"><Search color={ink.faint} size={18} /></View>}
    <View style={{ flex: 1 }}>
      <Text className="text-[13px] text-muted-foreground">{dateTimeLabel(message.sentAt)}</Text>
      <Text numberOfLines={2} className="text-[15px] leading-5">{diaryPreviewText(message)}</Text>
    </View>
  </Pressable>
}

/**
 * Search runs over the phone's own copy, so it works offline and answers as you type. With no
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
  if (!query.trim()) {
    return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text className="mb-3 text-[14px] font-semibold text-muted-foreground">Hashtags</Text>
      {tags.length === 0 && <Text className="text-[15px] text-muted-foreground">Type to search every message, file name, and song.</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tags.map(({ tag, count }) => <Pressable key={tag} onPress={() => onTag(tag)} className="flex-row items-center gap-1.5 rounded-full bg-surface-900 px-3 py-2 active:bg-surface-800">
          <Hash color={ink.meta} size={13} />
          <Text className="text-[15px]">{tag.slice(1)}</Text>
          <Text className="text-[13px] text-muted-foreground">{count}</Text>
        </Pressable>)}
      </View>
    </ScrollView>
  }
  return <FlatList
    data={results}
    keyExtractor={(message) => message.id}
    keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<Text className="px-4 py-2 text-[13px] text-muted-foreground">{results.length === 1 ? '1 message' : `${results.length} messages`}</Text>}
    renderItem={({ item }) => <ResultRow message={item} onPress={() => onPick(item)} />}
  />
}
