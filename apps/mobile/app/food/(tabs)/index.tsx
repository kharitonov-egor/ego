import React, { memo, useMemo, useState } from 'react'
import { Pressable, SectionList, View } from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera, Plus, Target } from 'lucide-react-native'
import type { FoodEntryRecord } from '@ego/api-contracts'
import { NO_FOOD_GOAL, NO_MACROS, formatCalories, type FoodDay } from '@ego/core'
import { DraftCard } from '../../../components/food/DraftCard'
import { AddSheet, DescribeSheet, TargetsSheet, type AddChoice } from '../../../components/food/sheets'
import { FoodError, FoodGate, FoodHeaderRight, FoodThumb, TodayCard, macroText } from '../../../components/food/ui'
import { HeaderIcon } from '../../../components/gym/ui'
import { color, tabular } from '../../../components/money/tokens'
import { Checkbox } from '../../../components/ui/checkbox'
import { Text } from '../../../components/ui/text'
import { Blurred } from '../../../lib/blur'
import { useFood } from '../../../lib/food/context'
import { dayTitle, timeLabel } from '@ego/local/food/drafts'
import { chooseFoodPhoto, takeFoodPhoto } from '../../../lib/food/photo'

type Section = FoodDay<FoodEntryRecord> & { data: FoodEntryRecord[] }

const EntryRow = memo(function EntryRow({ entry, pictures, stuck, first, last, onPress }: {
  entry: FoodEntryRecord
  pictures: boolean
  /** The photo was refused and the entry waits on this phone. */
  stuck: boolean
  first: boolean
  last: boolean
  onPress: (entry: FoodEntryRecord) => void
}): React.ReactElement {
  const edges = `${first ? 'rounded-t-3xl border-t' : ''} ${last ? 'rounded-b-3xl' : ''}`
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${entry.name}, ${formatCalories(entry.calories)} calories, ${timeLabel(entry.eatenAt)}`}
    onPress={() => onPress(entry)}
    className={`mx-4 flex-row items-center border-x border-b border-border bg-card px-4 py-3 active:bg-surface-900 ${edges}`}
  >
    {pictures && <View className="mr-3"><FoodThumb entry={entry} size={56} /></View>}
    <View className="flex-1">
      <Blurred><Text numberOfLines={2} className="text-[16px] font-semibold">{entry.name}</Text></Blurred>
      <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
        {timeLabel(entry.eatenAt)}{entry.serving ? ` · ${entry.serving}` : ''}
      </Text>
      {stuck && <Text className="mt-0.5 text-[13px] text-attention">Photo did not upload. Tap to try again.</Text>}
    </View>
    <View className="ml-3 items-end">
      <Text className="text-[16px] font-semibold" style={tabular}>{formatCalories(entry.calories)}</Text>
      <Text className="mt-0.5 text-[12px] text-muted-foreground" style={tabular}>{macroText(entry)}</Text>
    </View>
  </Pressable>
})

function DayHeader({ section, today }: { section: Section; today: string }): React.ReactElement {
  return <View className="flex-row items-end justify-between bg-background px-5 pb-2 pt-6">
    <Text accessibilityRole="header" className="text-[15px] font-bold">{dayTitle(section.date, today)}</Text>
    <Text className="text-[13px] text-muted-foreground" style={tabular}>{formatCalories(section.totals.calories)} kcal</Text>
  </View>
}

export default function FoodLog(): React.ReactElement {
  return <FoodGate><Log /></FoodGate>
}

function Log(): React.ReactElement {
  const food = useFood()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const [adding, setAdding] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [targets, setTargets] = useState(false)
  const goal = food.data?.goal ?? NO_FOOD_GOAL
  const sections = useMemo<Section[]>(() => food.days.map((day) => ({ ...day, data: day.entries })), [food.days])
  const todayTotals = food.days.find((day) => day.date === food.today)?.totals ?? NO_MACROS
  const draft = food.draft?.kind === 'meal' ? food.draft : null

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <FoodHeaderRight>
        <HeaderIcon label="Daily targets" onPress={() => setTargets(true)}><Target color={color.textSecondary} size={21} /></HeaderIcon>
        <HeaderIcon label="Log food" onPress={() => setAdding(true)}><Plus color={color.text} size={23} /></HeaderIcon>
      </FoodHeaderRight>
    })
  }, [navigation])

  const pick = (choice: AddChoice): void => {
    setAdding(false)
    if (choice === 'camera') void food.logPhoto(takeFoodPhoto)
    else if (choice === 'library') void food.logPhoto(chooseFoodPhoto)
    else if (choice === 'barcode') router.push({ pathname: '/food/scan', params: { mode: 'log' } })
    else setDescribing(true)
  }

  const header = <View className="px-4 pt-4">
    <FoodError />
    <TodayCard totals={todayTotals} goal={goal} onPress={() => setTargets(true)} />
    <View className="mt-3">
      {draft && <DraftCard
        draft={draft}
          onUndo={food.undoDraft}
        onEdit={() => {
          food.pauseDraft(true)
          router.push({ pathname: '/food/entry/[id]', params: { id: 'draft' } })
        }}
        onRetry={() => void food.retryDraft()}
        onLabelPhoto={() => void food.logPhoto(takeFoodPhoto, 'This is the nutrition label of a packaged food. Log one serving.')}
        onTypeName={() => setDescribing(true)}
      />}
    </View>
    <View className="flex-row items-center justify-between px-1">
      <Checkbox checked={food.picturesOn} onCheckedChange={food.setPicturesOn} label={food.picturesOn ? 'Pictures on' : 'Pictures off'} />
      {sections.length > 0 && <Text className="text-[13px] text-surface-500">Newest first</Text>}
    </View>
  </View>

  return <View className="flex-1 bg-background">
    <SectionList
      sections={sections}
      keyExtractor={(entry) => entry.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <DayHeader section={section} today={food.today} />}
      renderItem={({ item, index, section }) => <EntryRow
        entry={item}
        pictures={food.picturesOn}
        stuck={food.failedUploads.has(item.id)}
        first={index === 0}
        last={index === section.data.length - 1}
        onPress={(entry) => router.push({ pathname: '/food/entry/[id]', params: { id: entry.id } })}
      />}
      ListEmptyComponent={draft ? null : <View className="items-center px-8 py-12">
        <Text className="text-center text-[18px] font-semibold text-surface-100">Nothing logged yet</Text>
        <Text className="mt-2 text-center text-[15px] leading-6 text-surface-400">
          Take a photo of a meal or a nutrition label, scan a barcode, or describe what you ate. The AI tile logs food too.
        </Text>
      </View>}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      initialNumToRender={20}
      windowSize={9}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Take a photo of food"
      onPress={() => void food.logPhoto(takeFoodPhoto)}
      style={{ position: 'absolute', right: 20, bottom: 20, elevation: 6 }}
      className="h-16 w-16 items-center justify-center rounded-full bg-primary active:bg-primary/85"
    ><Camera color={color.screen} size={26} /></Pressable>
    <AddSheet visible={adding} mode="log" onPick={pick} onClose={() => setAdding(false)} />
    <DescribeSheet visible={describing} onClose={() => setDescribing(false)} onSend={(text) => {
      setDescribing(false)
      void food.logText(text)
    }} />
    <TargetsSheet visible={targets} goal={goal} onClose={() => setTargets(false)} onSave={(next) => {
      setTargets(false)
      void food.saveGoal(next)
    }} />
  </View>
}
