import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { KeyboardScrollView } from '../../../components/ui/keyboard'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import {
  Activity, AlignLeft, Archive, ArchiveRestore, ArrowRightLeft, Camera, Check, Clock, Copy, Ellipsis, FileText, Flag,
  Images, Paperclip, Plus, SquareCheckBig, Tag, Trash2, type LucideIcon
} from 'lucide-react-native'
import { TASK_PRIORITY_LABELS, taskReminderLabel } from '@ego/core'
import { ActivityRow } from '../../../components/tasks/ActivityList'
import { CardAttachments } from '../../../components/tasks/CardAttachments'
import { Checklists } from '../../../components/tasks/Checklists'
import { MarkdownEditor, MarkdownView } from '../../../components/tasks/Markdown'
import { DueSheet, LabelSheet, MoveSheet, PrioritySheet, TextSheet } from '../../../components/tasks/sheets'
import {
  DueChip, LabelChip, PriorityIcon, SectionTitle, TasksError, TasksGate, TasksHeaderRight, TasksMessage
} from '../../../components/tasks/ui'
import { HeaderIcon, MenuSheet } from '../../../components/gym/ui'
import { ConfirmDialog } from '../../../components/money/Common'
import { color } from '../../../components/money/tokens'
import { Button } from '../../../components/ui/button'
import { Text as UiText } from '../../../components/ui/text'
import { Blurred, useBlur } from '../../../lib/blur'
import { draftsFromFiles, draftsFromLibrary } from '../../../lib/diary/compose'
import { mediaSource } from '../../../lib/diary/media'
import { useLedger } from '../../../lib/ledger-context'
import { outsideApp } from '../../../lib/private-lock'
import { newId } from '@ego/local/sync/commands'
import { boardLabels, coverOf, dueBadge } from '@ego/local/tasks/board'
import { useTasks } from '../../../lib/tasks/context'
import { toggleTaskLine } from '@ego/local/tasks/markdown'

const ACTIVITY_PAGE = 5

