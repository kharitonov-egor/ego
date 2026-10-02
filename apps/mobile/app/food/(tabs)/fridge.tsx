import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CircleCheck, Plus } from 'lucide-react-native'
import type { FridgeItemRecord } from '@ego/api-contracts'
import { DraftCard } from '../../../components/food/DraftCard'
import { AddSheet, FridgeDraftSheet, type AddChoice } from '../../../components/food/sheets'
import { FoodError, FoodGate, FoodHeaderRight, FridgeIcon } from '../../../components/food/ui'
import { HeaderIcon } from '../../../components/gym/ui'
import { color } from '../../../components/money/tokens'
import { TextSheet } from '../../../components/tasks/sheets'
import { SaveCountdown } from '../../../components/ui/countdown'
import { Text } from '../../../components/ui/text'
import { Blurred } from '../../../lib/blur'
import { useFood } from '../../../lib/food/context'
import { addedLabel } from '../../../lib/food/drafts'
import { chooseFoodPhoto, takeFoodPhoto } from '../../../lib/food/photo'
import { newId } from '@ego/local/sync/commands'

const SOURCE_LABELS: Record<FridgeItemRecord['source'], string | null> = {
  receipt: 'from a receipt', barcode: 'scanned', photo: 'from a photo', assistant: 'from the AI', manual: null
}

const ItemRow = memo(function ItemRow({ item, today, onUsedUp }: {
  item: FridgeItemRecord
  today: string
  onUsedUp: (item: FridgeItemRecord) => void
}): React.ReactElement {
  const source = SOURCE_LABELS[item.source]
  return <View className="mx-4 mb-2 min-h-16 flex-row items-center rounded-2xl border border-border bg-card py-2 pl-3 pr-1">
    <FridgeIcon icon={item.icon} />
    <View className="ml-3 flex-1">
      <Blurred><Text numberOfLines={1} className="text-[16px] font-semibold">{item.name}</Text></Blurred>
      <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
        {[item.brand, addedLabel(item.addedAt, today), source].filter(Boolean).join(' · ')}
      </Text>
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name} is used up`}
      accessibilityHint="Takes it out of the fridge"
      onPress={() => onUsedUp(item)}
      hitSlop={4}
      className="h-12 w-12 items-center justify-center rounded-full active:bg-surface-800"
    ><CircleCheck color={color.textMuted} size={22} /></Pressable>
  </View>
})

interface Leaving {
  key: string
  items: FridgeItemRecord[]
}

export default function Fridge(): React.ReactElement {
  return <FoodGate><FridgeList /></FoodGate>
}

function FridgeList(): React.ReactElement {
  const food = useFood()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const [adding, setAdding] = useState(false)
  const [naming, setNaming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [leaving, setLeavingState] = useState<Leaving | null>(null)
  const leavingRef = useRef<Leaving | null>(null)
  const { removeFridgeItems } = food
  const draft = food.draft?.kind === 'fridge' ? food.draft : null

  const setLeaving = useCallback((next: Leaving | null): void => {
    leavingRef.current = next
    setLeavingState(next)
  }, [])

  const remove = useRef(removeFridgeItems)
  remove.current = removeFridgeItems
  // Items taken out and not put back before the screen closes are gone, like any card that runs out.
  useEffect(() => () => {
    const pending = leavingRef.current
    if (pending) void remove.current(pending.items)
  }, [])

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <FoodHeaderRight>
        <HeaderIcon label="Add to the fridge" onPress={() => setAdding(true)}><Plus color={color.text} size={23} /></HeaderIcon>
      </FoodHeaderRight>
    })
  }, [navigation])

  const usedUp = useCallback((item: FridgeItemRecord): void => {
    const current = leavingRef.current
    setLeaving({ key: newId(), items: [...(current?.items ?? []), item] })
  }, [setLeaving])

  const pick = (choice: AddChoice): void => {
    setAdding(false)
    if (choice === 'camera') void food.stockPhoto(takeFoodPhoto)
    else if (choice === 'library') void food.stockPhoto(chooseFoodPhoto)
    else if (choice === 'barcode') router.push({ pathname: '/food/scan', params: { mode: 'fridge' } })
    else setNaming(true)
  }

  const hidden = new Set(leaving?.items.map((item) => item.id) ?? [])
  const items = (food.data?.fridge ?? []).filter((item) => !hidden.has(item.id))

  const header = <View className="px-4 pt-4">
    <FoodError />
    {draft && <DraftCard
      draft={draft}
      onUndo={food.undoDraft}
      onEdit={() => {
        food.pauseDraft(true)
        setEditing(true)
      }}
      onRetry={() => void food.retryDraft()}
      onLabelPhoto={() => undefined}
      onTypeName={() => setNaming(true)}
    />}
    {items.length > 0 && <Text className="mb-2 px-1 text-[13px] text-surface-500">
      {items.length === 1 ? '1 item' : `${items.length} items`}, newest first
    </Text>}
  </View>

  return <View className="flex-1 bg-background">
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => <ItemRow item={item} today={food.today} onUsedUp={usedUp} />}
      ListEmptyComponent={draft ? null : <View className="items-center px-8 py-12">
        <Text className="text-center text-[18px] font-semibold text-surface-100">The fridge is empty</Text>
        <Text className="mt-2 text-center text-[15px] leading-6 text-surface-400">
          Scan a barcode, take a photo of your groceries, or type a name. Grocery receipts you send to the AI tile land here too.
        </Text>
      </View>}
      contentContainerStyle={{ paddingBottom: insets.bottom + (leaving ? 140 : 40) }}
    />
    {leaving && <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }} className="rounded-3xl border border-surface-700 bg-surface-900 px-4 py-3">
      <Text numberOfLines={1} className="mb-1 text-[15px] font-semibold">
        {leaving.items.length === 1 ? `Took out ${leaving.items[0].name}` : `Took out ${leaving.items.length} items`}
      </Text>
      <SaveCountdown
        runKey={leaving.key}
        paused={false}
        label="Off the list in 3 seconds"
        onElapsed={() => {
          const done = leavingRef.current
          setLeaving(null)
          if (done) void removeFridgeItems(done.items)
        }}
        onUndo={() => setLeaving(null)}
      />
    </View>}
    <AddSheet visible={adding} mode="fridge" onPick={pick} onClose={() => setAdding(false)} />
    <TextSheet
      visible={naming}
      title="Add to the fridge"
      value=""
      placeholder="Greek yogurt"
      confirm="Add"
      onClose={() => setNaming(false)}
      onSave={(name) => {
        setNaming(false)
        void food.stockByName(name)
      }}
    />
    <FridgeDraftSheet
      visible={editing && draft !== null}
      items={draft?.items ?? []}
      onChange={food.editDraftItems}
      onSave={() => {
        setEditing(false)
        void food.saveDraft()
      }}
      onClose={() => {
        setEditing(false)
        food.pauseDraft(false)
      }}
    />
  </View>
}
