import React, { useMemo, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { captureToTrello, type CardAttachment } from '@ego/core'
import { useSettings } from '../lib/settings'
import { trelloClientFor } from '../lib/trello'

interface PickedImage {
  uri: string
  name: string
  mimeType: string
}

export default function Capture(): React.ReactElement {
  const { settings } = useSettings()
  const router = useRouter()
  const client = useMemo(() => trelloClientFor(settings), [settings])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<PickedImage[]>([])
  const [activeListId, setActiveListId] = useState(settings.trelloListId)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)

  const pickImages = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8
    })
    if (result.canceled) return
    setImages((current) => [
      ...current,
      ...result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${current.length + index + 1}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg'
      }))
    ])
  }

  const removeImage = (uri: string): void => {
    setImages((current) => current.filter((image) => image.uri !== uri))
  }

  const submit = async (): Promise<void> => {
    if (sending) return
    setSending(true)
    setStatus({ text: 'Sending…', error: false })

    const attachments: CardAttachment[] = images.map((image) => ({
      kind: 'uri',
      uri: image.uri,
      name: image.name,
      mimeType: image.mimeType
    }))

    const result = await captureToTrello(client, {
      title,
      description,
      listId: activeListId || settings.trelloListId,
      attachments
    })

    setSending(false)
    if (result.ok) {
      setTitle('')
      setDescription('')
      setImages([])
      router.back()
      return
    }
    setStatus({ text: result.detail ?? 'Failed to send', error: true })
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-950"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView className="flex-1 px-5 pt-5" keyboardShouldPersistTaps="handled">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Card title…"
          placeholderTextColor="#707078"
          autoFocus
          className="text-lg font-medium text-surface-100"
        />

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor="#707078"
          multiline
          textAlignVertical="top"
          className="mt-4 min-h-[160px] rounded-xl border border-surface-700 bg-surface-900/50 p-4 text-lg text-surface-100"
        />

        {images.length > 0 && (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {images.map((image) => (
              <Pressable
                key={image.uri}
                onPress={() => removeImage(image.uri)}
                className="h-16 w-16 overflow-hidden rounded-lg border border-surface-800"
              >
                <Image source={{ uri: image.uri }} className="h-full w-full" />
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => void pickImages()}
          className="mt-4 rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3 active:bg-surface-800"
        >
          <Text className="text-center text-lg font-medium text-surface-200">
            {images.length > 0 ? 'Attach another photo' : 'Attach a photo'}
          </Text>
        </Pressable>
        {images.length > 0 && (
          <Text className="mt-2 text-center text-base text-surface-400">
            Tap a thumbnail to remove it.
          </Text>
        )}

        {settings.listShortcuts.length > 0 && (
          <View className="mt-5">
            <Text className="mb-2 text-base font-semibold text-surface-300">Send to</Text>
            <View className="flex-row flex-wrap gap-2">
              {settings.listShortcuts.map((shortcut) => {
                const active = shortcut.listId === activeListId
                return (
                  <Pressable
                    key={shortcut.listId}
                    onPress={() => setActiveListId(shortcut.listId)}
                    className={`rounded-lg border px-3 py-1.5 ${
                      active
                        ? 'border-accent-500/40 bg-accent-500/15'
                        : 'border-surface-800 bg-surface-900/50'
                    }`}
                  >
                    <Text
                      className={`text-base font-medium ${active ? 'text-accent-400' : 'text-surface-300'}`}
                    >
                      {shortcut.listName}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )}

        {status && (
          <Text
            className={`mt-4 text-base ${status.error ? 'text-red-400' : 'text-surface-300'}`}
          >
            {status.text}
          </Text>
        )}
      </ScrollView>

      <View className="border-t border-surface-800 px-5 py-4">
        <Pressable
          onPress={() => void submit()}
          disabled={sending}
          className={`rounded-2xl px-5 py-4 ${sending ? 'bg-surface-800' : 'bg-accent-600 active:bg-accent-500'}`}
        >
          <Text
            className={`text-center text-base font-semibold ${sending ? 'text-surface-500' : 'text-white'}`}
          >
            {sending ? 'Sending…' : 'Add card'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
