import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TextInput, View, useWindowDimensions } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RotateCcw, Trash2, TriangleAlert } from 'lucide-react-native'
import { formatCalories, type FoodEntryInput } from '@ego/core'
import { FoodMessage, FoodPhotoView, macroText } from '../../../components/food/ui'
import { ConfirmDialog, Label, inputClass } from '../../../components/money/Common'
import { DateField } from '../../../components/money/DatePicker'
import { color, tabular } from '../../../components/money/tokens'
import { Button } from '../../../components/ui/button'
import { KeyboardScrollView } from '../../../components/ui/keyboard'
import { SegmentedControl } from '../../../components/ui/segmented-control'
import { Text } from '../../../components/ui/text'
import { useFood } from '../../../lib/food/context'
import { clockOf, entryAt } from '@ego/local/food/drafts'

type Meridiem = 'am' | 'pm'

interface Clock {
  hour: string
  minute: string
  meridiem: Meridiem
}

const MERIDIEMS = [{ value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }] as const

function clockFrom(time: string): Clock {
  const [hours, minutes] = time.split(':').map(Number)
  return { hour: String(hours % 12 === 0 ? 12 : hours % 12), minute: String(minutes).padStart(2, '0'), meridiem: hours < 12 ? 'am' : 'pm' }
}

function timeFrom(clock: Clock): string | null {
  const hour = Number(clock.hour)
  const minute = Number(clock.minute)
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const hours = (hour % 12) + (clock.meridiem === 'pm' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function numberText(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function NumberInput({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (text: string) => void }): React.ReactElement {
  return <View className="flex-1">
    <Text className="mb-1.5 text-[14px] font-medium text-surface-200">{label}</Text>
    <View className="flex-row items-center">
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9.]/g, ''))}
        accessibilityLabel={`${label} in ${unit}`}
        keyboardType="decimal-pad"
        maxLength={7}
        selectTextOnFocus
        className={`${inputClass} flex-1 px-3`}
        style={tabular}
      />
    </View>
    <Text className="mt-1 text-[12px] text-muted-foreground">{unit}</Text>
  </View>
}

export default function FoodEntryScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const food = useFood()
  const router = useRouter()
  const isDraft = id === 'draft'
  const draft = isDraft && food.draft?.kind === 'meal' && food.draft.state === 'ready' ? food.draft : null
  const record = isDraft ? null : food.data?.entries.find((entry) => entry.id === id) ?? null
  const source = draft?.entry ?? record
  if (!source) {
    return <>
      <Stack.Screen options={{ title: '' }} />
      <FoodMessage title={isDraft ? 'That food already saved' : 'That entry is gone'} detail="It may have been deleted on another device." action="Back" onAction={() => router.back()} />
    </>
  }
  return <Editor key={record?.id ?? 'draft'} initial={source} />
}

