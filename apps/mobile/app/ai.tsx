import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState, Image, Keyboard, Pressable, ScrollView, TextInput, View
} from 'react-native'
import { useKeyboardVisible } from '../components/ui/keyboard'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import {
  Brain, Camera, ClipboardPaste, Image as ImageIcon, LayoutGrid, MessagesSquare, Paperclip, Send, SquarePen, Target, X
} from 'lucide-react-native'
import type {
  AgentInbox, AgentProposal, ApiResult, AssistantChat, AssistantMessage, AssistantPendingWrite, AssistantStreamEvent, AssistantUnits
} from '@ego/api-contracts'
import { fromCamera, fromClipboard, fromLibrary, type Attachment, type AttachmentResult } from '../components/assistant/attachments'
import {
  AgentIntro, AssistantBubble, ChatsSheet, ErrorBubble, Intro, PendingCard, ProposalCard, StreamingBubble, UserBubble
} from '../components/assistant/ui'
import { HeaderIcon } from '../components/gym/ui'
import { BottomSheet, ConfirmDialog } from '../components/money/Common'
import { PrivateGate } from '../components/PrivateGate'
import { Button } from '../components/ui/button'
import { Text } from '../components/ui/text'
import { isoToday } from '@ego/local/dates'
import { useLedger } from '../lib/ledger-context'

const UNITS_KEY = 'ego.health.units'

interface Streaming {
  text: string
  trail: string[]
}

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}

/** The Agent chat stays pinned first; the rest go newest first. */
function withChat(chats: AssistantChat[], chat: AssistantChat): AssistantChat[] {
  const rest = chats.filter((item) => item.id !== chat.id)
  if (chat.kind === 'agent') return [chat, ...rest]
  return [...rest.filter((item) => item.kind === 'agent'), chat, ...rest.filter((item) => item.kind !== 'agent')]
}

function firstRegular(chats: readonly AssistantChat[]): AssistantChat | null {
  return chats.find((chat) => chat.kind !== 'agent') ?? null
}

