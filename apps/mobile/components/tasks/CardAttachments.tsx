import React, { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { FileText, Play, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react-native'
import type { TaskCardRecord } from '@ego/api-contracts'
import type { TaskAttachment } from '@ego/core'
import { useBlur } from '../../lib/blur'
import { extensionLabel, sizeLabel } from '../../lib/diary/format'
import { fileForOpening, mediaSource, openWithAnotherApp } from '../../lib/diary/media'
import { useLedger } from '../../lib/ledger-context'
import { useTasks } from '../../lib/tasks/context'
import { PlayingVideo, ZoomableImage } from '../diary/MediaViewer'
import { ConfirmDialog } from '../money/Common'
import { color } from '../money/tokens'

const TILE_GAP = 6

function Viewer({ items, start, onClose }: { items: readonly TaskAttachment[]; start: number | null; onClose: () => void }): React.ReactElement {
  const { api } = useLedger()
  const { localFiles } = useTasks()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(start ?? 0)
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    if (start === null) return
    setIndex(start)
    setZoomed(false)
  }, [start])
  return <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {start !== null && <FlatList
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={start}
        getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
        keyExtractor={(item) => item.id}
        windowSize={3}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: position }) => {
          const full = mediaSource(api, localFiles, item.mediaId, 'tasks')
          const preview = item.previewId ? mediaSource(api, localFiles, item.previewId, 'tasks') : null
          if (item.kind === 'photo') return <ZoomableImage full={full} preview={preview} width={width} height={height} onZoom={setZoomed} onTap={() => undefined} />
          return position === index
            ? <PlayingVideo source={full} loop={false} width={width} height={height} />
            : <View style={{ width, height }}>{preview && <Image source={preview} style={{ width, height }} contentFit="contain" />}</View>
        }}
      />}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} className="h-11 w-11 items-center justify-center">
          <X color="#fafafa" size={24} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Text numberOfLines={1} className="text-[15px] font-semibold text-white">{items[index]?.fileName ?? (items[index]?.kind === 'video' ? 'Video' : 'Photo')}</Text>
          <Text className="text-[13px] text-surface-300">{index + 1} of {items.length}</Text>
        </View>
      </View>
    </View>
  </Modal>
}

function FileRow({ attachment, onRemove }: { attachment: TaskAttachment; onRemove: () => void }): React.ReactElement {
  const { api } = useLedger()
  const { localFiles } = useTasks()
  const [progress, setProgress] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const open = async (): Promise<void> => {
    if (progress !== null) return
    setProblem(null)
    setProgress(0)
    try {
      const file = await fileForOpening(api, localFiles, attachment, setProgress, 'tasks')
      setProgress(null)
      await openWithAnotherApp(file, attachment.mimeType)
    } catch {
      setProgress(null)
      setProblem('No app on this phone opened it')
    }
  }
  const detail = problem ?? [sizeLabel(attachment.size), extensionLabel(attachment.fileName, attachment.mimeType)].filter(Boolean).join(' · ')
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Open ${attachment.fileName ?? 'file'}`}
    onPress={() => void open()}
    onLongPress={onRemove}
    delayLongPress={350}
    className="min-h-16 flex-row items-center rounded-xl bg-surface-900 px-3 py-2 active:bg-surface-800"
  >
    <View className="h-11 w-11 items-center justify-center rounded-lg bg-surface-800">
      {progress !== null ? <ActivityIndicator color="#fafafa" size="small" /> : <FileText color={color.textSecondary} size={21} />}
    </View>
    <View className="ml-3 flex-1">
      <Text numberOfLines={2} className="text-[15px] font-semibold text-surface-100">{attachment.fileName ?? 'File'}</Text>
      <Text className={`text-[13px] ${problem ? 'text-rose-300' : 'text-muted-foreground'}`}>
        {progress !== null && progress > 0 ? `Downloading ${Math.round(progress * 100)}%` : detail}
      </Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.fileName ?? 'file'}`} onPress={onRemove} hitSlop={8} className="h-10 w-10 items-center justify-center">
      <Trash2 color={color.textFaint} size={17} />
    </Pressable>
  </Pressable>
}

/** Photos and videos as a grid, other files as rows that open in the app that handles them. */
export function CardAttachments({ card }: { card: TaskCardRecord }): React.ReactElement | null {
  const { api } = useLedger()
  const tasks = useTasks()
  const { blurred } = useBlur()
  const { width } = useWindowDimensions()
  const [viewing, setViewing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<TaskAttachment | null>(null)
  const media = card.attachments.filter((item) => item.kind !== 'file')
  const files = card.attachments.filter((item) => item.kind === 'file')
  const upload = tasks.data?.uploads.get(card.id)
  if (card.attachments.length === 0) return null
  const tile = Math.floor((width - 40 - TILE_GAP * 2) / 3)
  return <View>
    {upload && <View className="mb-3 flex-row items-center rounded-xl bg-surface-900 px-3 py-2.5">
      {upload === 'sending'
        ? <><ActivityIndicator color="#a3a3a3" size="small" /><Text className="ml-3 flex-1 text-[14px] text-surface-300">Uploading. The card saves on other devices once the files are up.</Text></>
        : <>
          <TriangleAlert color={color.attention} size={18} />
          <Text className="ml-3 flex-1 text-[14px] text-surface-300">A file did not upload.</Text>
          <Pressable accessibilityRole="button" onPress={() => void tasks.retryUploads(card.id)} hitSlop={8} className="flex-row items-center">
            <RotateCcw color="#fafafa" size={15} />
            <Text className="ml-1 text-[14px] font-semibold text-white">Retry</Text>
          </Pressable>
        </>}
    </View>}
    {media.length > 0 && <View className="flex-row flex-wrap" style={{ gap: TILE_GAP }}>
      {media.map((item, index) => <Pressable
        key={item.id}
        accessibilityRole="imagebutton"
        accessibilityLabel={item.kind === 'video' ? 'Play video' : 'View photo'}
        onPress={() => setViewing(index)}
        onLongPress={() => setRemoving(item)}
        delayLongPress={350}
        style={{ width: tile, height: tile }}
        className="overflow-hidden rounded-xl bg-surface-900"
      >
        {!blurred && (item.previewId || item.kind === 'photo') && <Image
          source={mediaSource(api, tasks.localFiles, item.previewId ?? item.mediaId, 'tasks')}
          style={{ width: tile, height: tile }}
          contentFit="cover"
          transition={120}
        />}
        {item.kind === 'video' && <View className="absolute inset-0 items-center justify-center">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-black/60"><Play color="#fafafa" fill="#fafafa" size={16} /></View>
        </View>}
      </Pressable>)}
    </View>}
    {files.length > 0 && <View className={`gap-2 ${media.length > 0 ? 'mt-3' : ''}`}>
      {files.map((item) => <FileRow key={item.id} attachment={item} onRemove={() => setRemoving(item)} />)}
    </View>}
    {media.length > 0 && <Text className="mt-2 text-[13px] text-surface-500">Hold a photo to remove it.</Text>}
    <Viewer items={media} start={viewing} onClose={() => setViewing(null)} />
    <ConfirmDialog
      visible={removing !== null}
      title="Remove this attachment?"
      detail="It comes off the card on every device."
      confirmLabel="Remove"
      destructive
      hideNavigation={false}
      onCancel={() => setRemoving(null)}
      onConfirm={() => {
        if (removing) void tasks.removeFile(card.id, removing.id)
        setRemoving(null)
      }}
    />
  </View>
}