function Editor({ initial }: { initial: FoodEntryInput & { id?: string } }): React.ReactElement {
  const food = useFood()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const record = initial.id ? food.data?.entries.find((entry) => entry.id === initial.id) ?? null : null
  const isDraft = record === null
  const [name, setName] = useState(initial.name)
  const [serving, setServing] = useState(initial.serving)
  const [date, setDate] = useState(initial.date)
  const [clock, setClock] = useState(() => clockFrom(clockOf(initial.eatenAt)))
  const [calories, setCalories] = useState(numberText(initial.calories))
  const [protein, setProtein] = useState(numberText(initial.protein))
  const [carbs, setCarbs] = useState(numberText(initial.carbs))
  const [fat, setFat] = useState(numberText(initial.fat))
  const [note, setNote] = useState(initial.note)
  const [deleting, setDeleting] = useState(false)
  const saved = useRef(false)
  const { pauseDraft } = food

  useEffect(() => () => {
    if (isDraft && !saved.current) pauseDraft(false)
  }, [isDraft, pauseDraft])

  const time = timeFrom(clock)
  const edited = useMemo<FoodEntryInput | null>(() => {
    if (time === null) return null
    const amounts = [calories, protein, carbs, fat].map(Number)
    if (amounts.some((value) => !Number.isFinite(value))) return null
    const [kcal, grams, carb, fats] = amounts
    return entryAt({ ...initial, name, serving, note, calories: kcal, protein: grams, carbs: carb, fat: fats }, date, time)
  }, [calories, carbs, date, fat, initial, name, note, protein, serving, time])

  const save = async (): Promise<void> => {
    if (!edited) return
    if (isDraft) {
      saved.current = true
      food.editDraftEntry(edited)
      router.back()
      await food.saveDraft()
      return
    }
    if (record && await food.saveEntry(record, edited)) router.back()
  }

  const photoHeight = Math.round((width - 32) * 0.66)

  return <View className="flex-1 bg-background">
    <Stack.Screen options={{ title: isDraft ? 'New food' : 'Food' }} />
    <KeyboardScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
      {record && food.failedUploads.has(record.id) && <View className="mb-4 rounded-2xl bg-attention/10 p-4">
        <View className="flex-row items-start">
          <TriangleAlert color={color.attention} size={18} style={{ marginTop: 2 }} />
          <Text className="ml-2.5 flex-1 text-[15px] leading-6 text-attention">The photo did not upload, so this entry is only on this phone.</Text>
        </View>
        <Button variant="secondary" size="sm" className="mt-3 self-start" onPress={() => void food.retryUpload(record.id)}>
          <RotateCcw color={color.text} size={16} /><Text>Try again</Text>
        </Button>
      </View>}
      {initial.photo && <View className="mb-5 overflow-hidden rounded-3xl">
        <FoodPhotoView photo={initial.photo} uri={isDraft && food.draft?.photo ? food.draft.photo.uri : null} size="large" style={{ width: '100%', height: photoHeight }} />
      </View>}
      <Label text="Name">
        <TextInput value={name} onChangeText={setName} maxLength={120} accessibilityLabel="Name" placeholder="What it was" placeholderTextColor="#737373" className={inputClass} />
      </Label>
      <Label text="Day">
        <DateField value={date} onChange={setDate} label="Day" />
      </Label>
      <Text className="mb-2 text-[15px] font-medium text-surface-200">Time</Text>
      <View className="mb-5 flex-row items-center gap-2">
        <TextInput
          value={clock.hour}
          onChangeText={(hour) => setClock({ ...clock, hour: hour.replace(/\D/g, '') })}
          accessibilityLabel="Hour"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <Text className="text-[20px] font-bold">:</Text>
        <TextInput
          value={clock.minute}
          onChangeText={(minute) => setClock({ ...clock, minute: minute.replace(/\D/g, '') })}
          accessibilityLabel="Minute"
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          className={`${inputClass} w-16 text-center`}
        />
        <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
      </View>
      {time === null && <Text className="-mt-3 mb-4 text-[14px] text-destructive">Enter a time like 12:30.</Text>}
      <Label text="Serving">
        <TextInput value={serving} onChangeText={setServing} maxLength={80} accessibilityLabel="Serving" placeholder="1 bowl" placeholderTextColor="#737373" className={inputClass} />
      </Label>
      <View className="mb-5 flex-row gap-2">
        <NumberInput label="Calories" unit="kcal" value={calories} onChange={setCalories} />
        <NumberInput label="Protein" unit="g" value={protein} onChange={setProtein} />
        <NumberInput label="Carbs" unit="g" value={carbs} onChange={setCarbs} />
        <NumberInput label="Fat" unit="g" value={fat} onChange={setFat} />
      </View>
      {initial.parts.length > 1 && <View className="mb-5 rounded-2xl border border-border bg-card px-4 py-3">
        <Text className="mb-1 text-[14px] font-medium text-muted-foreground">What the estimate counted</Text>
        {initial.parts.map((part, index) => <View key={`${index}-${part.name}`} className="flex-row py-1">
          <Text className="flex-1 text-[15px]">{part.name}</Text>
          <Text className="text-[14px] text-muted-foreground" style={tabular}>{formatCalories(part.calories)} kcal · {macroText(part)}</Text>
        </View>)}
      </View>}
      <Label text="Note">
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={1000}
          multiline
          accessibilityLabel="Note"
          placeholder="Anything worth remembering"
          placeholderTextColor="#737373"
          className={`${inputClass} min-h-20`}
          style={{ textAlignVertical: 'top' }}
        />
      </Label>
      {initial.barcode && <Text className="mb-4 text-[13px] text-surface-500">Barcode {initial.barcode}</Text>}
      <Button size="lg" disabled={edited === null || name.trim() === ''} onPress={() => void save()}><Text>Save</Text></Button>
      {record && <Button variant="ghost" size="lg" className="mt-3" onPress={() => setDeleting(true)}>
        <Trash2 color={color.destructive} size={18} />
        <Text className="text-destructive">Delete</Text>
      </Button>}
    </KeyboardScrollView>
    <ConfirmDialog
      visible={deleting}
      title="Delete this food?"
      detail="It comes off the log on every device."
      confirmLabel="Delete" destructive hideNavigation={false}
      onCancel={() => setDeleting(false)}
      onConfirm={() => {
        setDeleting(false)
        if (record) void food.removeEntry(record).then((done) => { if (done) router.back() })
      }}
    />
  </View>
}
