import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Bell, BellOff, ChevronRight, ExternalLink, Pause, Pencil, Play, Plus, Target, Trash2, X, Zap } from 'lucide-react-native'
import {
  AGENT_GOAL_INSTRUCTIONS_MAX, AGENT_GOAL_TITLE_MAX,
  type AgentGoal, type AgentGoalUpdate, type AgentRun, type AgentRunStatus, type AgentTrigger
} from '@ego/api-contracts'
import { AGENT_TRIGGER_TYPES, describeTrigger } from '@ego/core'
import { Dot } from '../components/gym/ui'
import { PrivateGate } from '../components/PrivateGate'
import { BottomSheet, Chips, ConfirmDialog, Label, inputClass } from '../components/money/Common'
import { tabular } from '../components/money/tokens'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardHeader, CardTitle } from '../components/ui/card'
import { Text } from '../components/ui/text'
import {
  EVENT_FILTER_MAX, EVENT_PRESETS, GOAL_EXAMPLES, GOAL_STATUS_LABELS, RUN_REASON_LABELS, RUN_STATUS_LABELS, TRIGGER_LABELS, WEEKDAY_LABELS,
  WEEKDAY_VALUES, blankDraft, deviceTimeZone, draftFor, draftTrigger, goalFormValue, momentLabel, runResultLabel, weekdayValue,
  type GoalDraft, type GoalFormValue
} from '../lib/agent'
import { Blurred } from '../lib/blur'
import { useLedger } from '../lib/ledger-context'

type GoalAction = 'run' | 'status' | 'mute'

interface Notice {
  goalId: string
  text: string
  failed: boolean
  sessionUrl: string | null
}

interface FormRequest {
  goal: AgentGoal | null
  draft: GoalDraft
}

const RUN_COLORS: Record<AgentRunStatus, string> = {
  queued: '#737373', running: '#fbbf24', succeeded: '#34d399', failed: '#fb7185'
}

const RECENT_RUNS = 10

const PRESET_SLUGS = EVENT_PRESETS.map((preset) => preset.slug)
const PRESET_LABELS: Record<string, string> = Object.fromEntries(EVENT_PRESETS.map((preset) => [preset.slug, preset.label]))

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function openUrl(url: string): void {
  void Linking.openURL(url).catch(() => undefined)
}

function scheduleLine(goal: AgentGoal): string {
  const when = describeTrigger(goal.trigger)
  return goal.status === 'active' && goal.nextRunAt ? `${when} · Next ${momentLabel(goal.nextRunAt)}` : when
}

function triggerSummary(trigger: AgentTrigger, timeZone: string | null): string {
  if (trigger.type === 'manual') return 'Runs only when you tap Run now or ask for it in chat.'
  if (trigger.type === 'interval' || trigger.type === 'event' || !timeZone) return describeTrigger(trigger)
  return `${describeTrigger(trigger)}, ${timeZone} time`
}

function Counter({ length, max }: { length: number; max: number }): React.ReactElement {
  return <Text className={`text-[14px] ${length >= max ? 'text-attention' : 'text-muted-foreground'}`} style={tabular}>{length}/{max}</Text>
}

