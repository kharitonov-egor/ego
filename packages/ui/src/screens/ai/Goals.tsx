import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell, BellOff, ChevronDown, ExternalLink as ExternalLinkIcon, Pause, Pencil, Play, Plus, Target, Trash2, X, Zap } from 'lucide-react'
import {
  AGENT_GOAL_INSTRUCTIONS_MAX, AGENT_GOAL_TITLE_MAX, type AgentGoal, type AgentGoalUpdate, type AgentRun, type AgentRunStatus
} from '@ego/api-contracts'
import { AGENT_TRIGGER_TYPES, describeTrigger, type AgentTrigger } from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { Chips } from '../../components/common'
import { ExternalLink } from '../../components/ExternalLink'
import { CenteredMessage, Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { Spinner } from '../../components/ui/spinner'
import {
  EVENT_FILTER_MAX, EVENT_TRIGGER_EXAMPLES, TRIGGER_TYPE_LABELS, WEEKDAY_OPTIONS, deviceTimeZone, draftFromTrigger, fireMessage, goalStatusLabel, momentInSentence, momentLabel,
  runReasonLabel, runStatusLabel, runTime, triggerFromDraft, type TriggerDraft
} from '../../lib/agent'
import { Blurred } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'
import { useBackPath } from '../money/header'

const FIELD = cn(inputClass, '[color-scheme:dark]')
const SELECT = cn(FIELD, 'appearance-auto pr-2')
const RECENT_RUNS = 10

interface GoalDraft {
  title: string
  instructions: string
  when: TriggerDraft
}

interface Editing {
  goal: AgentGoal | null
  draft: GoalDraft
}

const EXAMPLES: ReadonlyArray<{ label: string; title: string; instructions: string; trigger: AgentTrigger }> = [
  {
    label: 'Weekday brief at 7:00',
    title: 'Morning brief',
    instructions: 'Look at today\'s calendar, the task cards due soon, and the habits I usually do. Post a short brief of what matters today.',
    trigger: { type: 'weekdays', time: '07:00' }
  },
  {
    label: 'Sunday money review',
    title: 'Money review',
    instructions: 'Review last week\'s spending by category against my budget. Post the totals and call out anything unusual.',
    trigger: { type: 'weekly', weekday: 7, time: '10:00' }
  }
]

function draftFor(title: string, instructions: string, trigger: AgentTrigger): GoalDraft {
  return { title, instructions, when: draftFromTrigger(trigger, isoToday()) }
}

const BLANK_TRIGGER: AgentTrigger = { type: 'daily', time: '07:00' }

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="mt-4">
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-surface-400">{label}</label>
    {children}
  </div>
}

