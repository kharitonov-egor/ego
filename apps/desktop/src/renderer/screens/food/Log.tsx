import React, { memo, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ImagePlus, Plus, Target } from 'lucide-react'
import type { FoodEntryRecord } from '@ego/api-contracts'
import { NO_FOOD_GOAL, NO_MACROS, formatCalories, type FoodDay, type FoodEntryInput } from '@ego/core'
import { dayTitle, timeLabel } from '@ego/local/food/drafts'
import { DraftCard } from '../../components/food/DraftCard'
import { PhotoDropZone } from '../../components/food/PhotoDrop'
import { AddSheet, BarcodeSheet, DescribeSheet, TargetsSheet, type AddChoice } from '../../components/food/sheets'
import { FoodError, FoodGate, FoodHeader, FoodThumb, TodayCard, macroText } from '../../components/food/ui'
import { Screen } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Blurred } from '../../lib/blur'
import { useFood } from '../../lib/food/context'
import { chooseFoodPhoto, photoFromFile } from '../../lib/food/photo'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { FoodEntryPanel } from './Entry'

const LABEL_HINT = 'This is the nutrition label of a packaged food. Log one serving.'
/** Days drawn at first and added each time the list nears its end, like the phone's windowed list. */
const DAYS_PAGE = 14

const EntryRow = memo(function EntryRow({ entry, pictures, stuck, first, last, selected, onPress }: {
  entry: FoodEntryRecord
  pictures: boolean
  /** The photo was refused and the entry waits on this computer. */
  stuck: boolean
  first: boolean
  last: boolean
  /** Its editor is open beside the log. */
  selected: boolean
  onPress: (entry: FoodEntryRecord) => void
}): React.ReactElement {
  return <button
    type="button"
    aria-label={`${entry.name}, ${formatCalories(entry.calories)} calories, ${timeLabel(entry.eatenAt)}`}
    aria-current={selected || undefined}
    onClick={() => onPress(entry)}
    className={cn('flex w-full items-center border-x border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-900 active:bg-surface-900',
      first && 'rounded-t-3xl border-t', last && 'rounded-b-3xl', selected ? 'bg-surface-800 hover:bg-surface-800' : 'bg-card')}
  >
    {pictures && <span className="mr-3"><FoodThumb entry={entry} size={56} /></span>}
    <span className="min-w-0 flex-1">
      <Blurred><span className="line-clamp-2 text-[16px] font-semibold">{entry.name}</span></Blurred>
      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
        {timeLabel(entry.eatenAt)}{entry.serving ? ` · ${entry.serving}` : ''}
      </span>
      {stuck && <span className="mt-0.5 block text-[13px] text-attention">Photo did not upload. Click to try again.</span>}
    </span>
    <span className="ml-3 flex shrink-0 flex-col items-end">
      <span className="tabular text-[16px] font-semibold">{formatCalories(entry.calories)}</span>
      <span className="tabular mt-0.5 text-[12px] text-muted-foreground">{macroText(entry)}</span>
    </span>
  </button>
})

function DayHeader({ day, today }: { day: FoodDay<FoodEntryRecord>; today: string }): React.ReactElement {
  return <div className="flex items-end justify-between px-1 pb-2 pt-6">
    <h2 className="text-[15px] font-bold">{dayTitle(day.date, today)}</h2>
    <span className="tabular text-[13px] text-muted-foreground">{formatCalories(day.totals.calories)} kcal</span>
  </div>
}

/**
 * The log on `/food`, and with an entry's editor beside it on `/food/entry/:id`. A narrow window
 * shows the editor alone.
 */
