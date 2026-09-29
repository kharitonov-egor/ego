import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import {
  RecordingPresets, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState
} from 'expo-audio'
import {
  ArrowUp, Camera, Check, ChevronLeft, FileText, Film, Images, Mic, Music, Paperclip, Pencil, Reply, X, type LucideIcon
} from 'lucide-react-native'
import { DIARY_ATTACHMENT_LIMIT, diaryPreviewText } from '@ego/core'
import { draftsFromFiles, draftsFromLibrary, voiceDraft, type DraftFile } from '../../lib/diary/compose'
import { durationLabel, levelFromDecibels, sizeLabel, waveformBars } from '../../lib/diary/format'
import type { LocalDiaryMessage } from '../../lib/diary/repository'
import type { DiaryDraft } from '../../lib/diary/use-diary'
import { outsideApp } from '../../lib/private-lock'
import { BottomSheet } from '../money/Common'
import { useLocked } from '../PrivateGate'
import { Text } from '../ui/text'
import { ink } from './theme'

const VOICE_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true }
const CANCEL_DISTANCE = 110
const SHORTEST_VOICE_SECONDS = 0.7

function RoundButton({ label, onPress, Icon, filled = false, disabled = false }: {
  label: string
  onPress: () => void
  Icon: LucideIcon
  filled?: boolean
  disabled?: boolean
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    disabled={disabled}
    hitSlop={4}
    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: filled ? ink.text : 'transparent', opacity: disabled ? 0.4 : 1 }}
    className="items-center justify-center active:opacity-70"
  >
    <Icon color={filled ? ink.screen : ink.secondary} size={filled ? 20 : 23} strokeWidth={filled ? 2.5 : 2} />
  </Pressable>
}

