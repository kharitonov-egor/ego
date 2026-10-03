import React from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Camera, Keyboard, RotateCcw, TriangleAlert, X } from 'lucide-react-native'
import { formatCalories } from '@ego/core'
import type { FoodDraft } from '../../lib/food/context'
import { color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { SAVE_DELAY_MS, SaveCountdown } from '../ui/countdown'
import { Text } from '../ui/text'
import { FoodPhotoView, FoodThumb, FridgeIcon, macroText } from './ui'

const SECONDS = SAVE_DELAY_MS / 1000
const SHOWN_PARTS = 6
const SHOWN_ITEMS = 8

function readingLabel(draft: FoodDraft): string {
  if (draft.photo) return draft.kind === 'meal' ? 'Reading the photo' : 'Finding the food in the photo'
  if (draft.kind === 'meal' && draft.hint) return 'Working out what that was'
  return 'Looking up the barcode'
}

/**
 * What the camera, a barcode, or a description is about to add. The Food context saves it when the
 * bar runs out, even if this card is off screen by then; Undo throws it away, and tapping it holds
 * the timer while the user edits.
 */
export function DraftCard({ draft, onUndo, onEdit, onRetry, onLabelPhoto, onTypeName }: {
  draft: FoodDraft
  onUndo: () => void
  onEdit: () => void
  onRetry: () => void
  onLabelPhoto: () => void
  onTypeName: () => void
}): React.ReactElement {
  if (draft.state === 'reading') {
    return <Card className="mb-3 flex-row items-center p-4">
      {draft.photo && <FoodPhotoView photo={null} uri={draft.photo.previewUri} style={{ width: 52, height: 52, borderRadius: 12 }} />}
      <ActivityIndicator color={color.text} style={{ marginLeft: draft.photo ? 14 : 0 }} />
      <Text accessibilityLiveRegion="polite" className="ml-3 flex-1 text-[15px] text-muted-foreground">{readingLabel(draft)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onUndo} hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800">
        <X color={color.textSecondary} size={20} />
      </Pressable>
    </Card>
  }

  if (draft.state === 'failed') {
    const retryable = draft.unknownBarcode === null && (draft.photo !== null || (draft.kind === 'meal' && draft.hint !== ''))
    return <Card className="mb-3 p-4">
      <View className="flex-row items-start">
        <TriangleAlert color={color.attention} size={18} style={{ marginTop: 2 }} />
        <Text className="ml-2.5 flex-1 text-[15px] leading-6">{draft.message}</Text>
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2">
        {retryable && <Button variant="secondary" size="sm" onPress={onRetry}><RotateCcw color={color.text} size={16} /><Text>Try again</Text></Button>}
        {draft.unknownBarcode !== null && draft.kind === 'meal' && <Button variant="secondary" size="sm" onPress={onLabelPhoto}>
          <Camera color={color.text} size={16} /><Text>Photo of the label</Text>
        </Button>}
        {draft.unknownBarcode !== null && draft.kind === 'fridge' && <Button variant="secondary" size="sm" onPress={onTypeName}>
          <Keyboard color={color.text} size={16} /><Text>Type the name</Text>
        </Button>}
        <Button variant="ghost" size="sm" onPress={onUndo}><Text>Dismiss</Text></Button>
      </View>
    </Card>
  }

  const countdown = <SaveCountdown
    runKey={draft.key}
    paused={draft.paused}
    label={`Saves in ${SECONDS} seconds. Tap to edit.`}
    onUndo={onUndo}
  />

  if (draft.kind === 'meal' && draft.entry) {
    const entry = draft.entry
    const parts = entry.parts.length > 1 ? entry.parts : []
    return <Card className="mb-3 overflow-hidden">
      <View className="border-b border-surface-800 px-4 py-3">{countdown}</View>
      <Pressable accessibilityRole="button" accessibilityHint="Holds the timer and opens the editor" onPress={onEdit} className="p-4 active:bg-surface-900">
        <View className="flex-row">
          {draft.photo
            ? <FoodPhotoView photo={null} uri={draft.photo.previewUri} style={{ width: 64, height: 64, borderRadius: 14 }} />
            : <FoodThumb entry={entry} size={64} />}
          <View className="ml-3 flex-1">
            <Text numberOfLines={2} className="text-[17px] font-semibold">{entry.name}</Text>
            {entry.serving !== '' && <Text numberOfLines={1} className="mt-0.5 text-[14px] text-muted-foreground">{entry.serving}</Text>}
            <Text className="mt-1 text-[15px]" style={tabular}>
              <Text className="font-semibold">{formatCalories(entry.calories)} kcal</Text>
              <Text className="text-muted-foreground">{`  ${macroText(entry)}`}</Text>
            </Text>
          </View>
        </View>
        {parts.length > 0 && <View className="mt-3 gap-1">
          {parts.slice(0, SHOWN_PARTS).map((part, index) => <View key={`${index}-${part.name}`} className="flex-row">
            <Text numberOfLines={1} className="flex-1 text-[14px] text-surface-300">{part.name}</Text>
            <Text className="text-[14px] text-surface-400" style={tabular}>{formatCalories(part.calories)} kcal</Text>
          </View>)}
          {parts.length > SHOWN_PARTS && <Text className="text-[13px] text-surface-500">and {parts.length - SHOWN_PARTS} more</Text>}
        </View>}
        {entry.note !== '' && <Text className="mt-2 text-[13px] leading-5 text-surface-400">{entry.note}</Text>}
      </Pressable>
    </Card>
  }

  if (draft.kind === 'fridge') {
    return <Card className="mb-3 overflow-hidden">
      <View className="border-b border-surface-800 px-4 py-3">{countdown}</View>
      <Pressable accessibilityRole="button" accessibilityHint="Holds the timer so you can drop items" onPress={onEdit} className="p-4 active:bg-surface-900">
        <Text className="text-[17px] font-semibold">
          {draft.items.length === 1 ? 'Add 1 item to the fridge' : `Add ${draft.items.length} items to the fridge`}
        </Text>
        <View className="mt-2 gap-2">
          {draft.items.slice(0, SHOWN_ITEMS).map((item, index) => <View key={`${index}-${item.name}`} className="flex-row items-center">
            <FridgeIcon icon={item.icon} size={32} />
            <Text numberOfLines={1} className="ml-2.5 flex-1 text-[15px]">{item.name}{item.brand ? <Text className="text-muted-foreground">{`  ${item.brand}`}</Text> : null}</Text>
          </View>)}
          {draft.items.length > SHOWN_ITEMS && <Text className="text-[13px] text-surface-500">and {draft.items.length - SHOWN_ITEMS} more</Text>}
        </View>
      </Pressable>
    </Card>
  }

  return <Card className="mb-3 p-4"><Text className="text-[15px] text-muted-foreground">Nothing to save.</Text></Card>
}