function Action({ Icon, label, onPress }: { Icon: LucideIcon; label: string; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="min-h-11 flex-row items-center rounded-xl bg-surface-900 px-3.5 active:bg-surface-800"
  >
    <Icon color={color.textSecondary} size={17} />
    <Text className="ml-2 text-[15px] font-semibold text-surface-200">{label}</Text>
  </Pressable>
}

function CardDetail({ cardId }: { cardId: string }): React.ReactElement {
  const tasks = useTasks()
  const { api } = useLedger()
  const { blurred } = useBlur()
  const router = useRouter()
  const navigation = useNavigation()
  const card = tasks.data?.cards.find((item) => item.id === cardId)
  const board = tasks.data?.boards.find((item) => item.id === card?.boardId)
  const list = tasks.data?.lists.find((item) => item.id === card?.listId)
  const [title, setTitle] = useState(card?.title ?? '')
  const [describing, setDescribing] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'labels' | 'due' | 'priority' | 'move' | 'copy' | 'checklist' | 'attach' | 'menu' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [allActivity, setAllActivity] = useState(false)

  const savedTitle = card?.title
  useEffect(() => { if (savedTitle !== undefined) setTitle(savedTitle) }, [savedTitle])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: list ? list.name : '',
      headerRight: () => <TasksHeaderRight>
        <HeaderIcon label="Card menu" onPress={() => setSheet('menu')}><Ellipsis color="#fafafa" size={22} /></HeaderIcon>
      </TasksHeaderRight>
    })
  }, [list, navigation])

  const labels = useMemo(() => tasks.data && card ? boardLabels(tasks.data, card.boardId) : [], [card, tasks.data])
  if (!tasks.data || !card) {
    return <TasksMessage title="This card is gone" detail="It was deleted, maybe on another device." action="Back" onAction={() => router.back()} />
  }

  const update = tasks.updateCard.bind(null, card.id)
  const done = card.doneAt !== null
  const due = dueBadge(card, tasks.now)
  const cover = coverOf(card)
  const shownLabels = card.labelIds.flatMap((id) => labels.filter((label) => label.id === id))
  const activity = [...card.activity].reverse()

  const saveTitle = (): void => {
    const next = title.trim()
    if (!next) {
      setTitle(card.title)
      return
    }
    if (next !== card.title) void update((input) => ({ ...input, title: next }))
  }

  const attach = async (source: 'library' | 'camera' | 'file'): Promise<void> => {
    setSheet(null)
    if (source === 'file') {
      try {
        const result = await outsideApp(() => File.pickFileAsync({ multipleFiles: true }))
        if (!result.canceled) await tasks.addFiles(card.id, draftsFromFiles(result.result))
      } catch {
        return
      }
      return
    }
    if (source === 'camera') {
      const permission = await outsideApp(() => ImagePicker.requestCameraPermissionsAsync())
      if (!permission.granted) return
      const result = await outsideApp(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1, exif: false }))
      if (!result.canceled) await tasks.addFiles(card.id, draftsFromLibrary(result.assets))
      return
    }
    const result = await outsideApp(() => ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, exif: false
    }))
    if (!result.canceled) await tasks.addFiles(card.id, draftsFromLibrary(result.assets))
  }

  return <View className="flex-1 bg-surface-950">
    <KeyboardScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
      {cover && !blurred && <Image
        source={mediaSource(api, tasks.localFiles, cover.mediaId, 'tasks')}
        style={{ width: '100%', height: 190, backgroundColor: '#141414' }}
        contentFit="cover"
        transition={120}
      />}
      <View className="px-5 pt-3">
        <TasksError />
        {card.archivedAt !== null && <View className="mb-3 flex-row items-center rounded-2xl bg-surface-900 px-4 py-3">
          <Archive color={color.textMuted} size={18} />
          <Text className="ml-3 flex-1 text-[15px] text-surface-300">This card is archived.</Text>
          <Pressable accessibilityRole="button" onPress={() => void update((input) => ({ ...input, archivedAt: null }))} hitSlop={8}>
            <Text className="text-[15px] font-semibold text-white">Send to board</Text>
          </Pressable>
        </View>}
        {blurred
          ? <Blurred tint="#fafafa"><Text className="text-[24px] font-bold leading-8 text-white">{card.title}</Text></Blurred>
          : <TextInput
            value={title}
            onChangeText={setTitle}
            onEndEditing={saveTitle}
            multiline
            blurOnSubmit
            returnKeyType="done"
            accessibilityLabel="Card title"
            maxLength={500}
            className="text-[24px] font-bold leading-8 text-white"
            style={{ padding: 0 }}
          />}
        <Pressable accessibilityRole="button" accessibilityHint="Moves the card" onPress={() => setSheet('move')} className="mt-1 self-start py-1">
          <Text className="text-[15px] text-surface-400">
            in list <Text className="font-semibold text-surface-200 underline">{list?.name ?? 'a list'}</Text>{board ? ` on ${board.icon ? `${board.icon} ` : ''}${board.name}` : ''}
          </Text>
        </Pressable>

        <Button
          size="lg"
          variant={done ? 'default' : 'outline'}
          className="mt-4"
          accessibilityState={{ checked: done }}
          onPress={() => void update((input) => ({ ...input, doneAt: input.doneAt ? null : new Date().toISOString() }))}
        >
          {done ? <Check color="#0a0a0a" size={20} strokeWidth={3} /> : <Check color="#fafafa" size={20} />}
          <UiText>{done ? 'Done' : 'Mark done'}</UiText>
        </Button>

        <View className="mt-4 flex-row flex-wrap gap-2">
          <Action Icon={Tag} label="Labels" onPress={() => setSheet('labels')} />
          <Action Icon={Clock} label="Dates" onPress={() => setSheet('due')} />
          <Action Icon={Flag} label="Priority" onPress={() => setSheet('priority')} />
          <Action Icon={SquareCheckBig} label="Checklist" onPress={() => setSheet('checklist')} />
          <Action Icon={Paperclip} label="Attachment" onPress={() => setSheet('attach')} />
        </View>

        {(shownLabels.length > 0 || card.priority !== 'none' || due) && <View className="mt-5 gap-4">
          {shownLabels.length > 0 && <View>
            <Text className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Labels</Text>
            <View className="flex-row flex-wrap items-center gap-2">
              {shownLabels.map((label) => <Pressable key={label.id} accessibilityRole="button" onPress={() => setSheet('labels')}><LabelChip label={label} size="large" /></Pressable>)}
              <Pressable accessibilityRole="button" accessibilityLabel="Edit labels" onPress={() => setSheet('labels')} className="h-9 w-9 items-center justify-center rounded-full bg-surface-900">
                <Plus color={color.textMuted} size={18} />
              </Pressable>
            </View>
          </View>}
          {card.priority !== 'none' && <Pressable accessibilityRole="button" onPress={() => setSheet('priority')} className="self-start">
            <Text className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Priority</Text>
            <View className="flex-row items-center rounded-md bg-surface-900 px-2.5 py-1.5">
              <PriorityIcon priority={card.priority} size={16} />
              <Text className="ml-2 text-[15px] font-semibold text-surface-200">{TASK_PRIORITY_LABELS[card.priority]}</Text>
            </View>
          </Pressable>}
          {due && <Pressable accessibilityRole="button" onPress={() => setSheet('due')} className="self-start">
            <Text className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Due</Text>
            <View className="flex-row items-center gap-2">
              <DueChip due={due} large />
              {card.reminderMinutes !== null && !done && <Text className="text-[14px] text-surface-500">Reminder: {taskReminderLabel(card.reminderMinutes, card.dueTime !== null).toLowerCase()}</Text>}
            </View>
          </Pressable>}
        </View>}

        <SectionTitle Icon={AlignLeft} title="Description" right={describing === null && card.description.trim() !== '' && !blurred
          ? <Pressable accessibilityRole="button" onPress={() => setDescribing(card.description)} hitSlop={8}><Text className="text-[15px] font-semibold text-white">Edit</Text></Pressable>
          : undefined} />
        {describing !== null
          ? <View>
            <MarkdownEditor value={describing} onChange={setDescribing} />
            <View className="mt-3 flex-row gap-3">
              <Button variant="outline" className="flex-1" onPress={() => setDescribing(null)}><UiText>Cancel</UiText></Button>
              <Button className="flex-1" onPress={() => {
                const next = describing
                setDescribing(null)
                if (next !== card.description) void update((input) => ({ ...input, description: next }))
              }}><UiText>Save</UiText></Button>
            </View>
            <Text className="mt-2 text-[13px] leading-5 text-surface-500">Markdown: **bold**, _italic_, ~~strike~~, `code`, # heading, - list, - [ ] checkbox, [link](https://...)</Text>
          </View>
          : card.description.trim() === ''
            ? <Pressable accessibilityRole="button" onPress={() => setDescribing('')} className="min-h-16 justify-center rounded-xl bg-surface-900 px-4 active:bg-surface-800">
              <Text className="text-[15px] text-surface-500">Add a more detailed description...</Text>
            </Pressable>
            : <Pressable accessibilityHint="Edits the description" onLongPress={() => { if (!blurred) setDescribing(card.description) }}>
              <MarkdownView source={card.description} onToggleTask={(line) => void update((input) => ({ ...input, description: toggleTaskLine(input.description, line) }))} />
            </Pressable>}

        <Checklists card={card} />

        {card.attachments.length > 0 && <>
          <SectionTitle Icon={Paperclip} title="Attachments" right={<Pressable accessibilityRole="button" onPress={() => setSheet('attach')} hitSlop={8}>
            <Text className="text-[15px] font-semibold text-white">Add</Text>
          </Pressable>} />
          <CardAttachments card={card} />
        </>}

        <SectionTitle Icon={Activity} title="Activity" />
        {activity.slice(0, allActivity ? activity.length : ACTIVITY_PAGE).map((entry, index) => <ActivityRow key={`${entry.at}-${index}`} entry={entry} now={tasks.now} />)}
        {activity.length === 0 && <Text className="text-[15px] text-surface-500">Nothing yet.</Text>}
        {activity.length > ACTIVITY_PAGE && <Pressable accessibilityRole="button" onPress={() => setAllActivity(!allActivity)} className="mt-1 min-h-11 justify-center">
          <Text className="text-[15px] font-semibold text-white">{allActivity ? 'Show less' : `Show all ${activity.length}`}</Text>
        </Pressable>}
      </View>
    </KeyboardScrollView>

    <LabelSheet
      visible={sheet === 'labels'}
      boardId={card.boardId}
      selected={card.labelIds}
      onToggle={(labelId) => void update((input) => ({
        ...input,
        labelIds: input.labelIds.includes(labelId) ? input.labelIds.filter((id) => id !== labelId) : [...input.labelIds, labelId]
      }))}
      onClose={() => setSheet(null)}
    />
    <DueSheet
      visible={sheet === 'due'}
      card={card}
      onSave={(value) => void update((input) => ({ ...input, ...value }))}
      onClose={() => setSheet(null)}
    />
    <PrioritySheet
      visible={sheet === 'priority'}
      value={card.priority}
      onChange={(priority) => void update((input) => ({ ...input, priority }))}
      onClose={() => setSheet(null)}
    />
    <MoveSheet visible={sheet === 'move'} mode="move" card={card} onDone={() => undefined} onClose={() => setSheet(null)} />
    <MoveSheet
      visible={sheet === 'copy'}
      mode="copy"
      card={card}
      onDone={(id) => router.replace({ pathname: '/tasks/card/[id]', params: { id } })}
      onClose={() => setSheet(null)}
    />
    <TextSheet
      visible={sheet === 'checklist'}
      title="Add checklist"
      value="Checklist"
      placeholder="Checklist title"
      confirm="Add"
      onClose={() => setSheet(null)}
      onSave={(text) => {
        setSheet(null)
        void update((input) => ({ ...input, checklists: [...input.checklists, { id: newId(), title: text.trim(), items: [] }] }))
      }}
    />
    <MenuSheet visible={sheet === 'attach'} title="Attach" onClose={() => setSheet(null)} items={[
      { label: 'Photo or video', Icon: Images, onPress: () => void attach('library') },
      { label: 'Camera', Icon: Camera, onPress: () => void attach('camera') },
      { label: 'File', Icon: FileText, onPress: () => void attach('file') }
    ]} />
    <MenuSheet visible={sheet === 'menu'} title={card.title} onClose={() => setSheet(null)} items={[
      { label: 'Move', Icon: ArrowRightLeft, onPress: () => setSheet('move') },
      { label: 'Copy', Icon: Copy, onPress: () => setSheet('copy') },
      card.archivedAt === null
        ? { label: 'Archive', Icon: Archive, onPress: () => void update((input) => ({ ...input, archivedAt: new Date().toISOString() })) }
        : { label: 'Send to board', Icon: ArchiveRestore, onPress: () => void update((input) => ({ ...input, archivedAt: null })) },
      { label: 'Delete', Icon: Trash2, destructive: true, onPress: () => setDeleting(true) }
    ]} />
    <ConfirmDialog
      visible={deleting}
      title="Delete this card?"
      detail="It is gone for good, on every device, with its checklists and activity. Archive it instead to keep it."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(false)}
      onConfirm={() => {
        setDeleting(false)
        router.back()
        void tasks.deleteCard(card.id)
      }}
    />
  </View>
}

export default function CardScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TasksGate><CardDetail cardId={id} /></TasksGate>
}