function ContextBar({ Icon, title, detail, onClose }: { Icon: LucideIcon; title: string; detail: string; onClose: () => void }): React.ReactElement {
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, paddingTop: 8 }}>
    <Icon color={ink.text} size={18} />
    <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: ink.text, marginLeft: 10, paddingLeft: 8 }}>
      <Text className="text-[13px] font-semibold">{title}</Text>
      <Text numberOfLines={1} className="text-[13px] text-surface-300">{detail}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${title.toLowerCase()}`} onPress={onClose} hitSlop={8} className="h-10 w-10 items-center justify-center">
      <X color={ink.meta} size={18} />
    </Pressable>
  </View>
}

function DraftThumb({ draft, onRemove }: { draft: DraftFile; onRemove: () => void }): React.ReactElement {
  const Icon = draft.kind === 'video' ? Film : draft.kind === 'audio' || draft.kind === 'voice' ? Music : FileText
  return <View style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: ink.tile }}>
    {draft.kind === 'photo'
      ? <Image source={{ uri: draft.uri }} style={{ width: 72, height: 72 }} contentFit="cover" />
      : <View className="flex-1 items-center justify-center px-1">
        <Icon color={ink.secondary} size={22} />
        <Text numberOfLines={1} className="mt-1 text-[11px] text-surface-300">
          {draft.kind === 'video' ? durationLabel(draft.durationSeconds) : draft.fileName ?? sizeLabel(draft.size)}
        </Text>
      </View>}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Remove this attachment"
      onPress={onRemove}
      hitSlop={6}
      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: ink.scrim }}
      className="items-center justify-center"
    ><X color={ink.text} size={13} /></Pressable>
  </View>
}

function AttachOption({ Icon, label, detail, onPress }: { Icon: LucideIcon; label: string; detail: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="mb-2 min-h-16 flex-row items-center gap-4 rounded-2xl bg-surface-900 px-4 active:bg-surface-800">
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: ink.text }} className="items-center justify-center">
      <Icon color={ink.screen} size={20} />
    </View>
    <View className="flex-1 py-3">
      <Text className="text-[16px] font-semibold">{label}</Text>
      <Text className="text-[14px] text-muted-foreground">{detail}</Text>
    </View>
  </Pressable>
}

/**
 * Hold to record, slide left to cancel, let go to send. The recording starts only once the
 * microphone is allowed, so the first hold may just ask for permission.
 */
function useVoiceNote(onRecorded: (draft: DraftFile) => void, onNotice: (text: string) => void) {
  const recorder = useAudioRecorder(VOICE_OPTIONS)
  const state = useAudioRecorderState(recorder, 100)
  const [recording, setRecording] = useState(false)
  const [slide, setSlide] = useState(0)
  const levels = useRef<number[]>([])
  const pressing = useRef(false)
  const starting = useRef<Promise<boolean> | null>(null)
  const active = useRef(false)

  useEffect(() => {
    if (recording && state.isRecording) levels.current.push(levelFromDecibels(state.metering))
  }, [recording, state.durationMillis, state.isRecording, state.metering])

  const start = async (): Promise<boolean> => {
    try {
      const allowed = (await getRecordingPermissionsAsync()).granted ||
        (await outsideApp(() => requestRecordingPermissionsAsync())).granted
      if (!allowed) {
        onNotice('Allow the microphone for Ego in system settings to record voice messages.')
        return false
      }
      if (!pressing.current) return false
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      levels.current = []
      active.current = true
      setRecording(true)
      return true
    } catch {
      onNotice('This phone could not start recording.')
      return false
    }
  }

  const finish = async (keep: boolean): Promise<void> => {
    if (starting.current) await starting.current
    if (!active.current) return
    active.current = false
    setRecording(false)
    setSlide(0)
    const seconds = recorder.getStatus().durationMillis / 1000
    try {
      await recorder.stop()
    } catch {
      onNotice('The recording did not save.')
      return
    } finally {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
    }
    const uri = recorder.uri
    if (!uri) return
    if (!keep || seconds < SHORTEST_VOICE_SECONDS) {
      try {
        new File(uri).delete()
      } catch {
        // A recording that never reached disk needs no cleanup.
      }
      if (keep) onNotice('Hold the microphone to record, and let go to send.')
      return
    }
    onRecorded(voiceDraft(uri, Math.max(1, Math.round(seconds)), waveformBars(levels.current, 48)))
  }

  const latest = useRef({ start, finish })
  latest.current = { start, finish }
  const cancelled = useRef(false)
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      pressing.current = true
      cancelled.current = false
      const begun = latest.current.start()
      starting.current = begun
      void begun.finally(() => { if (starting.current === begun) starting.current = null })
    },
    onPanResponderMove: (_, gesture) => {
      if (cancelled.current) return
      setSlide(Math.min(0, gesture.dx))
      if (gesture.dx < -CANCEL_DISTANCE) {
        cancelled.current = true
        void latest.current.finish(false)
      }
    },
    onPanResponderRelease: () => {
      pressing.current = false
      if (!cancelled.current) void latest.current.finish(true)
    },
    onPanResponderTerminate: () => {
      pressing.current = false
      void latest.current.finish(false)
    }
  }), [])

  const level = levels.current[levels.current.length - 1] ?? 0
  return { recording, slide, seconds: state.durationMillis / 1000, level, handlers: responder.panHandlers }
}

export function Composer({ replyTo, editing, bottomInset, onCancelReply, onCancelEdit, onSend, onEdit }: {
  replyTo: LocalDiaryMessage | null
  editing: LocalDiaryMessage | null
  bottomInset: number
  onCancelReply: () => void
  onCancelEdit: () => void
  onSend: (draft: DiaryDraft) => Promise<boolean>
  onEdit: (message: LocalDiaryMessage, text: string) => Promise<boolean>
}): React.ReactElement {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<DraftFile[]>([])
  const [attaching, setAttaching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const editingId = editing?.id ?? null
  const savedDraft = useRef('')
  const locked = useLocked()

  useEffect(() => {
    if (locked) setAttaching(false)
  }, [locked])

  const typed = useRef(text)
  typed.current = text
  const editingNow = useRef(editing)
  editingNow.current = editing
  useEffect(() => {
    const target = editingNow.current
    if (!target) return
    savedDraft.current = typed.current
    setText(target.text)
  }, [editingId])

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

  const addFiles = (next: DraftFile[]): void => {
    setFiles((current) => {
      const room = DIARY_ATTACHMENT_LIMIT - current.length
      if (next.length > room) setNotice(`One message holds up to ${DIARY_ATTACHMENT_LIMIT} files.`)
      return [...current, ...next.slice(0, Math.max(0, room))]
    })
  }

  const pickLibrary = async (): Promise<void> => {
    setAttaching(false)
    const result = await outsideApp(() => ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: DIARY_ATTACHMENT_LIMIT, quality: 1, exif: false
    }))
    if (!result.canceled) addFiles(draftsFromLibrary(result.assets))
  }

  const takePhoto = async (): Promise<void> => {
    setAttaching(false)
    const permission = await outsideApp(() => ImagePicker.requestCameraPermissionsAsync())
    if (!permission.granted) {
      setNotice('Allow the camera for Ego in system settings to take photos here.')
      return
    }
    const result = await outsideApp(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1, exif: false }))
    if (!result.canceled) addFiles(draftsFromLibrary(result.assets))
  }

  const pickFiles = async (): Promise<void> => {
    setAttaching(false)
    try {
      const result = await outsideApp(() => File.pickFileAsync({ multipleFiles: true }))
      if (!result.canceled) addFiles(draftsFromFiles(result.result))
    } catch {
      setNotice('The file picker did not open.')
    }
  }

  const submit = async (): Promise<void> => {
    if (editing) {
      const saved = await onEdit(editing, text)
      if (saved) {
        onCancelEdit()
        setText(savedDraft.current)
      }
      return
    }
    if (!text.trim() && files.length === 0) return
    const draft: DiaryDraft = { text, files, replyToId: replyTo?.id ?? null }
    setText('')
    setFiles([])
    onCancelReply()
    const saved = await onSend(draft)
    if (!saved) {
      setText(draft.text)
      setFiles(draft.files)
    }
  }

  const cancelEdit = (): void => {
    onCancelEdit()
    setText(savedDraft.current)
  }

  const canSend = editing !== null || text.trim().length > 0 || files.length > 0

  return <View style={{ backgroundColor: ink.screen, borderTopWidth: 1, borderTopColor: ink.line, paddingBottom: bottomInset }}>
    {notice && <Pressable onPress={() => setNotice(null)} style={{ paddingHorizontal: 14, paddingTop: 8 }}>
      <Text className="text-[13px] text-surface-300">{notice}</Text>
    </Pressable>}
    {editing
      ? <ContextBar Icon={Pencil} title="Edit message" detail={diaryPreviewText(editing)} onClose={cancelEdit} />
      : replyTo && <ContextBar Icon={Reply} title="Reply" detail={diaryPreviewText(replyTo)} onClose={onCancelReply} />}
    {files.length > 0 && !editing && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
      {files.map((draft) => <DraftThumb key={draft.key} draft={draft} onRemove={() => setFiles((current) => current.filter((item) => item.key !== draft.key))} />)}
    </ScrollView>}
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6, paddingVertical: 6, gap: 4, minHeight: 56 }}>
      {voice.recording
        ? <View key="recording" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'center', paddingLeft: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ink.failed, opacity: 0.5 + voice.level / 200 }} />
          <Text className="ml-2.5 text-[16px] font-medium" style={{ fontVariant: ['tabular-nums'] }}>{durationLabel(voice.seconds)}</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', transform: [{ translateX: voice.slide / 2 }] }}>
            <ChevronLeft color={ink.meta} size={16} />
            <Text className="text-[15px] text-muted-foreground">Slide to cancel</Text>
          </View>
        </View>
        : <View key="typing" style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
          {!editing && <RoundButton label="Attach photos, videos, or files" onPress={() => setAttaching(true)} Icon={Paperclip} />}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={ink.faint}
            multiline
            style={{
              flex: 1, color: ink.text, fontSize: 16, lineHeight: 21, maxHeight: 150, minHeight: 44,
              backgroundColor: ink.bubble, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
              textAlignVertical: 'center'
            }}
          />
        </View>}
      {canSend && !voice.recording
        ? <RoundButton key="send" label={editing ? 'Save the edit' : 'Send'} onPress={() => void submit()} Icon={editing ? Check : ArrowUp} filled />
        : <View
          key="microphone"
          {...voice.handlers}
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice message"
          style={{
            width: 44, height: 44, borderRadius: 22, backgroundColor: voice.recording ? ink.text : 'transparent',
            transform: [{ translateX: voice.slide }, { scale: voice.recording ? 1.3 : 1 }]
          }}
          className="items-center justify-center"
        >
          <Mic color={voice.recording ? ink.screen : ink.secondary} size={23} />
        </View>}
    </View>
    <BottomSheet visible={attaching} title="Attach" onClose={() => setAttaching(false)} dismissOnBackdrop>
      <AttachOption Icon={Images} label="Photo or video" detail="Choose from the gallery, up to 20 at once" onPress={() => void pickLibrary()} />
      <AttachOption Icon={Camera} label="Camera" detail="Take a photo or record a video" onPress={() => void takePhoto()} />
      <AttachOption Icon={FileText} label="File" detail="PDFs, music, documents, anything" onPress={() => void pickFiles()} />
    </BottomSheet>
  </View>
}
