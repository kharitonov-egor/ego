import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { MessageSquarePlus, Sparkles, Trash2, X } from 'lucide-react-native'
import type { AssistantChat, AssistantMessage, AssistantPendingWrite } from '@ego/api-contracts'
import { BottomSheet } from '../money/Common'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { SAVE_DELAY_MS, SaveCountdown } from '../ui/countdown'
import { Text } from '../ui/text'

const EXAMPLES = [
  'What was my mood yesterday?',
  'Max bench press in the past month?',
  'Publix $42 and gas $30',
  'Bench 3x8 at 185, squats 5x5 at 225',
  'Two eggs and toast for breakfast',
  'How much protein today?',
  'What\'s in my fridge?'
]

export function Trail({ lines }: { lines: readonly string[] }): React.ReactElement | null {
  if (lines.length === 0) return null
  return <View className="mt-1.5 gap-0.5 pl-1">
    {lines.map((line, index) => <View key={`${index}-${line}`} className="flex-row items-start">
      <View className="mr-2 mt-[7px] h-1.5 w-1.5 rounded-full bg-surface-500" />
      <Text className="flex-1 text-[13px] leading-5 text-muted-foreground">{line}</Text>
    </View>)}
  </View>
}

export function UserBubble({ message, imageUri }: { message: AssistantMessage; imageUri: string | null }): React.ReactElement {
  return <View className="mb-3 items-end">
    <View className="max-w-[86%] overflow-hidden rounded-3xl rounded-br-lg bg-primary px-4 py-3">
      {imageUri
        ? <Image source={{ uri: imageUri }} className="mb-2 h-36 w-52 rounded-2xl" resizeMode="cover" />
        : message.hasImage && <Badge variant="outline" className="mb-2 border-black/20"><Text className="text-primary-foreground">Photo</Text></Badge>}
      {message.text.length > 0 && <Text className="text-[16px] leading-6 text-primary-foreground">{message.text}</Text>}
    </View>
  </View>
}

export function AssistantBubble({ message }: { message: AssistantMessage }): React.ReactElement {
  return <View className="mb-3 items-start">
    {message.text.length > 0 && <View className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
      <Text className="text-[16px] leading-6">{message.text}</Text>
    </View>}
    <Trail lines={message.trail} />
  </View>
}

export function StreamingBubble({ text, trail }: { text: string; trail: readonly string[] }): React.ReactElement {
  return <View className="mb-3 items-start">
    {text.trim().length > 0
      ? <View className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <Text className="text-[16px] leading-6">{text.trimStart()}</Text>
      </View>
      : <View className="flex-row items-center rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <ActivityIndicator size="small" color="#fafafa" />
        <Text className="ml-2.5 text-[15px] text-muted-foreground">{trail.length > 0 ? 'Working' : 'Thinking'}</Text>
      </View>}
    <Trail lines={trail} />
  </View>
}

export function ErrorBubble({ text, onDismiss }: { text: string; onDismiss: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Dismisses this message"
    onPress={onDismiss}
    className="mb-3 max-w-[86%] flex-row items-center self-start rounded-3xl rounded-bl-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
  >
    <Text className="flex-1 text-[15px] leading-6 text-rose-200">{text}</Text>
    <X color="#fca5a5" size={16} />
  </Pressable>
}

/** Everything one reply asked to save. It saves itself unless Undo comes first; sending a new message saves it too. */
export function PendingCard({ pending, onSave, onUndo }: {
  pending: AssistantPendingWrite
  onSave: () => void
  onUndo: () => void
}): React.ReactElement {
  const seconds = SAVE_DELAY_MS / 1000
  const changes = pending.changes ?? [{ toolName: pending.toolName, title: pending.title, lines: pending.lines }]
  return <Card className="mb-4 overflow-hidden">
    <View className="border-b border-surface-800 px-5 py-4">
      <SaveCountdown
        runKey={pending.callId}
        paused={false}
        label={changes.length === 1 ? `Saves in ${seconds} seconds` : `Saves ${changes.length} changes in ${seconds} seconds`}
        onElapsed={onSave}
        onUndo={onUndo}
      />
    </View>
    <View className="gap-4 px-5 py-4">
      {changes.map((change, index) => <View key={`${index}-${change.toolName}`}>
        <Text className="text-[17px] font-semibold">{change.title}</Text>
        {change.lines.map((line, row) => <Text key={`${row}-${line}`} className="mt-1 text-[15px] leading-6 text-surface-200">{line}</Text>)}
      </View>)}
    </View>
  </Card>
}

export function Intro({ onPick }: { onPick: (text: string) => void }): React.ReactElement {
  return <View className="mb-4">
    <View className="mb-5 flex-row items-center">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Sparkles color="#fafafa" size={22} /></View>
      <View className="ml-3 flex-1">
        <Text className="text-[18px] font-semibold">Ask, or tell me what happened</Text>
        <Text className="text-[15px] text-muted-foreground">Money, gym, health, mood, habits, study, and food</Text>
      </View>
    </View>
    <View className="flex-row flex-wrap gap-2">
      {EXAMPLES.map((example) => <Pressable
        key={example}
        accessibilityRole="button"
        onPress={() => onPick(example)}
        className="rounded-full border border-surface-700 px-3.5 py-2 active:bg-surface-800"
      ><Text className="text-[14px] text-surface-200">{example}</Text></Pressable>)}
    </View>
  </View>
}

function chatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ChatsSheet({ visible, chats, currentId, onClose, onOpen, onNew, onDelete }: {
  visible: boolean
  chats: readonly AssistantChat[]
  currentId: string | null
  onClose: () => void
  onOpen: (chat: AssistantChat) => void
  onNew: () => void
  onDelete: (chat: AssistantChat) => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title="Chats" onClose={onClose} dismissOnBackdrop>
    <Pressable accessibilityRole="button" onPress={onNew} className="mb-2 min-h-14 flex-row items-center gap-4 rounded-2xl bg-surface-900 px-4 active:bg-surface-800">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary"><MessageSquarePlus color="#0a0a0a" size={20} /></View>
      <Text className="text-[16px] font-semibold">New chat</Text>
    </Pressable>
    <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
      {chats.length === 0 && <Text className="px-1 py-3 text-[15px] text-muted-foreground">No chats yet.</Text>}
      {chats.map((chat) => <View key={chat.id} className={`mb-2 flex-row items-center rounded-2xl border px-4 ${chat.id === currentId ? 'border-surface-500 bg-surface-900' : 'border-surface-800 bg-surface-900/50'}`}>
        <Pressable accessibilityRole="button" onPress={() => onOpen(chat)} className="min-h-14 flex-1 justify-center py-2">
          <Text numberOfLines={1} className="text-[16px] font-medium">{chat.title || 'Chat'}</Text>
          <Text className="text-[13px] text-muted-foreground">{chatDate(chat.updatedAt)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${chat.title || 'this chat'}`} onPress={() => onDelete(chat)} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
          <Trash2 color="#a3a3a3" size={18} />
        </Pressable>
      </View>)}
    </ScrollView>
  </BottomSheet>
}
