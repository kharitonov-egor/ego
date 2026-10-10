import React, { useState } from 'react'
import { Image, Pressable, Text, TextInput, View } from 'react-native'
import { KeyboardScrollView } from '../components/ui/keyboard'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { draftsFromLibrary, type DraftFile } from '../lib/diary/compose'
import { useTasks } from '../lib/tasks/context'

/** A card at the bottom of the Inbox, with photos from the library. */
export default function Capture(): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [drafts, setDrafts] = useState<DraftFile[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickImages = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8
    })
    if (result.canceled) return
    setDrafts((current) => [...current, ...draftsFromLibrary(result.assets)])
  }

  const removeDraft = (key: string): void => {
    setDrafts((current) => current.filter((draft) => draft.key !== key))
  }

  const submit = async (): Promise<void> => {
    if (sending || !title.trim()) return
    setSending(true)
    setError(null)
    const result = await tasks.addInboxCard(title, description, drafts)
    setSending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.back()
  }

  const ready = title.trim() !== '' && tasks.data !== null

  return (
    <View className="flex-1 bg-surface-950">
      <KeyboardScrollView className="flex-1 px-5 pt-5" keyboardShouldPersistTaps="handled">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Card title…"
          placeholderTextColor="#a3a3a3"
          autoFocus
          maxLength={500}
          className="text-[16px] font-medium text-surface-100"
        />

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor="#a3a3a3"
          multiline
          textAlignVertical="top"
          className="mt-3 min-h-[130px] rounded-lg border border-surface-700 bg-surface-900/50 p-3 text-[16px] text-surface-100"
        />

        {drafts.length > 0 && (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {drafts.map((draft) => (
              <Pressable
                key={draft.key}
                accessibilityRole="button"
                accessibilityLabel="Remove this photo"
                onPress={() => removeDraft(draft.key)}
                className="h-16 w-16 overflow-hidden rounded-lg border border-surface-800"
              >
                <Image source={{ uri: draft.uri }} className="h-full w-full" />
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => void pickImages()}
          className="mt-4 rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3 active:bg-surface-800"
        >
          <Text className="text-center text-[16px] font-medium text-surface-200">
            {drafts.length > 0 ? 'Attach another photo' : 'Attach a photo'}
          </Text>
        </Pressable>
        {drafts.length > 0 && (
          <Text className="mt-1.5 text-center text-[14px] text-surface-400">
            Tap a thumbnail to remove it.
          </Text>
        )}

        {error && <Text className="mt-3 text-[14px] text-red-400">{error}</Text>}
      </KeyboardScrollView>

      <View className="border-t border-surface-800 px-5 py-4">
        <Pressable
          accessibilityRole="button"
          onPress={() => void submit()}
          disabled={sending || !ready}
          className={`rounded-2xl px-5 py-4 ${sending || !ready ? 'bg-surface-800' : 'bg-primary active:bg-primary/90'}`}
        >
          <Text
            className={`text-center text-[16px] font-semibold ${sending || !ready ? 'text-surface-400' : 'text-primary-foreground'}`}
          >
            {sending ? 'Adding…' : 'Add to Inbox'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
