import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { Check, MessageSquarePlus, Sparkles, Trash2, Undo2, X } from 'lucide-react-native'
import type { AssistantChat, AssistantMessage, AssistantPendingWrite } from '@ego/api-contracts'
import { BottomSheet } from '../money/Common'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Text } from '../ui/text'

const EXAMPLES = [
  'What was my mood yesterday?',
  'Max bench press in the past month?',
  'How many times did I read this month?',
  'Publix $42 and gas $30',
  'Bench 3x8 at 185, squats 5x5 at 225',
  'Mood 4 today, slept well'
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
        : message.hasImage && <Badge variant="outline" className="mb-2 border-black/20"><Text className="text-primary-foreground">Receipt image</Text></Badge>}
      {message.text.length > 0 && <Text className="text-[16px] leading-6 text-primary-foreground">{message.text}</Text>}
    </View>
  </View>
}

export function AssistantBubble({ message, undoing, onUndo }: {
  message: AssistantMessage
  undoing: string | null
  onUndo: (callId: string) => void
}): React.ReactElement {
  return <View className="mb-3 items-start">
    {message.text.length > 0 && <View className="max-w-[86%] rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
      <Text className="text-[16px] leading-6">{message.text}</Text>
    </View>}
    <Trail lines={message.trail} />
    {message.undo.map((undo) => <Pressable
      key={undo.callId}
      accessibilityRole="button"
      accessibilityLabel={`Undo the ${undo.label}`}
      disabled={undoing !== null}
      onPress={() => onUndo(undo.callId)}
      className="mt-1.5 flex-row items-center self-start rounded-full border border-surface-700 px-3 py-1.5 active:bg-surface-800"
    >
      {undoing === undo.callId
        ? <ActivityIndicator size="small" color="#d4d4d4" />
        : <Undo2 color="#d4d4d4" size={14} />}
      <Text className="ml-1.5 text-[13px] font-medium text-surface-200">Undo the {undo.label}</Text>
    </Pressable>)}
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

export function PendingCard({ pending, busy, onAnswer }: {
  pending: AssistantPendingWrite
  busy: boolean
  onAnswer: (approved: boolean) => void
}): React.ReactElement {
  return <Card className="mb-4 overflow-hidden">
    <View className="border-b border-surface-800 px-5 py-4">
      <Text className="text-[17px] font-semibold">{pending.title}</Text>
    </View>
    <View className="px-5 py-4">
      {pending.lines.map((line, index) => <Text key={`${index}-${line}`} className={`text-[15px] leading-6 ${index ? 'mt-1.5' : ''}`}>{line}</Text>)}
      <View className="mt-4 flex-row gap-2">
        <Button variant="outline" size="lg" disabled={busy} onPress={() => onAnswer(false)} className="flex-1">
          <X color="#d4d4d4" size={18} />
          <Text>Reject</Text>
        </Button>
        <Button size="lg" disabled={busy} onPress={() => onAnswer(true)} className="flex-1">
          <Check color="#0a0a0a" size={18} />
          <Text>Confirm</Text>
        </Button>
      </View>
      <Text className="mt-3 text-[13px] text-muted-foreground">Or just keep typing to drop it.</Text>
    </View>
  </Card>
}

export function Intro({ onPick }: { onPick: (text: string) => void }): React.ReactElement {
  return <View className="mb-4">
    <View className="mb-5 flex-row items-center">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Sparkles color="#fafafa" size={22} /></View>
      <View className="ml-3 flex-1">
        <Text className="text-[18px] font-semibold">Ask, or tell me what happened</Text>
        <Text className="text-[15px] text-muted-foreground">Money, gym, health, mood, habits, and study</Text>
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
