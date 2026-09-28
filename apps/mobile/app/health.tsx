import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, View
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, HeartPulse, LayoutGrid, X } from 'lucide-react-native'
import { ConflictEntries } from '../components/ConflictEntries'
import { HeaderIcon } from '../components/gym/ui'
import { MoodDayEditor, MoodHistory } from '../components/health/Mood'
import { BottomSheet, ConfirmDialog } from '../components/money/Common'
import { CalendarDialog } from '../components/money/DatePicker'
import { SyncButton } from '../components/money/SyncButton'
import { Button } from '../components/ui/button'
import { Text } from '../components/ui/text'
import { formatIso, isoToday, parseIso, shiftIso } from '../lib/dates'
import { useLedger } from '../lib/ledger-context'
import { useMoodJournal } from '../lib/mood-journal'

function Message({ title, detail, action, onAction }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <HeartPulse color="#737373" size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

function DayBar({ date, today, onPick, onOpenCalendar }: {
  date: string
  today: string
  onPick: (iso: string) => void
  onOpenCalendar: () => void
}): React.ReactElement {
  const title = date === today ? 'Today'
    : date === shiftIso(today, -1) ? 'Yesterday'
      : parseIso(date).toLocaleDateString('en-US', { weekday: 'long' })
  return <View className="flex-row items-center">
    <Button variant="ghost" size="icon" accessibilityLabel="Previous day" onPress={() => onPick(shiftIso(date, -1))}>
      <ChevronLeft color="#fafafa" size={22} />
    </Button>
    <View className="flex-1 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatIso(date)}`}
        accessibilityHint="Opens the calendar"
        onPress={onOpenCalendar}
        hitSlop={8}
        className="items-center"
      >
        <Text accessibilityLiveRegion="polite" className="text-[22px] font-bold tracking-tight">{title}</Text>
        <Text className="mt-0.5 text-[14px] text-muted-foreground">{formatIso(date)}</Text>
      </Pressable>
      {date !== today && <Pressable accessibilityRole="button" onPress={() => onPick(today)} hitSlop={10} className="mt-1">
        <Text className="text-[14px] font-semibold underline">Back to today</Text>
      </Pressable>}
    </View>
    <Button variant="ghost" size="icon" accessibilityLabel="Next day" disabled={date >= today} onPress={() => onPick(shiftIso(date, 1))}>
      <ChevronRight color="#fafafa" size={22} />
    </Button>
  </View>
}

export default function Health(): React.ReactElement {
  const ledger = useLedger()
  const journal = useMoodJournal()
  const router = useRouter()
  const scroll = useRef<ScrollView>(null)
  const [today, setToday] = useState(isoToday)
  /** Null follows today, so a screen left open overnight moves to the new day. */
  const [picked, setPicked] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const date = picked ?? today

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(isoToday())
    })
    return () => subscription.remove()
  }, [])

  const pick = (iso: string): void => setPicked(iso >= today ? null : iso)
  const header = <>
    <Stack.Screen options={{
      headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderIcon>,
      headerRight: () => <SyncButton onReview={() => setReviewing(true)} />
    }} />
    <BottomSheet visible={reviewing} title="Needs attention" onClose={() => setReviewing(false)}>
      <ConflictEntries
        entries={ledger.conflicts}
        onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
        onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      />
    </BottomSheet>
  </>

  if (!ledger.enabled) {
    return <>{header}<Message
      title="Sign in to keep a mood journal"
      detail="Sign in once with Google on the start screen. Entries then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    /></>
  }
  if (ledger.error) return <>{header}<Message title="This phone cannot open its database" detail={ledger.error} /></>
  if (!journal.entries) {
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <>{header}<Message title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} /></>
    }
    if (stopped) {
      return <>{header}<Message
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, this screen works offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      /></>
    }
    return <>{header}<View className="flex-1 items-center justify-center bg-background"><ActivityIndicator color="#fafafa" /></View></>
  }

  const entries = journal.entries
  const entry = entries.find((item) => item.date === date) ?? null
  const clear = async (): Promise<void> => {
    if (await journal.clear(date)) setConfirmingClear(false)
  }

  return <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {header}
    <ScrollView
      ref={scroll}
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <DayBar date={date} today={today} onPick={pick} onOpenCalendar={() => setCalendarOpen(true)} />
      {journal.error && <Pressable
        accessibilityRole="button"
        accessibilityHint="Dismisses this message"
        onPress={journal.dismissError}
        className="flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
      >
        <Text className="flex-1 text-[14px] leading-5 text-red-300">{journal.error}</Text>
        <X color="#fca5a5" size={16} />
      </Pressable>}
      <MoodDayEditor
        key={`${date}:${entry?.revision ?? 'none'}`}
        date={date}
        today={today}
        entry={entry}
        busy={journal.busy}
        onSave={(input) => void journal.save(input)}
        onClear={() => setConfirmingClear(true)}
      />
      <MoodHistory
        entries={entries}
        selected={date}
        today={today}
        onSelect={(iso) => {
          pick(iso)
          scroll.current?.scrollTo({ y: 0, animated: true })
        }}
      />
    </ScrollView>
    <CalendarDialog
      visible={calendarOpen}
      value={date}
      onCancel={() => setCalendarOpen(false)}
      onConfirm={(iso) => {
        setCalendarOpen(false)
        pick(iso)
      }}
    />
    <ConfirmDialog
      visible={confirmingClear}
      title="Clear this day?"
      detail="The mood and notes for this day are removed from every device."
      confirmLabel="Clear" destructive busy={journal.busy} hideNavigation={false}
      onCancel={() => setConfirmingClear(false)}
      onConfirm={() => void clear()}
    />
  </KeyboardAvoidingView>
}
