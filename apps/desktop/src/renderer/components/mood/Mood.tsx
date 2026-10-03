import React, { useState } from 'react'
import { Angry, Check, Frown, Laugh, Meh, Smile, Trash2, type LucideIcon } from 'lucide-react'
import type { MoodRecord } from '@ego/api-contracts'
import { MOOD_LEVELS, MOOD_NOTE_LIMIT, type MoodInput, type MoodLevel } from '@ego/core'
import { parseIso, shiftIso } from '@ego/local/dates'
import { BlurBlob, Blurred, useBlur } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Card, CardHeader, CardTitle } from '../ui/card'
import { inputClass } from '../ui/input'

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
  return <div role="radiogroup" aria-label="Mood" className="mt-4 flex gap-2">
    {MOOD_LEVELS.map((level) => {
      const { label, color, Icon } = MOODS[level]
      const selected = value === level
      return <button
        key={level}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={label}
        onClick={() => onChange(level)}
        className={cn('flex flex-1 flex-col items-center rounded-2xl border py-3 transition-colors active:opacity-80', !selected && 'hover:!bg-surface-800')}
        style={{ borderColor: selected ? color : '#333333', backgroundColor: selected ? `${color}26` : '#171717' }}
      >
        <Icon color={selected ? color : '#a3a3a3'} size={30} strokeWidth={selected ? 2.25 : 1.75} />
        <span className="mt-1.5 text-[13px] font-semibold" style={{ color: selected ? color : '#a3a3a3' }}>{label}</span>
      </button>
    })}
  </div>
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
  const [mood, setMood] = useState<MoodLevel | null>(entry?.mood ?? null)
  const [note, setNote] = useState(entry?.note ?? '')
  const dirty = mood !== (entry?.mood ?? null) || note.trim() !== (entry?.note ?? '')
  const saved = entry !== null && !dirty
  const label = mood === null ? 'Pick a mood' : saved ? 'Saved' : entry ? 'Save changes' : 'Save'
  const question = date === today ? 'How was today?'
    : date === shiftIso(today, -1) ? 'How was yesterday?' : 'How was this day?'
  const submit = (): void => {
    if (mood !== null && dirty && !busy) onSave({ date, mood, note })
  }
  if (blurred) {
    return <Card className="p-5">
      <h2 className="text-[20px] font-semibold">{question}</h2>
      <div inert className="pointer-events-none"><MoodPicker value={null} onChange={setMood} /></div>
      <div className={cn(inputClass, 'mt-4 min-h-[128px] py-3 hover:border-input')}>
        {entry?.note
          ? <Blurred><p className="whitespace-pre-wrap break-words text-[16px] leading-6">{entry.note}</p></Blurred>
          : <p className="text-[16px] leading-6 text-surface-500">No notes</p>}
      </div>
      <p className="mt-4 text-[14px] leading-5 text-muted-foreground">Blur is on, so this day is read-only. Turn it off in Settings to edit.</p>
    </Card>
  }
  return <Card className="p-5">
    <h2 className="text-[20px] font-semibold">{question}</h2>
    <MoodPicker value={mood} onChange={setMood} />
    <textarea
      value={note}
      onChange={(event) => setNote(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        submit()
      }}
      aria-label="Notes about the day"
      placeholder="What happened? Anything worth remembering?"
      maxLength={MOOD_NOTE_LIMIT}
      className={cn(inputClass, 'mt-4 block min-h-[128px] resize-y leading-6')}
    />
    <Button size="lg" disabled={mood === null || !dirty || busy} onClick={submit} title="Ctrl+Enter" className="mt-4 w-full">
      {saved && <Check color="#0a0a0a" size={18} />}
      {label}
    </Button>
    {entry && <Button variant="ghost" disabled={busy} onClick={onClear} className="mt-2 w-full text-destructive">
      <Trash2 color="#fb7185" size={17} />
      Clear this day
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
  const [shown, setShown] = useState(HISTORY_PAGE)
  return <Card className="overflow-hidden">
    <CardHeader className="pb-4"><CardTitle>Past days</CardTitle></CardHeader>
    {entries.length === 0
      ? <p className="px-5 pb-5 text-muted-foreground">Days you log show up here.</p>
      : entries.slice(0, shown).map((entry) => {
        const { label, color, Icon } = MOODS[entry.mood]
        const day = dayLabel(entry.date, today)
        return <button
          key={entry.date}
          type="button"
          aria-current={entry.date === selected ? 'date' : undefined}
          aria-label={`${day}, ${label}${entry.note ? `, ${entry.note}` : ''}`}
          aria-description="Opens this day"
          onClick={() => onSelect(entry.date)}
          className={cn('flex w-full border-t border-surface-800 px-5 py-3.5 text-left transition-colors hover:bg-surface-900 active:bg-surface-900', entry.date === selected && 'bg-surface-900')}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: blurred ? '#262626' : `${color}26` }}>
            {blurred ? <BlurBlob size={22} /> : <Icon color={color} size={22} />}
          </span>
          <span className="ml-3 flex min-w-0 flex-1 flex-col justify-center">
            <span className="flex items-baseline justify-between">
              <Blurred><span className="text-[17px] font-semibold">{label}</span></Blurred>
              <span className="ml-3 shrink-0 text-[14px] text-muted-foreground">{day}</span>
            </span>
            {entry.note.length > 0 && <Blurred><span className="mt-0.5 line-clamp-2 break-words text-[15px] leading-5 text-surface-300">{entry.note}</span></Blurred>}
          </span>
        </button>
      })}
    {entries.length > shown && <button
      type="button"
      onClick={() => setShown((current) => current + HISTORY_PAGE)}
      className="flex min-h-12 w-full items-center justify-center border-t border-surface-800 text-[15px] font-semibold hover:bg-surface-900 active:bg-surface-900"
    >Show older days</button>}
  </Card>
}