function Message({ title, detail, action, onAction }: {
  title: string
  detail: string
  action: string
  onAction: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <Target color="#737373" size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>
  </View>
}

function StatusBadges({ goal }: { goal: AgentGoal }): React.ReactElement {
  return <View className="flex-row gap-1.5">
    <Badge variant={goal.status === 'active' ? 'positive' : 'secondary'}><Text>{GOAL_STATUS_LABELS[goal.status]}</Text></Badge>
    {goal.muted && <Badge variant="outline"><Text>Muted</Text></Badge>}
  </View>
}

function GoalRow({ goal, onPress }: { goal: AgentGoal; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Opens this goal"
    onPress={onPress}
    className="border-t border-surface-800 px-5 py-4 active:bg-surface-900"
  >
    <View className="flex-row items-start gap-3">
      <Text className="flex-1 text-[16px] font-semibold leading-6">{goal.title}</Text>
      <StatusBadges goal={goal} />
    </View>
    <Text className="mt-0.5 text-[14px] leading-5 text-muted-foreground">{scheduleLine(goal)}</Text>
    {goal.lastSummary && <Blurred tint="#e5e5e5">
      <Text numberOfLines={2} className="mt-1.5 text-[15px] leading-5 text-surface-200">{goal.lastSummary}</Text>
    </Blurred>}
  </Pressable>
}

function SessionLink({ url }: { url: string }): React.ReactElement {
  return <Button variant="ghost" size="sm" onPress={() => openUrl(url)} className="mt-1 self-start">
    <ExternalLink color="#d4d4d4" size={16} />
    <Text>Open session</Text>
  </Button>
}

function RunRow({ run }: { run: AgentRun }): React.ReactElement {
  const at = run.finishedAt ?? run.startedAt ?? run.firedAt ?? run.createdAt
  return <View className="border-t border-surface-800 py-3">
    <View className="flex-row items-center">
      <Dot color={RUN_COLORS[run.status]} />
      <Text className="ml-2 text-[15px] font-semibold">{RUN_STATUS_LABELS[run.status]}</Text>
      <Text numberOfLines={1} className="ml-1.5 flex-1 text-[14px] text-muted-foreground">· {RUN_REASON_LABELS[run.reason]}</Text>
    </View>
    <Text className="mt-0.5 text-[14px] text-muted-foreground">{capitalized(momentLabel(at))}</Text>
    {run.summary && <Blurred tint="#e5e5e5">
      <Text className="mt-1.5 text-[15px] leading-5 text-surface-200">{run.summary}</Text>
    </Blurred>}
    {run.sessionUrl && <SessionLink url={run.sessionUrl} />}
  </View>
}

function GoalSheet({ goal, runsKey, busy, notice, error, onRun, onStatus, onMute, onEdit, onDelete, onClose }: {
  goal: AgentGoal | null
  runsKey: number
  busy: GoalAction | null
  notice: Notice | null
  error: string | null
  onRun: (goal: AgentGoal) => void
  onStatus: (goal: AgentGoal) => void
  onMute: (goal: AgentGoal) => void
  onEdit: (goal: AgentGoal) => void
  onDelete: (goal: AgentGoal) => void
  onClose: () => void
}): React.ReactElement {
  const { api } = useLedger()
  const [shown, setShown] = useState<AgentGoal | null>(goal)
  const [runs, setRuns] = useState<AgentRun[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const goalId = goal?.id ?? null
  const view = goal ?? shown

  useEffect(() => { if (goal) setShown(goal) }, [goal])
  useEffect(() => { if (goalId) setRuns(null) }, [goalId])
  useEffect(() => {
    if (!goalId) return
    let active = true
    setRunsError(null)
    void api.agentRuns(goalId).then((result) => {
      if (!active) return
      if (result.ok) setRuns(result.data.runs)
      else setRunsError(result.error.message)
    })
    return () => { active = false }
  }, [api, goalId, runsKey])

  const idle = busy === null
  return <BottomSheet visible={goal !== null} title={view?.title ?? 'Goal'} onClose={onClose} dismissOnBackdrop>
    {view && <>
      <StatusBadges goal={view} />
      <Text className="mt-3 text-[16px]">{describeTrigger(view.trigger)}</Text>
      {view.status === 'active' && view.nextRunAt && <Text className="mt-0.5 text-[15px] text-muted-foreground">Next run {momentLabel(view.nextRunAt)}</Text>}
      {view.lastRunAt && <Text className="mt-0.5 text-[15px] text-muted-foreground">Last run {momentLabel(view.lastRunAt)}</Text>}
      {view.status === 'done' && <Text className="mt-2 text-[15px] leading-5 text-muted-foreground">This goal is finished. Edit when it runs to start it again.</Text>}
      {view.muted && <Text className="mt-2 text-[15px] leading-5 text-muted-foreground">Muted goals still run and post in the Agent chat, without a notification.</Text>}
      <View className="mt-4 rounded-2xl bg-surface-900 p-4">
        <Text className="text-[15px] leading-6 text-surface-200">{view.instructions}</Text>
      </View>

      <Button size="lg" disabled={!idle} onPress={() => onRun(view)} className="mt-4">
        {busy === 'run' ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Zap color="#0a0a0a" size={18} />}
        <Text>{busy === 'run' ? 'Starting...' : 'Run now'}</Text>
      </Button>
      {notice?.goalId === view.id && <View className="mt-3">
        <Text className={`text-[15px] leading-5 ${notice.failed ? 'text-destructive' : 'text-positive'}`}>{notice.text}</Text>
        {notice.sessionUrl && <SessionLink url={notice.sessionUrl} />}
      </View>}
      <View className="mt-3 flex-row gap-3">
        {view.status !== 'done' && <Button variant="outline" disabled={!idle} onPress={() => onStatus(view)} className="flex-1">
          {view.status === 'paused' ? <Play color="#fafafa" size={17} /> : <Pause color="#fafafa" size={17} />}
          <Text>{view.status === 'paused' ? 'Resume' : 'Pause'}</Text>
        </Button>}
        <Button variant="outline" disabled={!idle} onPress={() => onMute(view)} className="flex-1">
          {view.muted ? <Bell color="#fafafa" size={17} /> : <BellOff color="#fafafa" size={17} />}
          <Text>{view.muted ? 'Unmute' : 'Mute'}</Text>
        </Button>
      </View>
      <View className="mt-3 flex-row gap-3">
        <Button variant="outline" disabled={!idle} onPress={() => onEdit(view)} className="flex-1">
          <Pencil color="#fafafa" size={17} />
          <Text>Edit</Text>
        </Button>
        <Button variant="outline" disabled={!idle} onPress={() => onDelete(view)} className="flex-1 border-destructive/40">
          <Trash2 color="#fb7185" size={17} />
          <Text className="text-destructive">Delete</Text>
        </Button>
      </View>
      {error && <Text className="mt-3 text-[15px] leading-5 text-destructive">{error}</Text>}

      <Text accessibilityRole="header" className="mb-1 mt-7 text-[18px] font-semibold">Recent runs</Text>
      {runs === null
        ? runsError
          ? <Text className="text-[15px] leading-5 text-destructive">{runsError}</Text>
          : <ActivityIndicator color="#fafafa" className="self-start py-2" />
        : runs.length === 0
          ? <Text className="text-[15px] text-muted-foreground">No runs yet.</Text>
          : runs.slice(0, RECENT_RUNS).map((run) => <RunRow key={run.id} run={run} />)}
    </>}
  </BottomSheet>
}

function PatternInput({ label, value, placeholder, maxLength, onChange }: {
  label: string
  value: string
  placeholder: string
  maxLength: number
  onChange: (value: string) => void
}): React.ReactElement {
  return <Label text={label}>
    <TextInput
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor="#737373"
      keyboardType="numbers-and-punctuation"
      autoCorrect={false}
      maxLength={maxLength}
      className={inputClass}
    />
  </Label>
}

function GoalForm({ request, busy, error, onSave, onClose }: {
  request: FormRequest | null
  busy: boolean
  error: string | null
  onSave: (goal: AgentGoal | null, value: GoalFormValue) => void
  onClose: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<GoalDraft>(() => request?.draft ?? blankDraft())
  const [goal, setGoal] = useState<AgentGoal | null>(request?.goal ?? null)
  useEffect(() => {
    if (!request) return
    setDraft(request.draft)
    setGoal(request.goal)
  }, [request])

  const patch = (change: Partial<GoalDraft>): void => setDraft((current) => ({ ...current, ...change }))
  const trigger = draftTrigger(draft)
  const value = goalFormValue(draft)
  const canSave = !busy && typeof value !== 'string'
  const save = (): void => { if (canSave) onSave(goal, value) }
  const timed = draft.type === 'daily' || draft.type === 'weekdays' || draft.type === 'weekly' || draft.type === 'once'

  return <BottomSheet visible={request !== null} title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
    <Label text="Title">
      <TextInput
        value={draft.title}
        onChangeText={(title) => patch({ title })}
        accessibilityLabel="Title"
        placeholder="Weekday brief"
        placeholderTextColor="#737373"
        maxLength={AGENT_GOAL_TITLE_MAX}
        className={inputClass}
      />
      <View className="mt-2 flex-row justify-end"><Counter length={draft.title.length} max={AGENT_GOAL_TITLE_MAX} /></View>
    </Label>
    <Label text="What to do each time">
      <TextInput
        value={draft.instructions}
        onChangeText={(instructions) => patch({ instructions })}
        accessibilityLabel="What to do each time"
        placeholder="Look at today's calendar and tasks, then post a short brief"
        placeholderTextColor="#737373"
        multiline
        textAlignVertical="top"
        maxLength={AGENT_GOAL_INSTRUCTIONS_MAX}
        className={`${inputClass} min-h-[140px] leading-6`}
      />
      <View className="mt-2 flex-row justify-end"><Counter length={draft.instructions.length} max={AGENT_GOAL_INSTRUCTIONS_MAX} /></View>
    </Label>
    <Label text="When">
      <Chips values={AGENT_TRIGGER_TYPES} value={draft.type} labels={TRIGGER_LABELS} onChange={(type) => patch({ type })} />
    </Label>
    {draft.type === 'weekly' && <Label text="Day">
      <Chips values={WEEKDAY_VALUES} value={weekdayValue(draft.weekday)} labels={WEEKDAY_LABELS} onChange={(day) => patch({ weekday: Number(day) })} />
    </Label>}
    {draft.type === 'once' && <PatternInput label="Date" value={draft.date} placeholder="YYYY-MM-DD" maxLength={10} onChange={(date) => patch({ date })} />}
    {timed && <PatternInput label="Time" value={draft.time} placeholder="HH:MM" maxLength={5} onChange={(time) => patch({ time })} />}
    {draft.type === 'interval' && <Label text="Hours between runs">
      <TextInput
        value={draft.hours}
        onChangeText={(hours) => patch({ hours })}
        accessibilityLabel="Hours between runs"
        placeholder="24"
        placeholderTextColor="#737373"
        keyboardType="number-pad"
        maxLength={3}
        className={inputClass}
      />
    </Label>}
    {draft.type === 'event' && <>
      <Label text="Trigger">
        <TextInput
          value={draft.event}
          onChangeText={(event) => patch({ event: event.toUpperCase() })}
          accessibilityLabel="Trigger"
          placeholder="GMAIL_NEW_GMAIL_MESSAGE"
          placeholderTextColor="#737373"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={100}
          className={`${inputClass} font-mono`}
        />
        <View className="mt-3">
          <Chips values={PRESET_SLUGS} value={draft.event.trim()} labels={PRESET_LABELS} onChange={(event) => patch({ event })} />
        </View>
        <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">Trigger names come from Composio. Connect the app first by asking the chat.</Text>
      </Label>
      <Label text="Only when it mentions">
        <TextInput
          value={draft.filter}
          onChangeText={(filter) => patch({ filter })}
          accessibilityLabel="Only when it mentions"
          placeholder="Optional, like invoice"
          placeholderTextColor="#737373"
          autoCapitalize="none"
          maxLength={EVENT_FILTER_MAX}
          className={inputClass}
        />
      </Label>
    </>}
    <Text className={`text-[15px] leading-5 ${typeof trigger === 'string' ? 'text-attention' : 'text-muted-foreground'}`}>
      {typeof trigger === 'string' ? trigger : triggerSummary(trigger, goal?.timeZone ?? deviceTimeZone())}
    </Text>
    {typeof value === 'string' && typeof trigger !== 'string' && <Text className="mt-4 text-[15px] leading-5 text-muted-foreground">{value}</Text>}
    {error && <Text className="mt-4 text-[15px] leading-5 text-destructive">{error}</Text>}
    <Button size="lg" disabled={!canSave} onPress={save} className="mt-5">
      <Text>{busy ? 'Saving...' : goal ? 'Save' : 'Add goal'}</Text>
    </Button>
  </BottomSheet>
}

function EmptyGoals({ onPick }: { onPick: (draft: GoalDraft) => void }): React.ReactElement {
  return <Card className="items-center px-6 py-10">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Target color="#a3a3a3" size={30} /></View>
    <Text className="mt-4 text-center text-[18px] font-semibold">No goals yet</Text>
    <Text className="mt-2 text-center text-[15px] leading-6 text-muted-foreground">A goal is a standing job the agent does on its own. It posts the results in the Agent chat. Start from an example or write your own.</Text>
    <View className="mt-5 w-full gap-2">
      {GOAL_EXAMPLES.map((example) => <Pressable
        key={example.label}
        accessibilityRole="button"
        accessibilityHint="Fills in the new goal form"
        onPress={() => onPick({ ...blankDraft(), ...example.draft })}
        className="min-h-14 flex-row items-center rounded-2xl bg-surface-900 px-4 active:bg-surface-800"
      >
        <Zap color="#d4d4d4" size={18} />
        <Text className="ml-3 flex-1 text-[16px] font-medium">{example.label}</Text>
        <ChevronRight color="#a3a3a3" size={18} />
      </Pressable>)}
    </View>
  </Card>
}

export default function GoalsScreen(): React.ReactElement {
  return <PrivateGate label="Goals"><Goals /></PrivateGate>
}

function Goals(): React.ReactElement {
  const ledger = useLedger()
  const { api } = ledger
  const router = useRouter()
  const [goals, setGoals] = useState<AgentGoal[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<GoalAction | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [runsKey, setRunsKey] = useState(0)
  const [form, setForm] = useState<FormRequest | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AgentGoal | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const selected = goals?.find((goal) => goal.id === selectedId) ?? null

  useFocusEffect(useCallback(() => {
    if (!ledger.enabled) return
    let active = true
    setLoadError(null)
    void api.agentGoals().then((result) => {
      if (!active) return
      if (result.ok) setGoals(result.data.goals)
      else setLoadError(result.error.message)
    })
    return () => { active = false }
  }, [api, ledger.enabled, attempt]))

  if (!ledger.enabled) {
    return <Message
      title="Sign in to set goals"
      detail="Sign in once with Google on the start screen. Goals then run in the background and post in the Agent chat."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }

  const keep = (goal: AgentGoal): void => {
    setGoals((current) => {
      if (!current) return [goal]
      return current.some((item) => item.id === goal.id)
        ? current.map((item) => item.id === goal.id ? goal : item)
        : [goal, ...current]
    })
  }

  const forget = (id: string): void => {
    setGoals((current) => current?.filter((item) => item.id !== id) ?? null)
  }

  const openGoal = (goal: AgentGoal): void => {
    setSheetError(null)
    setNotice(null)
    setSelectedId(goal.id)
  }

  const startForm = (goal: AgentGoal | null, draft: GoalDraft): void => {
    setFormError(null)
    setForm({ goal, draft })
  }

  const change = async (goal: AgentGoal, update: AgentGoalUpdate, action: GoalAction): Promise<void> => {
    setBusy(action)
    setSheetError(null)
    const result = await api.updateAgentGoal(goal.id, update)
    setBusy(null)
    if (result.ok) {
      const { notice: warning, ...saved } = result.data
      keep(saved)
      if (warning) setNotice({ goalId: saved.id, text: warning, failed: true, sessionUrl: null })
    } else if (result.error.code === 'NOT_FOUND') {
      forget(goal.id)
      setSelectedId(null)
      setListError(result.error.message)
    } else setSheetError(result.error.message)
  }

  const run = async (goal: AgentGoal): Promise<void> => {
    setBusy('run')
    setSheetError(null)
    setNotice(null)
    const result = await api.runAgentGoal(goal.id)
    setBusy(null)
    setNotice(result.ok
      ? { goalId: goal.id, text: runResultLabel(result.data), failed: result.data.error !== null, sessionUrl: result.data.sessionUrl }
      : { goalId: goal.id, text: result.error.message, failed: true, sessionUrl: null })
    setRunsKey((current) => current + 1)
  }

  const save = async (goal: AgentGoal | null, value: GoalFormValue): Promise<void> => {
    setSaving(true)
    setFormError(null)
    const result = goal
      ? await api.updateAgentGoal(goal.id, value)
      : await api.createAgentGoal({ ...value, timeZone: deviceTimeZone() })
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    const { notice: warning, ...saved } = result.data
    keep(saved)
    setForm(null)
    if (goal || warning) openGoal(saved)
    if (warning) setNotice({ goalId: saved.id, text: warning, failed: true, sessionUrl: null })
  }

  const closeForm = (): void => {
    const editing = form?.goal ?? null
    setForm(null)
    if (editing) openGoal(editing)
  }

  const remove = async (): Promise<void> => {
    if (!deleting) return
    const target = deleting
    setDeleteBusy(true)
    const result = await api.deleteAgentGoal(target.id)
    setDeleteBusy(false)
    setDeleting(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') {
      setListError(result.error.message)
      return
    }
    forget(target.id)
  }

  return <View className="flex-1 bg-background">
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
      {listError && <Pressable
        accessibilityRole="button"
        accessibilityHint="Dismisses this message"
        onPress={() => setListError(null)}
        className="flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
      >
        <Text className="flex-1 text-[15px] leading-5 text-destructive">{listError}</Text>
        <X color="#fb7185" size={16} />
      </Pressable>}

      {goals === null
        ? <Card className="items-center p-8">
          {loadError
            ? <>
              <Text className="text-center text-[15px] leading-5 text-destructive">{loadError}</Text>
              <Button variant="outline" onPress={() => setAttempt((current) => current + 1)} className="mt-4"><Text>Try again</Text></Button>
            </>
            : <ActivityIndicator color="#fafafa" />}
        </Card>
        : <>
          <Button size="lg" onPress={() => startForm(null, blankDraft())}>
            <Plus color="#0a0a0a" size={18} />
            <Text>New goal</Text>
          </Button>
          {goals.length === 0
            ? <EmptyGoals onPick={(draft) => startForm(null, draft)} />
            : <Card className="overflow-hidden">
              <CardHeader className="pb-4">
                <CardTitle>{goals.length === 1 ? '1 goal' : `${goals.length} goals`}</CardTitle>
                <Text className="text-[14px] leading-5 text-muted-foreground">The agent works on these in the background and posts in the Agent chat.</Text>
              </CardHeader>
              {goals.map((goal) => <GoalRow key={goal.id} goal={goal} onPress={() => openGoal(goal)} />)}
            </Card>}
        </>}
    </ScrollView>

    <GoalSheet
      goal={selected}
      runsKey={runsKey}
      busy={busy}
      notice={notice}
      error={sheetError}
      onRun={(goal) => void run(goal)}
      onStatus={(goal) => void change(goal, { status: goal.status === 'paused' ? 'active' : 'paused' }, 'status')}
      onMute={(goal) => void change(goal, { muted: !goal.muted }, 'mute')}
      onEdit={(goal) => {
        setSelectedId(null)
        startForm(goal, draftFor(goal))
      }}
      onDelete={(goal) => {
        setSelectedId(null)
        setDeleting(goal)
      }}
      onClose={() => setSelectedId(null)}
    />
    <GoalForm
      request={form}
      busy={saving}
      error={formError}
      onSave={(goal, value) => void save(goal, value)}
      onClose={closeForm}
    />
    <ConfirmDialog
      visible={deleting !== null}
      title={`Delete ${deleting?.title ?? 'this goal'}?`}
      detail="The agent stops working on it and runs that have not started are canceled. What it already posted stays in the Agent chat."
      confirmLabel="Delete"
      destructive
      busy={deleteBusy}
      hideNavigation={false}
      onCancel={() => {
        const target = deleting
        setDeleting(null)
        if (target) openGoal(target)
      }}
      onConfirm={() => void remove()}
    />
  </View>
}
