import React, { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { Camera, ClipboardPaste, Image as ImageIcon, RotateCcw, ScanLine } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { splitImageDataUrl, type AnalyzedTransactionDraft } from '@ego/core'
import AnalyzedTransactionEditor from '../components/money/AnalyzedTransactionEditor'
import { useMoney } from '../lib/money-context'
import { analyzeImage } from '../lib/openrouter'
import { useSettings } from '../lib/settings'

export default function TransactionImage(): React.ReactElement {
  const router = useRouter()
  const money = useMoney()
  const { settings } = useSettings()
  const [draft, setDraft] = useState<AnalyzedTransactionDraft | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openAccounts = money.snapshot?.accounts.filter((item) => !item.archivedAt) ?? []
  const openCategories = money.snapshot?.categories.filter((item) => !item.archivedAt) ?? []
  const missing = !money.snapshot
    ? 'Connect Cloudflare D1 in Settings before analyzing an image.'
    : openAccounts.length === 0
      ? 'Add an account before saving an analyzed transaction.'
      : openCategories.length === 0
        ? 'Add an active income or expense category first.'
        : null
  const missingRoute = !money.snapshot ? '/settings' : openAccounts.length === 0 ? '/(money)/accounts' : '/(money)/categories'

  const process = async (base64: string, mimeType: string): Promise<void> => {
    if (!money.snapshot) return
    setAnalyzing(true)
    setError(null)
    const result = await analyzeImage({
      base64, mimeType, apiKey: settings.openRouterApiKey, model: settings.receiptModel,
      categories: money.snapshot.categories.filter((item) => !item.archivedAt).map(({ id, name, kind }) => ({ id, name, kind }))
    })
    setAnalyzing(false)
    if (result.ok) setDraft(result.data)
    else setError(result.message)
  }

  const processAsset = async (asset: ImagePicker.ImagePickerAsset): Promise<void> => {
    if (!asset.base64) { setError('The phone could not read this image. Choose it again.'); return }
    await process(asset.base64, asset.mimeType ?? 'image/jpeg')
  }
  const camera = async (): Promise<void> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) { setError('Camera access is off. Allow it in system settings to take a photo.'); return }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, base64: true })
    if (!result.canceled) await processAsset(result.assets[0])
  }
  const library = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) { setError('Photo access is off. Allow it in system settings to choose an image.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true })
    if (!result.canceled) await processAsset(result.assets[0])
  }
  const paste = async (): Promise<void> => {
    const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.85 })
    if (!image) { setError('The clipboard has no image, or paste access was denied.'); return }
    const parsed = splitImageDataUrl(image.data)
    if (!parsed) { setError('The clipboard image could not be read. Copy it again and retry.'); return }
    await process(parsed.base64, parsed.mimeType)
  }

  if (draft && money.snapshot) return <ScrollView className="flex-1 bg-surface-950 px-5 pt-4" keyboardShouldPersistTaps="handled"><View className="mb-5 flex-row items-start justify-between"><View className="flex-1 pr-3"><Text className="text-lg font-semibold text-surface-100">Check the transaction</Text><Text className="mt-1 text-xs text-surface-500">Correct anything the model misread before saving.</Text></View><Pressable onPress={() => { setDraft(null); setError(null) }} className="flex-row items-center rounded-xl border border-surface-800 px-3 py-2"><RotateCcw color="#8a93ab" size={14} /><Text className="ml-1.5 text-xs text-surface-400">Try another</Text></Pressable></View><AnalyzedTransactionEditor snapshot={money.snapshot} draft={draft} onSaved={(target) => router.replace(target === 'purchases' ? '/(money)/purchases' : '/(money)/transactions')} /><View className="h-12" /></ScrollView>

  return <View className="flex-1 items-center justify-center bg-surface-950 px-6">
    <View className="h-16 w-16 items-center justify-center rounded-2xl bg-accent-500/15"><ScanLine color="#60a5fa" size={30} /></View>
    <Text className="mt-5 text-xl font-semibold text-surface-100">Analyze a transaction</Text>
    <Text className="mt-2 text-center text-sm leading-5 text-surface-500">Use one check, receipt, invoice, card slip, or screenshot. Ego sends the image to OpenRouter once and does not save it.</Text>
    {analyzing ? <View className="mt-8 items-center"><ActivityIndicator color="#60a5fa" /><Text className="mt-3 text-sm text-surface-400">Reading image...</Text></View> : missing ? <View className="mt-8 w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><Text className="text-sm text-amber-300">{missing}</Text><Pressable onPress={() => router.replace(missingRoute)} className="mt-3 self-start rounded-xl bg-accent-600 px-4 py-2.5"><Text className="text-sm font-semibold text-white">Fix it</Text></Pressable></View> : <View className="mt-8 w-full gap-3"><Pressable onPress={() => void camera()} className="flex-row items-center justify-center rounded-2xl bg-accent-600 px-5 py-4"><Camera color="#fff" size={19} /><Text className="ml-2 font-semibold text-white">Take photo</Text></Pressable><Pressable onPress={() => void library()} className="flex-row items-center justify-center rounded-2xl border border-surface-800 bg-surface-900 px-5 py-4"><ImageIcon color="#8a93ab" size={19} /><Text className="ml-2 font-medium text-surface-300">Choose from photos</Text></Pressable><Pressable onPress={() => void paste()} className="flex-row items-center justify-center rounded-2xl border border-surface-800 bg-surface-900 px-5 py-4"><ClipboardPaste color="#8a93ab" size={19} /><Text className="ml-2 font-medium text-surface-300">Paste image</Text></Pressable></View>}
    {error && <Text className="mt-5 text-center text-sm text-red-400">{error}</Text>}
  </View>
}