export default function FoodLog(): React.ReactElement {
  const { id } = useParams()
  const entryId = id ?? null
  const food = useFood()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [describing, setDescribing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [targets, setTargets] = useState(false)
  const goal = food.data?.goal ?? NO_FOOD_GOAL
  const draftEdit = useRef<FoodEntryInput | null>(null)

  /**
   * Something new appears in the log, which a narrow window hides behind an open editor. It also
   * saves the held card first, as on the phone, so that card takes what was typed in its editor.
   */
  const leaveEditor = (): void => {
    if (entryId === null) return
    if (entryId === 'draft' && draftEdit.current) food.editDraftEntry(draftEdit.current)
    void navigate('/food')
  }

  const logFile = (file: File): void => {
    const current = food.draft
    const label = current?.kind === 'meal' && current.state === 'failed' && current.unknownBarcode !== null
    leaveEditor()
    void food.logPhoto(() => photoFromFile(file), label ? LABEL_HINT : '')
  }

  const pick = (choice: AddChoice): void => {
    setAdding(false)
    if (choice === 'library') {
      leaveEditor()
      void food.logPhoto(chooseFoodPhoto)
    } else if (choice === 'barcode') {
      setScanning(true)
    } else {
      setDescribing(true)
    }
  }

  return <Screen>
    <FoodHeader editing={entryId !== null} right={food.data && <>
      <IconButton label="Daily targets" onClick={() => setTargets(true)}><Target color={color.textSecondary} size={21} /></IconButton>
      <IconButton label="Log food" onClick={() => setAdding(true)} className="h-10 w-10 text-foreground"><Plus size={23} /></IconButton>
    </>} />
    <FoodGate>
      <LogBody
        entryId={entryId}
        onDraftEdit={(entry) => { draftEdit.current = entry }}
        onTargets={() => setTargets(true)}
        onPhoto={logFile}
        onChoosePhoto={() => {
          leaveEditor()
          void food.logPhoto(chooseFoodPhoto)
        }}
        onLabelPhoto={() => {
          leaveEditor()
          void food.logPhoto(chooseFoodPhoto, LABEL_HINT)
        }}
        onDescribe={() => setDescribing(true)}
      />
    </FoodGate>
    <AddSheet visible={adding} mode="log" onPick={pick} onClose={() => setAdding(false)} />
    <BarcodeSheet visible={scanning} mode="log" onClose={() => setScanning(false)} onLookUp={(barcode) => {
      setScanning(false)
      leaveEditor()
      void food.logBarcode(barcode, null)
    }} />
    <DescribeSheet visible={describing} onClose={() => setDescribing(false)} onSend={(text) => {
      setDescribing(false)
      leaveEditor()
      void food.logText(text)
    }} />
    <TargetsSheet visible={targets} goal={goal} onClose={() => setTargets(false)} onSave={(next) => {
      setTargets(false)
      void food.saveGoal(next)
    }} />
  </Screen>
}

function LogBody({ entryId, onDraftEdit, onTargets, onPhoto, onChoosePhoto, onLabelPhoto, onDescribe }: {
  entryId: string | null
  onDraftEdit: (entry: FoodEntryInput | null) => void
  onTargets: () => void
  onPhoto: (file: File) => void
  onChoosePhoto: () => void
  onLabelPhoto: () => void
  onDescribe: () => void
}): React.ReactElement {
  const food = useFood()
  const navigate = useNavigate()
  const [shown, setShown] = useState(DAYS_PAGE)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const goal = food.data?.goal ?? NO_FOOD_GOAL
  const todayTotals = food.days.find((day) => day.date === food.today)?.totals ?? NO_MACROS
  const draft = food.draft?.kind === 'meal' ? food.draft : null
  const editing = entryId !== null
  const days = food.days.slice(0, shown)
  const more = food.days.length > shown

  useEffect(() => {
    const target = sentinel.current
    if (!more || !target) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown((count) => count + DAYS_PAGE)
    }, { root: scroller.current, rootMargin: '600px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [more, shown])

  const open = (entry: FoodEntryRecord): void => void navigate(`/food/entry/${encodeURIComponent(entry.id)}`)
  const close = (): void => void navigate('/food')

  return <div className="flex min-h-0 flex-1">
    <PhotoDropZone label="Drop a photo to log it" onPhoto={onPhoto} className={cn('min-h-0 min-w-0 flex-1 flex-col', editing ? 'hidden lg:flex' : 'flex')}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 pb-28 pt-5">
          <FoodError />
          <TodayCard totals={todayTotals} goal={goal} onPress={onTargets} />
          <div className="mt-3">
            {draft && <DraftCard
              draft={draft}
              editing={entryId === 'draft'}
              onUndo={() => {
                if (entryId === 'draft') close()
                food.undoDraft()
              }}
              onEdit={() => {
                food.pauseDraft(true)
                navigate('/food/entry/draft')
              }}
              onRetry={() => void food.retryDraft()}
              onLabelPhoto={onLabelPhoto}
              onTypeName={onDescribe}
            />}
          </div>
          <div className="flex items-center justify-between px-1">
            <Checkbox checked={food.picturesOn} onCheckedChange={food.setPicturesOn} label={food.picturesOn ? 'Pictures on' : 'Pictures off'} />
            {days.length > 0 && <span className="text-[13px] text-surface-500">Newest first</span>}
          </div>
          {days.map((day) => <section key={day.date} aria-label={dayTitle(day.date, food.today)}>
            <DayHeader day={day} today={food.today} />
            {day.entries.map((entry, index) => <EntryRow
              key={entry.id}
              entry={entry}
              pictures={food.picturesOn}
              stuck={food.failedUploads.has(entry.id)}
              first={index === 0}
              last={index === day.entries.length - 1}
              selected={entry.id === entryId}
              onPress={open}
            />)}
          </section>)}
          {more && <div ref={sentinel} className="h-10" />}
          {days.length === 0 && !draft && <div className="flex flex-col items-center px-8 py-12 text-center">
            <p className="text-[18px] font-semibold text-surface-100">Nothing logged yet</p>
            <p className="mt-2 max-w-md text-[15px] leading-6 text-surface-400">
              Paste or drop a photo of a meal or a nutrition label, type a barcode, or describe what you ate. The AI tile logs food too.
            </p>
          </div>}
        </div>
      </div>
      {!editing && <button
        type="button"
        aria-label="Choose a photo of food"
        title="Choose a photo of food"
        onClick={onChoosePhoto}
        className="absolute bottom-5 right-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-lg transition-colors hover:bg-primary/90 active:bg-primary/85"
      ><ImagePlus color={color.screen} size={26} /></button>}
    </PhotoDropZone>
    {entryId !== null && <aside aria-label="Entry" className="flex min-h-0 w-full flex-col border-border lg:w-[440px] lg:shrink-0 lg:border-l">
      <FoodEntryPanel id={entryId} onClose={close} onDraftEdit={onDraftEdit} />
    </aside>}
  </div>
}
