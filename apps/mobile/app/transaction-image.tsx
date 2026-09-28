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
import { amountColor, amountSign } from '../components/money/tokens'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Text as UiText } from '../components/ui/text'
import { formatIso, isoToday } from '../lib/dates'
import { useLedger } from '../lib/ledger-context'
import { useMoney } from '../lib/money-context'

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

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function dollars(cents: number): string {
  return USD.format(cents / 100)
}

function transactionNotes(draft: MoneyAgentDraft): string {
  return [draft.counterparty.trim(), draft.notes.trim()].filter(Boolean).join('\n').slice(0, 500)
}

export default function TransactionImage(): React.ReactElement {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const money = useMoney()
  const ledger = useLedger()
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
  const missing = !ledger.enabled
    ? 'Sign in with Google in Settings to use the money agent.'
    : !snapshot
      ? 'Your ledger is still downloading. Try again in a moment.'
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
    const result = await ledger.api.moneyAgent({
      message,
      image: image ? { base64: image.base64, mimeType: image.mimeType } : undefined,
      today: isoToday(),
      accounts: accounts.map(({ id, name }) => ({ id, name })),
      categories: categories.map(({ id, name, kind }) => ({ id, name, kind }))
    })
    setThinking(false)
    if (!result.ok) {
      addMessage({ role: 'agent', text: result.error.message, error: true })
      if (image) setAttachment(image)
      if (message) setText(message)
      return
    }
    const drafts = result.data.drafts
    setPending(drafts)
    const preparedTotal = drafts.reduce((sum, draft) => sum + draft.amountCents, 0)
    const itemCount = drafts.reduce((sum, draft) => sum + (draft.receipt?.items.length ?? 0), 0)
    addMessage({
      role: 'agent',
      text: drafts.length > 1
        ? `I prepared ${drafts.length} transactions totaling ${dollars(preparedTotal)}.`
        : itemCount > 0
          ? `I read ${itemCount} ${itemCount === 1 ? 'item' : 'items'} from the receipt. Check the total, then add it.`
          : `I prepared a ${dollars(preparedTotal)} ${drafts[0].kind}.`
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
      addMessage({ role: 'agent', text: `Added ${savedCount} ${savedCount === 1 ? 'transaction' : 'transactions'}.` })
      setPending(null)
    } else {
      setPending(pending.slice(savedCount))
      addMessage({ role: 'agent', text: savedCount > 0
        ? `Added ${savedCount}, then one was refused. Open Review on the remaining ${pending.length - savedCount} to check the account and category.`
        : 'These were not saved. Open Review to check the account and category.', error: true })
    }
    setEditingIndex(null)
  }

  const savedReviewedDraft = (index: number, draft: MoneyAgentDraft): void => {
    addMessage({ role: 'agent', text: `Added ${dollars(draft.amountCents)}.` })
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

  const blocked = thinking || Boolean(pending) || Boolean(missing)
  const canSend = !blocked && (text.trim().length > 0 || attachment !== null)

  return <KeyboardAvoidingView
    className="flex-1 bg-background"
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={90}
  >
    <ScrollView
      ref={scroll}
      className="flex-1 px-4"
      contentContainerStyle={{ paddingTop: 16, paddingBottom: 16 }}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      <View className="mb-5 flex-row items-center">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-800"><Bot color="#fafafa" size={22} /></View>
        <View className="ml-3 flex-1">
          <UiText className="text-[18px] font-semibold">Money agent</UiText>
          <UiText className="text-[15px] text-muted-foreground">{ledger.enabled ? 'Send a receipt photo or type what you spent' : 'Sign in to use the agent'}</UiText>
        </View>
      </View>

      {messages.map((message) => <View key={message.id} className={`mb-3 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
        <View className={`max-w-[86%] overflow-hidden rounded-3xl px-4 py-3 ${message.role === 'user' ? 'rounded-br-lg bg-primary' : message.error ? 'rounded-bl-lg border border-destructive/30 bg-destructive/10' : 'rounded-bl-lg border border-border bg-card'}`}>
          {message.imageUri && <Image source={{ uri: message.imageUri }} className="mb-2 h-36 w-52 rounded-2xl" resizeMode="cover" />}
          <UiText className={`text-[16px] leading-6 ${message.role === 'user' ? 'text-primary-foreground' : message.error ? 'text-rose-200' : ''}`}>{message.text}</UiText>
        </View>
      </View>)}

      {thinking && <View className="mb-3 flex-row items-center self-start rounded-3xl rounded-bl-lg border border-border bg-card px-4 py-3">
        <ActivityIndicator size="small" color="#fafafa" />
        <UiText className="ml-2.5 text-[15px] text-muted-foreground">Reading...</UiText>
      </View>}

      {pending && <Card className="mb-4 overflow-hidden">
        <View className="flex-row items-center border-b border-surface-800 px-5 py-4">
          <Badge variant="secondary"><UiText>Review</UiText></Badge>
          <UiText className="ml-auto text-[15px] text-muted-foreground">{pending.length} {pending.length === 1 ? 'entry' : 'entries'} ready</UiText>
        </View>
        <View className="px-5 py-4">
          {pending.map((draft, index) => {
            const accountName = accounts.find((item) => item.id === draft.accountId)?.name
            const categoryName = categories.find((item) => item.id === draft.categoryId)?.name
            return <View key={`${draft.counterparty}-${draft.date}-${index}`} className={index ? 'mt-4 border-t border-surface-800 pt-4' : ''}>
              <View className="flex-row items-start">
                <View className="flex-1 pr-3">
                  <UiText className="text-[17px] font-semibold">{draft.receipt?.merchant ?? draft.counterparty}</UiText>
                  <UiText className="text-[15px] text-muted-foreground">{draft.kind === 'income' ? 'Income' : 'Expense'}{draft.date ? ` · ${formatIso(draft.date)}` : ''}</UiText>
                </View>
                <UiText className="text-[17px] font-semibold" style={{ color: amountColor(draft.kind) }}>{amountSign(draft.kind)}{dollars(draft.amountCents)}</UiText>
              </View>
              <View className="mt-2.5 flex-row flex-wrap gap-2">
                {accountName && <Badge variant="outline"><UiText className="font-medium">{accountName}</UiText></Badge>}
                {categoryName && <Badge variant="outline"><UiText className="font-medium">{categoryName}</UiText></Badge>}
                {draft.receipt && <Badge variant="outline"><UiText className="font-medium">{draft.receipt.items.length} items</UiText></Badge>}
              </View>
              {editingIndex === index && snapshot
                ? <View className="mt-4 border-t border-surface-800 pt-4">
                  <Button variant="outline" size="sm" onPress={() => setEditingIndex(null)} className="mb-4 self-end"><UiText>Close review</UiText></Button>
                  <AnalyzedTransactionEditor snapshot={snapshot} draft={draft} initialAccountId={draft.accountId} onSaved={() => savedReviewedDraft(index, draft)} />
                </View>
                : editingIndex === null && <View className="mt-3 flex-row gap-2">
                  <Button variant="outline" size="sm" onPress={() => setEditingIndex(index)} className="flex-1">
                    <SlidersHorizontal color="#fafafa" size={16} />
                    <UiText>Review</UiText>
                  </Button>
                  <Button variant="outline" size="sm" accessibilityLabel={`Discard ${draft.counterparty}`} onPress={() => removePending(index)} className="w-12 px-0">
                    <X color="#d4d4d4" size={18} />
                  </Button>
                </View>}
            </View>
          })}
          {editingIndex === null && <Button size="lg" disabled={money.busy} onPress={() => void savePending()} className="mt-5">
            <Check color="#0a0a0a" size={20} />
            <UiText>{money.busy ? 'Adding...' : `Add ${pending.length}`}</UiText>
          </Button>}
        </View>
      </Card>}

      {missing && <View className="rounded-3xl border border-attention/30 bg-attention/10 p-5">
        <UiText className="text-[15px] leading-6 text-attention">{missing}</UiText>
        <Button size="sm" onPress={() => router.push(missingRoute)} className="mt-3 self-start"><UiText>Open setup</UiText></Button>
      </View>}
    </ScrollView>

    <View
      className="border-t border-surface-800 bg-background px-4 pt-3"
      style={Platform.OS === 'android' && composerFocused
        ? { position: 'absolute', left: 0, right: 0, bottom: keyboardOverlap, paddingBottom: 12 }
        : { paddingBottom: 12 + Math.max(10, insets.bottom) }}
    >
      {attachment && <View className="mb-3 flex-row items-center rounded-2xl border border-border bg-card p-2.5">
        <Image source={{ uri: attachment.uri }} className="h-12 w-12 rounded-xl" resizeMode="cover" />
        <View className="ml-3 flex-1">
          <UiText className="text-[15px] font-semibold">Receipt attached</UiText>
          <UiText className="text-[14px] text-muted-foreground">Add a note or send it now</UiText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove the receipt" onPress={() => setAttachment(null)} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"><X color="#d4d4d4" size={18} /></Pressable>
      </View>}
      <View className="mb-3 flex-row gap-2">
        <Button variant="secondary" size="sm" accessibilityLabel="Take receipt photo" onPress={() => void camera()} className="flex-1"><Camera color="#fafafa" size={17} /><UiText>Camera</UiText></Button>
        <Button variant="secondary" size="sm" accessibilityLabel="Choose receipt image" onPress={() => void library()} className="flex-1"><ImageIcon color="#fafafa" size={17} /><UiText>Photos</UiText></Button>
        <Button variant="secondary" size="sm" accessibilityLabel="Paste receipt image" onPress={() => void paste()} className="flex-1"><ClipboardPaste color="#fafafa" size={17} /><UiText>Paste</UiText></Button>
      </View>
      <View className="flex-row items-end rounded-3xl border border-input bg-surface-900 p-1.5 pl-2">
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setComposerFocused(true)}
          onBlur={() => setComposerFocused(false)}
          multiline
          maxLength={500}
          editable={!blocked}
          accessibilityLabel="Message to the money agent"
          placeholder="Add $25 at Publix and $12 for gas"
          placeholderTextColor="#737373"
          className="max-h-28 min-h-11 flex-1 px-3 py-2.5 text-[17px] leading-6 text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to money agent"
          disabled={!canSend}
          onPress={() => void send()}
          className={`h-11 w-11 items-center justify-center rounded-full ${canSend ? 'bg-primary active:bg-primary/85' : 'bg-surface-800'}`}
        ><Send color={canSend ? '#0a0a0a' : '#737373'} size={18} /></Pressable>
      </View>
    </View>
  </KeyboardAvoidingView>
}
