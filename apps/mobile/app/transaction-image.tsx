import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import {
  Bot, Camera, Check, ClipboardPaste, Image as ImageIcon, Send, SlidersHorizontal, X
} from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import {
  splitImageDataUrl,
  type MoneyAgentDraft,
  type PurchaseInput,
  type TransactionInput
} from '@ego/core'
import AnalyzedTransactionEditor from '../components/money/AnalyzedTransactionEditor'
import { isoToday } from '../lib/dates'
import { askMoneyAgent } from '../lib/money-agent'
import { useMoney } from '../lib/money-context'
import { useSettings } from '../lib/settings'

interface Attachment {
  base64: string
  mimeType: string
  uri: string
}

interface ChatMessage {
  id: number
  role: 'agent' | 'user'
  text: string
  imageUri?: string
  error?: boolean
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function transactionNotes(draft: MoneyAgentDraft): string {
  return [draft.counterparty.trim(), draft.notes.trim()].filter(Boolean).join('\n').slice(0, 500)
}

export default function TransactionImage(): React.ReactElement {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const money = useMoney()
  const { settings } = useSettings()
  const scroll = useRef<ScrollView>(null)
  const nextId = useRef(2)
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 1,
    role: 'agent',
    text: 'Tell me what you bought or send a receipt. I can prepare one transaction or a whole list.'
  }])
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [pending, setPending] = useState<MoneyAgentDraft[] | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [thinking, setThinking] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [keyboardOverlap, setKeyboardOverlap] = useState(0)
  const snapshot = money.snapshot
  const accounts = snapshot?.accounts.filter((item) => !item.archivedAt) ?? []
  const categories = snapshot?.categories.filter((item) => !item.archivedAt) ?? []
  const missing = !snapshot
    ? 'Connect Cloudflare D1 in Settings before using the money agent.'
    : accounts.length === 0
      ? 'Add an account before using the money agent.'
      : categories.length === 0
        ? 'Add an active income or expense category first.'
        : null
  const missingRoute = !snapshot ? '/settings' : accounts.length === 0 ? '/(money)/accounts' : '/(money)/categories'

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const windowHeight = Dimensions.get('window').height
      const overlap = windowHeight <= event.endCoordinates.screenY
        ? 0
        : Math.max(0, Dimensions.get('screen').height - event.endCoordinates.screenY)
      setKeyboardOverlap(overlap)
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOverlap(0))
    return () => { shown.remove(); hidden.remove() }
  }, [])

  const addMessage = (message: Omit<ChatMessage, 'id'>): void => {
    setMessages((current) => [...current, { ...message, id: nextId.current++ }])
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
  }

  const attachAsset = (asset: ImagePicker.ImagePickerAsset): void => {
    if (!asset.base64) {
      addMessage({ role: 'agent', text: 'The phone could not read that image. Choose it again.', error: true })
      return
    }
    setAttachment({ base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg', uri: asset.uri })
  }

  const camera = async (): Promise<void> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      addMessage({ role: 'agent', text: 'Camera access is off. Allow it in system settings to take a photo.', error: true })
      return
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, base64: true })
    if (!result.canceled) attachAsset(result.assets[0])
  }

  const library = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      addMessage({ role: 'agent', text: 'Photo access is off. Allow it in system settings to choose a receipt.', error: true })
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true })
    if (!result.canceled) attachAsset(result.assets[0])
  }

  const paste = async (): Promise<void> => {
    const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.85 })
    if (!image) {
      addMessage({ role: 'agent', text: 'There is no image on the clipboard.', error: true })
      return
    }
    const parsed = splitImageDataUrl(image.data)
    if (!parsed) {
      addMessage({ role: 'agent', text: 'I could not read the clipboard image. Copy it again and retry.', error: true })
      return
    }
    setAttachment({ ...parsed, uri: image.data })
  }

  const send = async (): Promise<void> => {
    if (!snapshot || thinking || pending || (!text.trim() && !attachment)) return
    const message = text.trim()
    const image = attachment
    addMessage({ role: 'user', text: message || 'Add this receipt.', imageUri: image?.uri })
    Keyboard.dismiss()
    setText('')
    setAttachment(null)
    setThinking(true)
    const result = await askMoneyAgent({
      message,
      image: image ? { base64: image.base64, mimeType: image.mimeType } : undefined,
      apiKey: settings.openRouterApiKey,
      model: settings.receiptModel,
      today: isoToday(),
      accounts: accounts.map(({ id, name }) => ({ id, name })),
      categories: categories.map(({ id, name, kind }) => ({ id, name, kind }))
    })
    setThinking(false)
    if (!result.ok) {
      addMessage({ role: 'agent', text: result.message, error: true })
      return
    }
    setPending(result.data)
    const preparedTotal = result.data.reduce((sum, draft) => sum + draft.amountCents, 0)
    const itemCount = result.data.reduce((sum, draft) => sum + (draft.receipt?.items.length ?? 0), 0)
    addMessage({
      role: 'agent',
      text: result.data.length > 1
        ? `I prepared ${result.data.length} transactions totaling ${dollars(preparedTotal)}.`
        : itemCount > 0
          ? `I read ${itemCount} ${itemCount === 1 ? 'item' : 'items'} from the receipt. Check the total, then add it.`
          : `I prepared a ${dollars(preparedTotal)} ${result.data[0].kind}.`
    })
  }

  const saveDraft = async (draft: MoneyAgentDraft): Promise<boolean> => {
    if (!draft.categoryId) return false
    if (draft.receipt) {
      const input: PurchaseInput = {
        ...draft.receipt,
        accountId: draft.accountId,
        categoryId: draft.categoryId
      }
      return money.createPurchase(input)
    }
    const input: TransactionInput = {
      kind: draft.kind,
      accountId: draft.accountId,
      destinationAccountId: null,
      categoryId: draft.categoryId,
      amountCents: draft.amountCents,
      date: draft.date ?? isoToday(),
      notes: transactionNotes(draft)
    }
    return money.createTransaction(input)
  }

  const savePending = async (): Promise<void> => {
    if (!pending) return
    let savedCount = 0
    for (const draft of pending) {
      if (!await saveDraft(draft)) break
      savedCount += 1
    }
    if (savedCount === pending.length) {
      addMessage({ role: 'agent', text: `Added ${savedCount} ${savedCount === 1 ? 'transaction' : 'transactions'} to D1.` })
      setPending(null)
    } else {
      setPending(pending.slice(savedCount))
      addMessage({ role: 'agent', text: savedCount > 0
        ? `Added ${savedCount}, then D1 stopped. The remaining ${pending.length - savedCount} are still ready to add.`
        : 'D1 did not save these transactions. Check the connection banner, then try again.', error: true })
    }
    setEditingIndex(null)
  }

  const savedReviewedDraft = (index: number, draft: MoneyAgentDraft): void => {
    addMessage({ role: 'agent', text: `Added ${dollars(draft.amountCents)} to D1.` })
    setPending((current) => {
      if (!current) return null
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length ? next : null
    })
    setEditingIndex(null)
  }

  const removePending = (index: number): void => {
    setPending((current) => {
      if (!current) return null
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length ? next : null
    })
    setEditingIndex(null)
  }

  return <KeyboardAvoidingView
    className="flex-1 bg-surface-950"
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={90}
  >
    <ScrollView
      ref={scroll}
      className="flex-1 px-4"
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 16 }}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      <View className="mb-3 flex-row items-center">
        <View className="h-8 w-8 items-center justify-center rounded-full border border-accent-500/40 bg-accent-500/15"><Bot color="#91c4ff" size={16} /></View>
        <View className="ml-2"><Text className="text-[13px] font-bold text-surface-100">Ego money agent</Text><Text className="text-[10px] text-emerald-400">Ready to write to D1</Text></View>
      </View>

      {messages.map((message) => <View key={message.id} className={`mb-2.5 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
        <View className={`max-w-[88%] overflow-hidden rounded-2xl px-3 py-2 ${message.role === 'user' ? 'rounded-br-md bg-accent-600' : message.error ? 'rounded-bl-md border border-red-500/30 bg-red-500/10' : 'rounded-bl-md border border-surface-800 bg-surface-900'}`}>
          {message.imageUri && <Image source={{ uri: message.imageUri }} className="mb-2 h-28 w-44 rounded-lg" resizeMode="cover" />}
          <Text className={`text-[13px] leading-5 ${message.role === 'user' ? 'text-white' : message.error ? 'text-red-300' : 'text-surface-200'}`}>{message.text}</Text>
        </View>
      </View>)}

      {thinking && <View className="mb-2.5 flex-row items-center self-start rounded-2xl rounded-bl-md border border-surface-800 bg-surface-900 px-3 py-2"><ActivityIndicator size="small" color="#91c4ff" /><Text className="ml-2 text-[12px] text-surface-300">Preparing tool call...</Text></View>}

      {pending && <View className="mb-4 overflow-hidden rounded-2xl border border-accent-500/35 bg-surface-900">
        <View className="flex-row items-center border-b border-surface-800 px-3 py-2"><View className="rounded bg-accent-500/15 px-1.5 py-0.5"><Text className="text-[10px] font-bold uppercase tracking-wider text-accent-400">record_transactions</Text></View><Text className="ml-auto text-[11px] text-surface-500">{pending.length} {pending.length === 1 ? 'entry' : 'entries'} ready</Text></View>
        <View className="border-l-2 border-accent-500 px-2.5 py-2.5">
          {pending.map((draft, index) => {
            const accountName = accounts.find((item) => item.id === draft.accountId)?.name
            const categoryName = categories.find((item) => item.id === draft.categoryId)?.name
            return <View key={`${draft.counterparty}-${draft.date}-${index}`} className={index ? 'mt-3 border-t border-surface-700 pt-3' : ''}>
              <View className="flex-row items-start"><View className="flex-1 pr-2"><Text className="text-[13px] font-bold text-surface-100">{draft.receipt?.merchant ?? draft.counterparty}</Text><Text className="text-[11px] capitalize text-surface-400">{draft.kind} · {draft.date}</Text></View><Text className={`text-[14px] font-bold ${draft.kind === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>{dollars(draft.amountCents)}</Text></View>
              <View className="mt-2 flex-row flex-wrap gap-1.5"><View className="rounded-full bg-surface-800 px-2 py-1"><Text className="text-[10px] text-surface-300">{accountName}</Text></View><View className="rounded-full bg-surface-800 px-2 py-1"><Text className="text-[10px] text-surface-300">{categoryName}</Text></View>{draft.receipt && <View className="rounded-full bg-surface-800 px-2 py-1"><Text className="text-[10px] text-surface-300">{draft.receipt.items.length} items</Text></View>}</View>
              {editingIndex === index && snapshot
                ? <View className="mt-4 border-t border-surface-800 pt-4"><Pressable onPress={() => setEditingIndex(null)} className="mb-3 self-end rounded-lg border border-surface-700 px-2.5 py-1.5"><Text className="text-[11px] font-semibold text-surface-300">Close review</Text></Pressable><AnalyzedTransactionEditor snapshot={snapshot} draft={draft} initialAccountId={draft.accountId} onSaved={() => savedReviewedDraft(index, draft)} /></View>
                : editingIndex === null && <View className="mt-3 flex-row gap-2"><Pressable onPress={() => setEditingIndex(index)} className="flex-1 flex-row items-center justify-center rounded-lg border border-surface-700 px-3 py-2"><SlidersHorizontal color="#b5b5bc" size={13} /><Text className="ml-1.5 text-[11px] font-semibold text-surface-300">Review</Text></Pressable><Pressable accessibilityLabel={`Discard ${draft.counterparty}`} onPress={() => removePending(index)} className="rounded-lg border border-surface-700 px-2.5 py-2"><X color="#b5b5bc" size={14} /></Pressable></View>}
            </View>
          })}
          {editingIndex === null && <Pressable disabled={money.busy} onPress={() => void savePending()} className={`mt-3 flex-row items-center justify-center rounded-lg px-3 py-2.5 ${money.busy ? 'bg-surface-700' : 'bg-accent-600'}`}><Check color="#fff" size={15} /><Text className="ml-1.5 text-[13px] font-bold text-white">{money.busy ? 'Adding...' : `Add ${pending.length} to D1`}</Text></Pressable>}
        </View>
      </View>}

      {missing && <View className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><Text className="text-[12px] leading-5 text-amber-300">{missing}</Text><Pressable onPress={() => router.push(missingRoute)} className="mt-2.5 self-start rounded-lg bg-accent-600 px-3 py-2"><Text className="text-[12px] font-bold text-white">Open setup</Text></Pressable></View>}
    </ScrollView>

    <View
      className="border-t border-surface-800 bg-surface-900 px-4 pt-3"
      style={Platform.OS === 'android' && composerFocused
        ? { position: 'absolute', left: 0, right: 0, bottom: keyboardOverlap, paddingBottom: 12 }
        : { paddingBottom: 12 + Math.max(10, insets.bottom) }}
    >
      {attachment && <View className="mb-2 flex-row items-center rounded-lg border border-surface-700 bg-surface-950 p-2"><Image source={{ uri: attachment.uri }} className="h-10 w-10 rounded" resizeMode="cover" /><View className="ml-2 flex-1"><Text className="text-[12px] font-semibold text-surface-200">Receipt attached</Text><Text className="text-[10px] text-surface-500">Add a note or send it now</Text></View><Pressable onPress={() => setAttachment(null)} className="p-1.5"><X color="#b5b5bc" size={15} /></Pressable></View>}
      <View className="mb-2 flex-row gap-1"><Pressable accessibilityLabel="Take receipt photo" onPress={() => void camera()} className="flex-row items-center rounded-lg px-2.5 py-1.5"><Camera color="#91c4ff" size={15} /><Text className="ml-1.5 text-[11px] font-semibold text-accent-400">Camera</Text></Pressable><Pressable accessibilityLabel="Choose receipt image" onPress={() => void library()} className="flex-row items-center rounded-lg px-2.5 py-1.5"><ImageIcon color="#b5b5bc" size={15} /><Text className="ml-1.5 text-[11px] font-semibold text-surface-300">Photos</Text></Pressable><Pressable accessibilityLabel="Paste receipt image" onPress={() => void paste()} className="flex-row items-center rounded-lg px-2.5 py-1.5"><ClipboardPaste color="#b5b5bc" size={15} /><Text className="ml-1.5 text-[11px] font-semibold text-surface-300">Paste</Text></Pressable></View>
      <View className="flex-row items-end rounded-2xl border border-surface-700 bg-surface-950 p-2"><TextInput value={text} onChangeText={setText} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} multiline maxLength={500} editable={!thinking && !pending && !missing} placeholder="Add $25 at Publix and $12 for gas..." placeholderTextColor="#707078" className="max-h-24 min-h-9 flex-1 px-3 py-1.5 text-[13px] leading-5 text-surface-100" /><Pressable accessibilityLabel="Send to money agent" disabled={thinking || Boolean(pending) || Boolean(missing) || (!text.trim() && !attachment)} onPress={() => void send()} className={`h-9 w-9 items-center justify-center rounded-lg ${thinking || pending || missing || (!text.trim() && !attachment) ? 'bg-surface-800' : 'bg-accent-600'}`}><Send color={thinking || pending || missing || (!text.trim() && !attachment) ? '#707078' : '#fff'} size={16} /></Pressable></View>
    </View>
  </KeyboardAvoidingView>
}