function AttachOption({ Icon, label, onPress }: { Icon: typeof Camera; label: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="mb-2 min-h-14 flex-row items-center gap-4 rounded-2xl bg-surface-900 px-4 active:bg-surface-800">
    <View className="h-10 w-10 items-center justify-center rounded-full bg-primary"><Icon color="#0a0a0a" size={20} /></View>
    <Text className="text-[16px] font-semibold">{label}</Text>
  </Pressable>
}

export default function AiScreen(): React.ReactElement {
  return <PrivateGate label="AI"><Assistant /></PrivateGate>
}

function Assistant(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ chat?: string }>()
  const insets = useSafeAreaInsets()
  const ledger = useLedger()
  const { api } = ledger
  const scroll = useRef<ScrollView>(null)
  const [chats, setChats] = useState<AssistantChat[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [pending, setPending] = useState<AssistantPendingWrite | null>(null)
  const [proposals, setProposals] = useState<AgentProposal[]>([])
  const [answering, setAnswering] = useState<string | null>(null)
  const [inbox, setInbox] = useState<AgentInbox | null>(null)
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [deleting, setDeleting] = useState<AssistantChat | null>(null)
  const [units, setUnits] = useState<AssistantUnits>('imperial')
  const keyboardVisible = useKeyboardVisible()
  const imageUris = useRef(new Map<string, string>())
  const pendingImage = useRef<string | null>(null)
  const shown = useRef<AssistantPendingWrite | null>(null)
  shown.current = pending
  const unitsRef = useRef(units)
  unitsRef.current = units
  const syncRef = useRef(ledger.sync)
  syncRef.current = ledger.sync
  const openChat = chats.find((chat) => chat.id === chatId) ?? null
  const inAgent = openChat?.kind === 'agent'
  const openChatRef = useRef(openChat)
  openChatRef.current = openChat
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const busyRef = useRef(busy)
  busyRef.current = busy
  const wantsAgent = useRef(params.chat === 'agent')
  const inboxRequest = useRef(0)

  /** Only the newest answer counts, so a slow inbox read cannot undo a later mark-as-read. */
  const trackInbox = useCallback(async (request: Promise<ApiResult<AgentInbox>>): Promise<void> => {
    inboxRequest.current += 1
    const id = inboxRequest.current
    const result = await request
    if (result.ok && id === inboxRequest.current) setInbox(result.data)
  }, [])

  /** A card left behind by switching chats or leaving the tile was never undone, so it saves. */
  const saveLeftCard = useCallback((): void => {
    const card = shown.current
    if (!card) return
    shown.current = null
    void api.assistantConfirm({
      chatId: card.chatId, callId: card.callId, approved: true, today: isoToday(), timeZone: timeZone(), units: unitsRef.current
    }, () => undefined).then(() => syncRef.current())
  }, [api])
  const leaving = useRef(saveLeftCard)
  leaving.current = saveLeftCard

  useEffect(() => () => leaving.current(), [])

  const scrollToEnd = useCallback((): void => {
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
  }, [])

  useEffect(() => {
    void SecureStore.getItemAsync(UNITS_KEY).then((value) => {
      if (value === 'metric' || value === 'imperial') setUnits(value)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (keyboardVisible) scrollToEnd()
  }, [keyboardVisible, scrollToEnd])

  const open = useCallback(async (chat: AssistantChat | null): Promise<void> => {
    saveLeftCard()
    setChatId(chat?.id ?? null)
    setPending(null)
    setProposals([])
    setStreaming(null)
    setError(null)
    if (!chat) {
      setMessages([])
      setLoading(false)
      return
    }
    setLoading(true)
    const result = await api.assistantMessages(chat.id)
    setLoading(false)
    if (!result.ok) {
      setMessages([])
      setError(result.error.message)
      return
    }
    setMessages(result.data.messages)
    setPending(result.data.pending)
    setProposals(result.data.proposals ?? [])
    if (chat.kind === 'agent') void trackInbox(api.markAgentRead())
    scrollToEnd()
  }, [api, saveLeftCard, scrollToEnd, trackInbox])

  useEffect(() => {
    if (!ledger.enabled) {
      setLoading(false)
      return
    }
    let active = true
    void api.assistantChats().then((result) => {
      if (!active) return
      if (!result.ok) {
        setLoading(false)
        setError(result.error.message)
        return
      }
      setChats(result.data.chats)
      const agent = result.data.chats.find((chat) => chat.kind === 'agent')
      const first = wantsAgent.current && agent ? agent : firstRegular(result.data.chats)
      wantsAgent.current = false
      void open(first)
    })
    return () => { active = false }
  }, [api, ledger.enabled, open])

  useEffect(() => {
    if (params.chat !== 'agent') return
    router.setParams({ chat: undefined })
    const agent = chatsRef.current.find((chat) => chat.kind === 'agent')
    if (agent) void open(agent)
    else wantsAgent.current = true
  }, [open, params.chat, router])

  /** The agent posts while the screen is away, so coming back re-reads the Agent chat, or at least the badge. */
  const refreshAgent = useCallback(async (): Promise<void> => {
    const chat = openChatRef.current
    if (chat?.kind !== 'agent') {
      await trackInbox(api.agentInbox())
      return
    }
    if (busyRef.current) return
    const result = await api.assistantMessages(chat.id)
    if (!result.ok || openChatRef.current?.id !== chat.id || busyRef.current) return
    setMessages(result.data.messages)
    setProposals(result.data.proposals ?? [])
    await trackInbox(api.markAgentRead())
  }, [api, trackInbox])
  const refreshRef = useRef(refreshAgent)
  refreshRef.current = refreshAgent

  useFocusEffect(useCallback(() => {
    if (ledger.enabled) void refreshAgent()
  }, [ledger.enabled, refreshAgent]))

  useEffect(() => {
    if (!ledger.enabled) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRef.current()
    })
    return () => subscription.remove()
  }, [ledger.enabled])

  const handleEvent = useCallback((event: AssistantStreamEvent): void => {
    if (event.type === 'chat') {
      setChatId(event.chat.id)
      setChats((items) => withChat(items, event.chat))
    } else if (event.type === 'message') {
      if (event.message.role === 'user' && pendingImage.current) {
        imageUris.current.set(event.message.id, pendingImage.current)
        pendingImage.current = null
      }
      setMessages((current) => [...current.filter((message) => !message.id.startsWith('local-')), event.message])
      if (event.message.role === 'assistant') setStreaming(null)
    } else if (event.type === 'delta') {
      setStreaming((current) => ({ text: (current?.text ?? '') + event.text, trail: current?.trail ?? [] }))
    } else if (event.type === 'trail') {
      setStreaming((current) => ({ text: current?.text ?? '', trail: [...(current?.trail ?? []), event.line] }))
    } else if (event.type === 'pending') {
      setPending(event.pending)
    } else if (event.type === 'error') {
      setError(event.error.message)
    }
    scrollToEnd()
  }, [scrollToEnd])

  const finishTurn = useCallback((chat: string | null): void => {
    setBusy(false)
    setStreaming(null)
    if (chat) setChats((current) => current.map((item) => item.id === chat ? { ...item, updatedAt: new Date().toISOString() } : item))
    void ledger.sync()
  }, [ledger])

  const send = async (): Promise<void> => {
    const message = text.trim()
    const image = attachment
    if (busy || (!message && !image)) return
    Keyboard.dismiss()
    setText('')
    setAttachment(null)
    setError(null)
    shown.current = null
    setPending(null)
    setBusy(true)
    setStreaming({ text: '', trail: [] })
    pendingImage.current = image?.uri ?? null
    const local: AssistantMessage = {
      id: `local-${Date.now()}`, chatId: chatId ?? '', seq: Number.MAX_SAFE_INTEGER, role: 'user', text: message,
      createdAt: new Date().toISOString(), trail: [], hasImage: image !== null, undo: []
    }
    if (image) imageUris.current.set(local.id, image.uri)
    setMessages((current) => [...current, local])
    scrollToEnd()
    const result = await api.assistantTurn({
      chatId, text: message, image: image ? { base64: image.base64, mimeType: image.mimeType } : undefined,
      today: isoToday(), timeZone: timeZone(), units, autoSave: true
    }, handleEvent)
    finishTurn(chatId)
    if (!result.ok) {
      setError(result.error.message)
      setMessages((current) => current.filter((item) => item.id !== local.id))
      setText(message)
      setAttachment(image)
    }
  }

  /** The card's timer saves; Undo drops everything on it. Either way the card is gone for good. */
  const answer = async (approved: boolean): Promise<void> => {
    if (!pending || busy) return
    const current = pending
    shown.current = null
    setPending(null)
    setError(null)
    setBusy(true)
    setStreaming({ text: '', trail: [] })
    const result = await api.assistantConfirm({
      chatId: current.chatId, callId: current.callId, approved, today: isoToday(), timeZone: timeZone(), units
    }, handleEvent)
    finishTurn(current.chatId)
    if (!result.ok) setError(result.error.message)
  }

  const answerProposal = async (proposal: AgentProposal, approved: boolean): Promise<void> => {
    if (answering || busy) return
    setAnswering(proposal.id)
    setError(null)
    const result = await api.answerAgentProposal(proposal.id, approved)
    setAnswering(null)
    if (!result.ok) {
      setError(result.error.message)
      if (result.error.code === 'CONFLICT') void refreshAgent()
      return
    }
    const note = result.data.message
    setProposals((items) => items.filter((item) => item.id !== proposal.id))
    setMessages((items) => [...items.filter((item) => item.id !== note.id), note])
    scrollToEnd()
    void trackInbox(api.markAgentRead())
    void ledger.sync()
  }

  const attach = async (pick: () => Promise<AttachmentResult>): Promise<void> => {
    setAttaching(false)
    const result = await pick()
    if (result.ok) setAttachment(result.attachment)
    else if (result.message) setError(result.message)
  }

  const remove = async (chat: AssistantChat): Promise<void> => {
    setDeleting(null)
    const result = await api.assistantDeleteChat(chat.id)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const remaining = chats.filter((item) => item.id !== chat.id)
    setChats(remaining)
    if (chat.id === chatId) void open(firstRegular(remaining))
  }

  const agentWaiting = inbox ? inbox.unread + inbox.proposals : 0

  const header = <Stack.Screen options={{
    headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderIcon>,
    headerRight: () => <View className="flex-row">
      <HeaderIcon label="Goals" onPress={() => router.push('/goals')}><Target color="#fafafa" size={21} /></HeaderIcon>
      <HeaderIcon label="Memory" onPress={() => router.push('/memory')}><Brain color="#fafafa" size={21} /></HeaderIcon>
      <HeaderIcon label={agentWaiting > 0 ? `Chats, ${agentWaiting} new in Agent` : 'Chats'} onPress={() => setChatsOpen(true)}>
        <View>
          <MessagesSquare color="#fafafa" size={21} />
          {agentWaiting > 0 && <View className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-attention" />}
        </View>
      </HeaderIcon>
      <HeaderIcon label="New chat" onPress={() => void open(null)}><SquarePen color="#fafafa" size={21} /></HeaderIcon>
    </View>
  }} />

  if (!ledger.enabled) {
    return <>{header}<View className="flex-1 items-center justify-center bg-background px-8">
      <Text className="text-center text-[20px] font-semibold">Sign in to talk to Ego</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">Sign in once with Google on the start screen. The chat then reads and records your data through the Worker.</Text>
      <Button onPress={() => router.dismissTo('/')} className="mt-5"><Text>Go to sign in</Text></Button>
    </View></>
  }

  const canSend = !busy && (text.trim().length > 0 || attachment !== null)

  return <View className="flex-1 bg-background">
    {header}
    <ScrollView
      ref={scroll}
      className="flex-1 px-4"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: 16 }}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {!loading && messages.length === 0 && !streaming && (inAgent
        ? proposals.length === 0 && <AgentIntro onGoals={() => router.push('/goals')} />
        : <Intro onPick={setText} />)}
      {messages.map((message) => message.role === 'user'
        ? <UserBubble key={message.id} message={message} imageUri={imageUris.current.get(message.id) ?? null} />
        : <AssistantBubble key={message.id} message={message} />)}
      {streaming && <StreamingBubble text={streaming.text} trail={streaming.trail} />}
      {pending && !busy && <PendingCard pending={pending} onSave={() => void answer(true)} onUndo={() => void answer(false)} />}
      {inAgent && proposals.map((proposal) => <ProposalCard
        key={proposal.id}
        proposal={proposal}
        busy={answering === proposal.id}
        disabled={answering !== null || busy}
        onConfirm={() => void answerProposal(proposal, true)}
        onReject={() => void answerProposal(proposal, false)}
      />)}
      {error && <ErrorBubble text={error} onDismiss={() => setError(null)} />}
    </ScrollView>

    <View
      className="border-t border-surface-800 bg-background px-4 pt-3"
      style={{ paddingBottom: keyboardVisible ? 12 : 12 + Math.max(10, insets.bottom) }}
    >
      {attachment && <View className="mb-3 flex-row items-center rounded-2xl border border-border bg-card p-2.5">
        <Image source={{ uri: attachment.uri }} className="h-12 w-12 rounded-xl" resizeMode="cover" />
        <View className="ml-3 flex-1">
          <Text className="text-[15px] font-semibold">Photo attached</Text>
          <Text className="text-[14px] text-muted-foreground">Add a note or send it now</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove the photo" onPress={() => setAttachment(null)} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"><X color="#d4d4d4" size={18} /></Pressable>
      </View>}
      <View className="flex-row items-end rounded-3xl border border-input bg-surface-900 p-1.5 pl-1.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          disabled={busy}
          onPress={() => setAttaching(true)}
          className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"
        ><Paperclip color="#d4d4d4" size={20} /></Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          maxLength={4000}
          editable={!busy}
          accessibilityLabel="Message to Ego"
          placeholder="Ask or tell me what happened"
          placeholderTextColor="#737373"
          className="max-h-28 min-h-11 flex-1 px-2 py-2.5 text-[17px] leading-6 text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!canSend}
          onPress={() => void send()}
          className={`h-11 w-11 items-center justify-center rounded-full ${canSend ? 'bg-primary active:bg-primary/85' : 'bg-surface-800'}`}
        ><Send color={canSend ? '#0a0a0a' : '#737373'} size={18} /></Pressable>
      </View>
    </View>

    <BottomSheet visible={attaching} title="Attach a photo" onClose={() => setAttaching(false)} dismissOnBackdrop>
      <AttachOption Icon={Camera} label="Camera" onPress={() => void attach(fromCamera)} />
      <AttachOption Icon={ImageIcon} label="Photos" onPress={() => void attach(fromLibrary)} />
      <AttachOption Icon={ClipboardPaste} label="Paste image" onPress={() => void attach(fromClipboard)} />
    </BottomSheet>
    <ChatsSheet
      visible={chatsOpen}
      chats={chats}
      currentId={chatId}
      agentWaiting={agentWaiting}
      onClose={() => setChatsOpen(false)}
      onOpen={(chat) => { setChatsOpen(false); void open(chat) }}
      onNew={() => { setChatsOpen(false); void open(null) }}
      onDelete={(chat) => { setChatsOpen(false); setDeleting(chat) }}
    />
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this chat?"
      detail="The messages are removed from the list. Anything already recorded in the other apps stays."
      confirmLabel="Delete" destructive hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => { if (deleting) void remove(deleting) }}
    />
  </View>
}