function WhenFields({ when, onChange }: { when: TriggerDraft; onChange: (when: TriggerDraft) => void }): React.ReactElement {
  const set = (change: Partial<TriggerDraft>): void => onChange({ ...when, ...change })
  const time = <input type="time" aria-label="Time" value={when.time} onChange={(event) => set({ time: event.target.value })} className={cn(FIELD, 'w-36')} />
  return <>
    <Chips
      values={AGENT_TRIGGER_TYPES}
      value={when.type}
      labels={TRIGGER_TYPE_LABELS}
      onChange={(type) => set({ type })}
    />
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {(when.type === 'daily' || when.type === 'weekdays') && time}
      {when.type === 'weekly' && <>
        <select aria-label="Day" value={when.weekday} onChange={(event) => set({ weekday: Number(event.target.value) })} className={cn(SELECT, 'w-44')}>
          {WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
        </select>
        {time}
      </>}
      {when.type === 'interval' && <label className="flex items-center gap-3 text-[15px] text-surface-300">
        Every
        <input type="number" min={1} max={168} step={1} aria-label="Hours" value={when.hours} onChange={(event) => set({ hours: event.target.value })} className={cn(FIELD, 'w-24')} />
        hours
      </label>}
      {when.type === 'once' && <>
        <input type="date" aria-label="Date" value={when.date} onChange={(event) => set({ date: event.target.value })} className={cn(FIELD, 'w-44')} />
        {time}
      </>}
      {when.type === 'manual' && <p className="text-[15px] leading-6 text-muted-foreground">It runs when you press Run now or ask for it in the chat.</p>}
      {when.type === 'event' && <EventFields when={when} set={set} />}
    </div>
  </>
}

function EventFields({ when, set }: { when: TriggerDraft; set: (change: Partial<TriggerDraft>) => void }): React.ReactElement {
  return <div className="w-full">
    <input
      aria-label="Trigger name"
      value={when.slug}
      onChange={(event) => set({ slug: event.target.value.toUpperCase() })}
      placeholder="GMAIL_NEW_GMAIL_MESSAGE"
      autoCapitalize="characters"
      autoComplete="off"
      spellCheck={false}
      className={cn(inputClass, 'font-mono')}
    />
    <div className="mt-2 flex flex-wrap gap-2">
      {EVENT_TRIGGER_EXAMPLES.map((example) => <button
        key={example.slug}
        type="button"
        aria-pressed={when.slug === example.slug}
        onClick={() => set({ slug: example.slug })}
        className={cn('rounded-full border px-3.5 py-2 text-[14px] transition-colors hover:bg-surface-800 active:bg-surface-800',
          when.slug === example.slug ? 'border-surface-400 bg-surface-800 text-foreground' : 'border-surface-700 text-surface-200')}
      >{example.label}</button>)}
    </div>
    <p className="mt-2 text-[14px] leading-5 text-muted-foreground">Trigger names come from Composio. Set it up in Settings under Other apps.</p>
    <Field label="Only when it mentions" htmlFor="goal-filter">
      <input
        id="goal-filter"
        value={when.filter}
        onChange={(event) => set({ filter: event.target.value })}
        maxLength={EVENT_FILTER_MAX}
        placeholder="Leave empty for every event"
        className={inputClass}
      />
    </Field>
  </div>
}

function GoalEditor({ editing, onClose, onSaved }: {
  editing: Editing
  onClose: () => void
  onSaved: (goal: AgentGoal) => void
}): React.ReactElement {
  const ledger = useLedger()
  const [draft, setDraft] = useState(editing.draft)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (change: Partial<GoalDraft>): void => {
    setDraft((current) => ({ ...current, ...change }))
    setProblem(null)
  }

  const save = async (): Promise<void> => {
    if (saving) return
    const title = draft.title.trim()
    const instructions = draft.instructions.trim()
    const trigger = triggerFromDraft(draft.when)
    const missing = !title ? 'Give the goal a title'
      : instructions.length < 3 ? 'Say what the agent should do'
        : typeof trigger === 'string' ? trigger : null
    if (missing !== null || typeof trigger === 'string') {
      setProblem(missing)
      return
    }
    setSaving(true)
    const result = editing.goal
      ? await ledger.api.updateAgentGoal(editing.goal.id, { title, instructions, trigger })
      : await ledger.api.createAgentGoal({ title, instructions, trigger, timeZone: deviceTimeZone() })
    setSaving(false)
    if (result.ok) onSaved(result.data)
    else setProblem(result.error.message)
  }

  return <Sheet
    visible
    title={editing.goal ? 'Edit goal' : 'New goal'}
    onClose={onClose}
    footer={<>
      {problem && <p role="alert" className="mb-3 text-[15px] leading-5 text-destructive">{problem}</p>}
      <div className="flex gap-3">
        <Button variant="outline" size="lg" disabled={saving} onClick={onClose} className="flex-1">Cancel</Button>
        <Button size="lg" disabled={saving} onClick={() => void save()} className="flex-1">{saving ? 'Saving...' : 'Save'}</Button>
      </div>
    </>}
  >
    <Field label="Title" htmlFor="goal-title">
      <input
        id="goal-title"
        data-autofocus
        value={draft.title}
        onChange={(event) => set({ title: event.target.value })}
        maxLength={AGENT_GOAL_TITLE_MAX}
        placeholder="Morning brief"
        className={inputClass}
      />
    </Field>
    <Field label="What the agent does each time" htmlFor="goal-instructions">
      <textarea
        id="goal-instructions"
        value={draft.instructions}
        onChange={(event) => set({ instructions: event.target.value })}
        maxLength={AGENT_GOAL_INSTRUCTIONS_MAX}
        rows={6}
        placeholder="Look at my calendar and tasks for today and post a short brief."
        className={cn(inputClass, 'block resize-y leading-6')}
      />
      {draft.instructions.length > AGENT_GOAL_INSTRUCTIONS_MAX - 400 && <p className="mt-1 text-right text-[13px] tabular text-surface-500">
        {draft.instructions.length}/{AGENT_GOAL_INSTRUCTIONS_MAX}
      </p>}
    </Field>
    <Field label="When">
      <WhenFields when={draft.when} onChange={(when) => set({ when })} />
    </Field>
  </Sheet>
}

const RUN_TONE: Record<AgentRunStatus, string> = {
  queued: 'text-surface-300',
  running: 'text-attention',
  succeeded: 'text-positive',
  failed: 'text-destructive'
}

function RunList({ runs, error }: { runs: AgentRun[] | null; error: string | null }): React.ReactElement {
  return <div className="mt-4 border-t border-surface-800 pt-3">
    <h3 className="text-[13px] font-semibold uppercase tracking-wide text-surface-400">Recent runs</h3>
    {error && <p role="alert" className="mt-2 text-[15px] leading-5 text-destructive">{error}</p>}
    {runs === null && !error && <div className="flex justify-center py-4"><Spinner size={18} /></div>}
    {runs !== null && runs.length === 0 && <p className="mt-2 text-[15px] text-muted-foreground">No runs yet.</p>}
    {runs !== null && runs.slice(0, RECENT_RUNS).map((run) => <div key={run.id} className="border-t border-surface-800 py-2.5 first-of-type:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 text-[14px]">
        <span className={cn('font-semibold', RUN_TONE[run.status])}>{runStatusLabel(run.status)}</span>
        <span className="text-muted-foreground">{runReasonLabel(run.reason)} · {momentLabel(runTime(run))}</span>
        {run.sessionUrl && <ExternalLink href={run.sessionUrl} className="ml-auto inline-flex items-center gap-1 font-semibold text-surface-200 underline underline-offset-4 hover:text-foreground">
          Open session<ExternalLinkIcon size={13} />
        </ExternalLink>}
      </div>
      {run.summary && <Blurred><p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-surface-200">{run.summary}</p></Blurred>}
    </div>)}
  </div>
}

function StatusPills({ goal }: { goal: AgentGoal }): React.ReactElement {
  return <>
    <Badge variant={goal.status === 'active' ? 'positive' : goal.status === 'paused' ? 'secondary' : 'outline'}>{goalStatusLabel(goal.status)}</Badge>
    {goal.muted && <Badge variant="outline">Muted</Badge>}
  </>
}

function GoalRow({ goal, onSaved, onEdit, onDelete }: {
  goal: AgentGoal
  onSaved: (goal: AgentGoal) => void
  onEdit: () => void
  onDelete: () => void
}): React.ReactElement {
  const ledger = useLedger()
  const [expanded, setExpanded] = useState(false)
  const [runs, setRuns] = useState<AgentRun[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; good: boolean } | null>(null)
  const [working, setWorking] = useState(false)

  const loadRuns = useCallback(async (): Promise<void> => {
    const result = await ledger.api.agentRuns(goal.id)
    if (result.ok) {
      setRuns(result.data.runs)
      setRunsError(null)
    } else {
      setRunsError(result.error.message)
    }
  }, [goal.id, ledger.api])

  useEffect(() => {
    if (expanded) void loadRuns()
  }, [expanded, loadRuns])

  const update = async (change: AgentGoalUpdate): Promise<void> => {
    if (working) return
    setWorking(true)
    setNotice(null)
    const result = await ledger.api.updateAgentGoal(goal.id, change)
    setWorking(false)
    if (result.ok) onSaved(result.data)
    else setNotice({ text: result.error.message, good: false })
  }

  const run = async (): Promise<void> => {
    if (working) return
    setWorking(true)
    setNotice(null)
    const result = await ledger.api.runAgentGoal(goal.id)
    setWorking(false)
    if (!result.ok) {
      setNotice({ text: result.error.message, good: false })
      return
    }
    setNotice({ text: fireMessage(result.data), good: result.data.fired })
    if (expanded) void loadRuns()
  }

  const next = goal.status === 'active' ? goal.nextRunAt : null

  return <Card className="p-5">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)} className="flex w-full items-start gap-3 text-left">
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Blurred><span className="min-w-0 break-words text-[17px] font-semibold">{goal.title}</span></Blurred>
          <StatusPills goal={goal} />
        </span>
        <span className="mt-1 block text-[15px] text-surface-300">
          {describeTrigger(goal.trigger)}{next && <span className="text-muted-foreground"> · Next run {momentInSentence(next)}</span>}
        </span>
        {goal.lastSummary && <span className="mt-2 block">
          {goal.lastRunAt && <span className="block text-[13px] text-surface-500">Last run {momentInSentence(goal.lastRunAt)}</span>}
          <Blurred><span className={cn('block whitespace-pre-wrap break-words text-[15px] leading-6 text-muted-foreground', !expanded && 'line-clamp-3')}>{goal.lastSummary}</span></Blurred>
        </span>}
      </span>
      <ChevronDown size={20} className={cn('mt-0.5 shrink-0 text-surface-400 transition-transform', expanded && 'rotate-180')} />
    </button>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={working} onClick={() => void run()}><Zap size={15} />Run now</Button>
      {goal.status !== 'done' && <Button variant="outline" size="sm" disabled={working} onClick={() => void update({ status: goal.status === 'active' ? 'paused' : 'active' })}>
        {goal.status === 'active' ? <><Pause size={15} />Pause</> : <><Play size={15} />Resume</>}
      </Button>}
      <Button variant="outline" size="sm" disabled={working} onClick={() => void update({ muted: !goal.muted })}>
        {goal.muted ? <><Bell size={15} />Unmute</> : <><BellOff size={15} />Mute</>}
      </Button>
      <Button variant="outline" size="sm" disabled={working} onClick={onEdit}><Pencil size={15} />Edit</Button>
      <Button variant="ghost" size="sm" disabled={working} onClick={onDelete} className="text-destructive"><Trash2 size={15} />Delete</Button>
    </div>
    {notice && <p role="status" className={cn('mt-3 text-[15px] leading-5', notice.good ? 'text-positive' : 'text-destructive')}>{notice.text}</p>}
    {expanded && <RunList runs={runs} error={runsError} />}
  </Card>
}

