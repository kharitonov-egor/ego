import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Smile, X } from 'lucide-react'
import { DayBar } from '../../components/DayBar'
import { CalendarDialog } from '../../components/DatePicker'
import { MoodDayEditor, MoodHistory } from '../../components/mood/Mood'
import { CenteredMessage, Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { useLedger } from '../../lib/ledger'
import { useMoodJournal } from '../../lib/mood-journal'
import { useToday } from '../../lib/today'

/** The phone's one column, with the past days beside the editor once the window is wide enough. */
export default function MoodScreen(): React.ReactElement {
  return <Screen>
    <ScreenHeader title="Mood" />
    <div className="flex min-h-0 flex-1 flex-col"><Mood /></div>
  </Screen>
}

function Mood(): React.ReactElement {
  const ledger = useLedger()
  const journal = useMoodJournal()
  const navigate = useNavigate()
  const editor = useRef<HTMLDivElement>(null)
  const today = useToday()
  /** Null follows today, so a screen left open overnight moves to the new day. */
  const [picked, setPicked] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const date = picked ?? today

  const pick = (iso: string): void => setPicked(iso >= today ? null : iso)

  if (!ledger.enabled) {
    return <CenteredMessage
      Icon={Smile}
      title="Sign in to keep a mood journal"
      detail="Sign in once with Google on Home. Entries then save on this computer and sync to D1."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
  }
  if (ledger.error) return <CenteredMessage Icon={Smile} title="This computer cannot open its database" detail={ledger.error} />
  if (!journal.entries) {
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <CenteredMessage Icon={Smile} title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
    }
    if (stopped) {
      return <CenteredMessage
        Icon={Smile}
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, this screen works offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <div className="flex min-h-0 flex-1 items-center justify-center"><Spinner /></div>
  }

  const entries = journal.entries
  const entry = entries.find((item) => item.date === date) ?? null
  const clear = async (): Promise<void> => {
    if (await journal.clear(date)) setConfirmingClear(false)
  }

  return <>
    <ScreenBody width="wide" className="max-w-2xl lg:max-w-6xl">
      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <div ref={editor} className="flex scroll-mt-5 flex-col gap-3 lg:sticky lg:top-5">
          <DayBar date={date} today={today} onPick={pick} onOpenCalendar={() => setCalendarOpen(true)} />
          {journal.error && <button
            type="button"
            title="Dismiss"
            onClick={journal.dismissError}
            className="flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-left hover:bg-red-500/15"
          >
            <span className="flex-1 text-[14px] leading-5 text-red-300">{journal.error}</span>
            <X color="#fca5a5" size={16} />
          </button>}
          <MoodDayEditor
            key={`${date}:${entry?.revision ?? 'none'}`}
            date={date}
            today={today}
            entry={entry}
            busy={journal.busy}
            onSave={(input) => void journal.save(input)}
            onClear={() => setConfirmingClear(true)}
          />
        </div>
        <MoodHistory
          entries={entries}
          selected={date}
          today={today}
          onSelect={(iso) => {
            pick(iso)
            const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            editor.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
          }}
        />
      </div>
    </ScreenBody>
    <CalendarDialog
      visible={calendarOpen}
      value={date}
      max={today}
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
      confirmLabel="Clear" destructive busy={journal.busy}
      onCancel={() => setConfirmingClear(false)}
      onConfirm={() => void clear()}
    />
  </>
}
