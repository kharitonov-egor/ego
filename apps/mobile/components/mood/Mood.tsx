import React, { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Angry, Check, Frown, Laugh, Meh, Smile, Trash2, type LucideIcon } from 'lucide-react-native'
import type { MoodRecord } from '@ego/api-contracts'
import { MOOD_LEVELS, MOOD_NOTE_LIMIT, type MoodInput, type MoodLevel } from '@ego/core'
import { BlurBlob, useBlur, useBlurText } from '../../lib/blur'
import { parseIso, shiftIso } from '../../lib/dates'
import { inputClass } from '../money/Common'
import { Button } from '../ui/button'
import { Card, CardHeader, CardTitle } from '../ui/card'
import { Text } from '../ui/text'

/** Every color is paired with a face and a word, so the scale never relies on hue alone. */
export const MOODS: Record<MoodLevel, { label: string; color: string; Icon: LucideIcon }> = {
  1: { label: 'Awful', color: '#fb7185', Icon: Angry },
  2: { label: 'Bad', color: '#fb923c', Icon: Frown },
  3: { label: 'Okay', color: '#facc15', Icon: Meh },
  4: { label: 'Good', color: '#a3e635', Icon: Smile },
  5: { label: 'Great', color: '#34d399', Icon: Laugh }
}

const HISTORY_PAGE = 30

export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today'
  if (iso === shiftIso(today, -1)) return 'Yesterday'
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return parseIso(iso).toLocaleDateString('en-US', sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

function MoodPicker({ value, onChange }: { value: MoodLevel | null; onChange: (mood: MoodLevel) => void }): React.ReactElement {
  return <View accessibilityRole="radiogroup" className="mt-4 flex-row gap-2">
    {MOOD_LEVELS.map((level) => {
      const { label, color, Icon } = MOODS[level]
      const selected = value === level
      return <Pressable
        key={level}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        onPress={() => onChange(level)}
        className="flex-1 items-center rounded-2xl border py-3 active:opacity-80"
        style={{ borderColor: selected ? color : '#333333', backgroundColor: selected ? `${color}26` : '#171717' }}
      >
        <Icon color={selected ? color : '#a3a3a3'} size={30} strokeWidth={selected ? 2.25 : 1.75} />
        <Text className="mt-1.5 text-[13px] font-semibold" style={{ color: selected ? color : '#a3a3a3' }}>{label}</Text>
      </Pressable>
    })}
  </View>
}

/**
 * Mount it with a key that includes the entry's revision. A save or a change pulled from another
 * device then resets the draft, while a sync echo of the same revision leaves typing alone.
 */
export function MoodDayEditor({ date, today, entry, busy, onSave, onClear }: {
  date: string
  today: string
  entry: MoodRecord | null
  busy: boolean
  onSave: (input: MoodInput) => void
  onClear: () => void
}): React.ReactElement {
  const { blurred } = useBlur()
  const blur = useBlurText()
  const [mood, setMood] = useState<MoodLevel | null>(entry?.mood ?? null)
  const [note, setNote] = useState(entry?.note ?? '')
  const dirty = mood !== (entry?.mood ?? null) || note.trim() !== (entry?.note ?? '')
  const saved = entry !== null && !dirty
  const label = mood === null ? 'Pick a mood' : saved ? 'Saved' : entry ? 'Save changes' : 'Save'
  const question = date === today ? 'How was today?'
    : date === shiftIso(today, -1) ? 'How was yesterday?' : 'How was this day?'
  if (blurred) {
    return <Card className="p-5">
      <Text accessibilityRole="header" className="text-[20px] font-semibold">{question}</Text>
      <View pointerEvents="none"><MoodPicker value={null} onChange={setMood} /></View>
      <View className={`${inputClass} mt-4 min-h-[128px] justify-start py-3`}>
        {entry?.note
          ? <Text className="text-[16px] leading-6" style={blur()}>{entry.note}</Text>
          : <Text className="text-[16px] leading-6 text-surface-500">No notes</Text>}
      </View>
      <Text className="mt-4 text-[14px] leading-5 text-muted-foreground">Blur is on, so this day is read-only. Turn it off in Settings to edit.</Text>
    </Card>
  }
  return <Card className="p-5">
    <Text accessibilityRole="header" className="text-[20px] font-semibold">{question}</Text>
    <MoodPicker value={mood} onChange={setMood} />
    <TextInput
      value={note}
      onChangeText={setNote}
      accessibilityLabel="Notes about the day"
      placeholder="What happened? Anything worth remembering?"
      placeholderTextColor="#737373"
      multiline
      maxLength={MOOD_NOTE_LIMIT}
      textAlignVertical="top"
      className={`${inputClass} mt-4 min-h-[128px] leading-6`}
    />
    <Button
      size="lg"
      disabled={mood === null || !dirty || busy}
      onPress={() => { if (mood !== null) onSave({ date, mood, note }) }}
      className="mt-4"
    >
      {saved && <Check color="#0a0a0a" size={18} />}
      <Text>{label}</Text>
    </Button>
    {entry && <Button variant="ghost" disabled={busy} onPress={onClear} className="mt-2">
      <Trash2 color="#fb7185" size={17} />
      <Text className="text-destructive">Clear this day</Text>
    </Button>}
  </Card>
}

export function MoodHistory({ entries, selected, today, onSelect }: {
  entries: MoodRecord[]
  selected: string
  today: string
  onSelect: (date: string) => void
}): React.ReactElement {
  const { blurred } = useBlur()
  const blur = useBlurText()
  const [shown, setShown] = useState(HISTORY_PAGE)
  return <Card className="overflow-hidden">
    <CardHeader className="pb-4"><CardTitle>Past days</CardTitle></CardHeader>
    {entries.length === 0
      ? <Text className="px-5 pb-5 text-muted-foreground">Days you log show up here.</Text>
      : entries.slice(0, shown).map((entry) => {
        const { label, color, Icon } = MOODS[entry.mood]
        const day = dayLabel(entry.date, today)
        return <Pressable
          key={entry.date}
          accessibilityRole="button"
          accessibilityLabel={`${day}, ${label}${entry.note ? `, ${entry.note}` : ''}`}
          accessibilityHint="Opens this day"
          onPress={() => onSelect(entry.date)}
          className={`flex-row border-t border-surface-800 px-5 py-3.5 active:bg-surface-900 ${entry.date === selected ? 'bg-surface-900' : ''}`}
        >
          <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: blurred ? '#262626' : `${color}26` }}>
            {blurred ? <BlurBlob size={22} /> : <Icon color={color} size={22} />}
          </View>
          <View className="ml-3 flex-1 justify-center">
            <View className="flex-row items-baseline justify-between">
              <Text className="text-[17px] font-semibold" style={blur()}>{label}</Text>
              <Text className="ml-3 text-[14px] text-muted-foreground">{day}</Text>
            </View>
            {entry.note.length > 0 && <Text numberOfLines={2} className="mt-0.5 text-[15px] leading-5 text-surface-300" style={blur('#d4d4d4')}>{entry.note}</Text>}
          </View>
        </Pressable>
      })}
    {entries.length > shown && <Pressable
      accessibilityRole="button"
      onPress={() => setShown((current) => current + HISTORY_PAGE)}
      className="min-h-12 items-center justify-center border-t border-surface-800 active:bg-surface-900"
    >
      <Text className="text-[15px] font-semibold">Show older days</Text>
    </Pressable>}
  </Card>
}