function Empty({ onPick }: { onPick: (draft: GoalDraft) => void }): React.ReactElement {
  return <div className="mt-12 flex flex-col items-center px-6 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Target color="#a3a3a3" size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">No goals yet</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">
      A goal is work the agent does on its own, on a schedule or when you ask. It posts what it finds in the Agent chat.
    </p>
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {EXAMPLES.map((example) => <button
        key={example.label}
        type="button"
        onClick={() => onPick(draftFor(example.title, example.instructions, example.trigger))}
        className="rounded-full border border-surface-700 px-3.5 py-2 text-[14px] text-surface-200 transition-colors hover:bg-surface-800 active:bg-surface-800"
      >{example.label}</button>)}
    </div>
  </div>
}

/** Standing goals: what the agent works on by itself, and when. */
export default function Goals(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const back = useBackPath('/ai')
  const [goals, setGoals] = useState<AgentGoal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<AgentGoal | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.agentGoals()
    if (result.ok) {
      setGoals(result.data.goals)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    if (ledger.enabled) void load()
  }, [ledger.enabled, load])

  const remove = async (): Promise<void> => {
    if (!deleting) return
    const gone = deleting
    setBusy(true)
    const result = await ledger.api.deleteAgentGoal(gone.id)
    setBusy(false)
    setDeleting(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') {
      setError(result.error.message)
      return
    }
    setGoals((current) => (current ?? []).filter((item) => item.id !== gone.id))
  }

  const startNew = (draft: GoalDraft = draftFor('', '', BLANK_TRIGGER)): void => setEditing({ goal: null, draft })

  const header = <ScreenHeader
    title="Goals"
    back={back}
    right={ledger.enabled && <Button size="sm" onClick={() => startNew()}><Plus size={16} />New goal</Button>}
  />

  if (!ledger.loaded) {
    return <Screen>
      {header}
      <div className="flex flex-1 items-center justify-center"><Spinner /></div>
    </Screen>
  }

  if (!ledger.enabled) {
    return <Screen>
      {header}
      <CenteredMessage
        Icon={Target}
        title="Sign in to set goals for the agent"
        detail="Sign in once with Google on Home."
        action="Go to sign in"
        onAction={() => navigate('/')}
      />
    </Screen>
  }

  return <Screen>
    {header}
    <ScreenBody className="pb-10">
      <p className="text-[15px] leading-6 text-muted-foreground">
        The agent works on these by itself and posts in the Agent chat. Changes it wants to make wait there for you unless you trust them in Settings.
      </p>
      {error && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{error}</p>}
      {notice && <div role="status" className="mt-3 flex items-start gap-3 rounded-2xl border border-attention/30 bg-attention/10 py-3 pl-4 pr-2">
        <p className="flex-1 text-[15px] leading-6 text-attention">Goal saved. {notice}</p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setNotice(null)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-attention transition-colors hover:bg-attention/15"
        ><X size={16} /></button>
      </div>}
      {goals === null && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {goals !== null && goals.length === 0 && <Empty onPick={startNew} />}
      {goals !== null && goals.length > 0 && <div className="mt-5 flex flex-col gap-3">
        {goals.map((goal) => <GoalRow
          key={goal.id}
          goal={goal}
          onSaved={(saved) => setGoals((current) => (current ?? []).map((item) => item.id === saved.id ? saved : item))}
          onEdit={() => setEditing({ goal, draft: draftFor(goal.title, goal.instructions, goal.trigger) })}
          onDelete={() => setDeleting(goal)}
        />)}
      </div>}
    </ScreenBody>
    {editing && <GoalEditor
      editing={editing}
      onClose={() => setEditing(null)}
      onSaved={(saved) => {
        setEditing(null)
        setNotice(saved.notice ?? null)
        void load()
      }}
    />}
    <ConfirmDialog
      visible={deleting !== null}
      title="Delete this goal?"
      detail="The agent stops working on it. What it already posted stays in the Agent chat."
      confirmLabel="Delete"
      destructive
      busy={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove()}
    />
  </Screen>
}
