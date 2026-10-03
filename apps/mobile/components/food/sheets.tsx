import React, { useEffect, useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Camera, Image as ImageIcon, PenLine, ScanBarcode, Trash2, type LucideIcon } from 'lucide-react-native'
import { FOOD_TEXT_LIMIT, type FoodGoalInput, type FridgeItemInput } from '@ego/core'
import { BottomSheet, inputClass } from '../money/Common'
import { color } from '../money/tokens'
import { Button } from '../ui/button'
import { Text } from '../ui/text'
import { FridgeIcon } from './ui'

function Option({ Icon, label, detail, onPress }: { Icon: LucideIcon; label: string; detail: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityHint={detail} onPress={onPress} className="mb-2 min-h-16 flex-row items-center gap-4 rounded-2xl bg-surface-900 px-4 py-3 active:bg-surface-800">
    <View className="h-10 w-10 items-center justify-center rounded-full bg-primary"><Icon color={color.screen} size={20} /></View>
    <View className="flex-1">
      <Text className="text-[16px] font-semibold">{label}</Text>
      <Text className="text-[14px] text-muted-foreground">{detail}</Text>
    </View>
  </Pressable>
}

export type AddChoice = 'camera' | 'library' | 'barcode' | 'type'

/** Every way in, for the log or for the fridge. */
export function AddSheet({ visible, mode, onPick, onClose }: {
  visible: boolean
  mode: 'log' | 'fridge'
  onPick: (choice: AddChoice) => void
  onClose: () => void
}): React.ReactElement {
  const log = mode === 'log'
  return <BottomSheet visible={visible} title={log ? 'Log food' : 'Add to the fridge'} onClose={onClose} dismissOnBackdrop>
    <Option Icon={Camera} label="Take a photo" detail={log ? 'Of the plate or the nutrition label' : 'Of groceries, a shelf, or a bag'} onPress={() => onPick('camera')} />
    <Option Icon={ImageIcon} label="Choose a photo" detail="From the gallery" onPress={() => onPick('library')} />
    <Option Icon={ScanBarcode} label="Scan a barcode" detail={log ? 'Label numbers for one serving' : 'The product name from its barcode'} onPress={() => onPick('barcode')} />
    <Option Icon={PenLine} label={log ? 'Describe it' : 'Type a name'} detail={log ? '"Two eggs and toast"' : 'For anything without a barcode'} onPress={() => onPick('type')} />
  </BottomSheet>
}

export function DescribeSheet({ visible, onSend, onClose }: {
  visible: boolean
  onSend: (text: string) => void
  onClose: () => void
}): React.ReactElement {
  const [text, setText] = useState('')
  useEffect(() => { if (visible) setText('') }, [visible])
  return <BottomSheet visible={visible} title="Describe it" onClose={onClose}>
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder="A chicken burrito bowl with guac, about half eaten"
      placeholderTextColor="#737373"
      accessibilityLabel="What you ate"
      autoFocus
      multiline
      maxLength={FOOD_TEXT_LIMIT}
      className={`${inputClass} min-h-28`}
      style={{ textAlignVertical: 'top' }}
    />
    <Text className="mt-2 text-[13px] leading-5 text-muted-foreground">Amounts help: "two slices", "a large bowl", "about 200 g".</Text>
    <Button size="lg" className="mt-4" disabled={text.trim() === ''} onPress={() => onSend(text.trim())}><Text>Work it out</Text></Button>
  </BottomSheet>
}

function NumberField({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (text: string) => void }): React.ReactElement {
  return <View className="mb-4">
    <Text className="mb-2 text-[15px] font-medium text-surface-200">{label}</Text>
    <View className="flex-row items-center">
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9.]/g, ''))}
        placeholder="No target"
        placeholderTextColor="#737373"
        accessibilityLabel={`${label} target`}
        keyboardType="decimal-pad"
        maxLength={6}
        className={`${inputClass} flex-1`}
      />
      <Text className="ml-3 w-10 text-[16px] text-muted-foreground">{unit}</Text>
    </View>
  </View>
}

function targetText(value: number | null): string {
  return value === null ? '' : String(value)
}

function targetValue(text: string): number | null {
  const value = Number(text)
  return text.trim() === '' || !Number.isFinite(value) || value <= 0 ? null : Math.round(value)
}

export function TargetsSheet({ visible, goal, onSave, onClose }: {
  visible: boolean
  goal: FoodGoalInput
  onSave: (goal: FoodGoalInput) => void
  onClose: () => void
}): React.ReactElement {
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const saved = useRef(goal)
  saved.current = goal
  // Only opening the sheet refills it. A sync landing while it is open would wipe what was typed.
  useEffect(() => {
    if (!visible) return
    setCalories(targetText(saved.current.calories))
    setProtein(targetText(saved.current.protein))
    setCarbs(targetText(saved.current.carbs))
    setFat(targetText(saved.current.fat))
  }, [visible])
  return <BottomSheet visible={visible} title="Daily targets" onClose={onClose}>
    <NumberField label="Calories" unit="kcal" value={calories} onChange={setCalories} />
    <NumberField label="Protein" unit="g" value={protein} onChange={setProtein} />
    <NumberField label="Carbs" unit="g" value={carbs} onChange={setCarbs} />
    <NumberField label="Fat" unit="g" value={fat} onChange={setFat} />
    <Text className="text-[13px] leading-5 text-muted-foreground">Leave a box empty for no target. Every day compares against these.</Text>
    <Button size="lg" className="mt-4" onPress={() => onSave({
      calories: targetValue(calories), protein: targetValue(protein), carbs: targetValue(carbs), fat: targetValue(fat)
    })}><Text>Save</Text></Button>
  </BottomSheet>
}

/** The items a fridge photo turned up, with a way to drop the ones it got wrong. */
export function FridgeDraftSheet({ visible, items, onChange, onSave, onClose }: {
  visible: boolean
  items: readonly FridgeItemInput[]
  onChange: (items: FridgeItemInput[]) => void
  onSave: () => void
  onClose: () => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title="Add to the fridge" onClose={onClose}>
    {items.map((item, index) => <View key={`${index}-${item.name}`} className="min-h-14 flex-row items-center border-b border-surface-900">
      <FridgeIcon icon={item.icon} size={36} />
      <View className="ml-3 flex-1 py-2">
        <Text numberOfLines={1} className="text-[16px]">{item.name}</Text>
        {item.brand && <Text numberOfLines={1} className="text-[13px] text-muted-foreground">{item.brand}</Text>}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Leave out ${item.name}`}
        onPress={() => onChange(items.filter((_, position) => position !== index))}
        hitSlop={6}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"
      ><Trash2 color={color.textMuted} size={18} /></Pressable>
    </View>)}
    <Button size="lg" className="mt-5" disabled={items.length === 0} onPress={onSave}>
      <Text>{items.length === 1 ? 'Add 1 item' : `Add ${items.length} items`}</Text>
    </Button>
  </BottomSheet>
}
