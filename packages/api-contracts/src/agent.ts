import { isAgentTrigger, type AgentDevices, type AgentSettings, type AgentTrigger } from '@ego/core'

export type { AgentDevices, AgentSettings, AgentTrigger, AgentTriggerInput, AgentTriggerType } from '@ego/core'

/** Every MCP key starts with this, so the Worker can tell one from a device token at a glance. */
export const AGENT_KEY_PREFIX = 'egomcp_'

/** Where Claude reaches Ego's tools, on the Worker's own address. */
export const MCP_PATH = '/mcp'

export const AGENT_MEMORY_MAX_CHARS = 300
/** The chat reads every note on each turn, so the list stays short enough to fit. */
export const AGENT_MEMORY_MAX_NOTES = 200
export const AGENT_KEY_NAME_MAX = 80

export interface AgentKeySummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface AgentKeyList {
  keys: AgentKeySummary[]
  /** The address to paste into a claude.ai custom connector. */
  mcpUrl: string
}

/** `token` is shown once. The Worker keeps only its hash. */
export interface AgentKeyCreated {
  key: AgentKeySummary
  token: string
  mcpUrl: string
}

/** Who wrote a note: the in-app chat, Claude over MCP, or the user in Memory. */
export type AgentMemorySource = 'chat' | 'agent' | 'user'

export interface AgentMemory {
  id: string
  text: string
  source: AgentMemorySource
  createdAt: string
  updatedAt: string
}

export interface AgentMemoryList {
  memories: AgentMemory[]
}

export interface AgentMemoryInput {
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAgentMemoryInput(value: unknown): value is AgentMemoryInput {
  return isRecord(value) && typeof value.text === 'string'
}

export type AgentGoalStatus = 'active' | 'paused' | 'done'

export interface AgentGoal {
  id: string
  title: string
  /** What the agent does each run, in plain words. */
  instructions: string
  trigger: AgentTrigger
  status: AgentGoalStatus
  /** A muted goal still runs and posts, but sends no notification. */
  muted: boolean
  timeZone: string
  /** The next time the goal is due on its own, or null for manual goals and finished ones. */
  nextRunAt: string | null
  lastRunAt: string | null
  lastSummary: string | null
  createdAt: string
  updatedAt: string
  /** Set on a freshly saved event goal when its Composio trigger could not be turned on. */
  notice?: string
}

export interface AgentGoalList {
  goals: AgentGoal[]
}

export interface AgentGoalInput {
  title: string
  instructions: string
  trigger: AgentTrigger
  muted?: boolean
  timeZone?: string | null
}

export interface AgentGoalUpdate {
  title?: string
  instructions?: string
  trigger?: AgentTrigger
  status?: 'active' | 'paused'
  muted?: boolean
}

export type AgentRunReason = 'schedule' | 'now' | 'delegate' | 'event'
export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface AgentRun {
  id: string
  goalId: string
  goalTitle: string
  reason: AgentRunReason
  status: AgentRunStatus
  /** For a goal with a set time: the minute its message should reach the user. */
  deliverAt: string | null
  summary: string | null
  /** The Claude Code session that ran it, when the routine said. */
  sessionUrl: string | null
  createdAt: string
  firedAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface AgentRunList {
  runs: AgentRun[]
}

export interface AgentRoutineStatus {
  /** The Worker holds the routine's fire URL and token. */
  configured: boolean
  lastFiredAt: string | null
  lastError: string | null
}

export interface AgentSettingsView {
  settings: AgentSettings
  routine: AgentRoutineStatus
  timeZone: string
}

export interface AgentFireResult {
  fired: boolean
  runs: number
  sessionUrl: string | null
  error: string | null
}

/** One change the agent asked for, waiting in the Agent chat for Confirm or Reject. */
export interface AgentProposal {
  id: string
  chatId: string
  goalTitle: string | null
  title: string
  changes: Array<{ toolName: string; title: string; lines: string[] }>
  createdAt: string
  expiresAt: string
}

export interface AgentProposalAnswer {
  approved: boolean
}

export interface AgentInbox {
  chatId: string
  unread: number
  proposals: number
}

export interface AgentNotification {
  id: string
  chatId: string
  title: string
  body: string
  /** When to show it. Later than createdAt for quiet hours and goals with a set time. */
  deliverAt: string
  /** Over the daily cap, or from a muted goal: listed, never shown. */
  silent: boolean
  createdAt: string
}

export interface AgentNotificationPage {
  notifications: AgentNotification[]
  /** Pass back as `after` to get only newer ones. */
  cursor: string | null
  devices: AgentDevices
}

export const AGENT_GOAL_TITLE_MAX = 80
export const AGENT_GOAL_INSTRUCTIONS_MAX = 4000
export const AGENT_GOALS_MAX = 50
export const AGENT_MESSAGE_MAX = 4000

export function isAgentGoalInput(value: unknown): value is AgentGoalInput {
  return isRecord(value) && typeof value.title === 'string' && typeof value.instructions === 'string' &&
    isAgentTrigger(value.trigger) && (value.muted === undefined || typeof value.muted === 'boolean') &&
    (value.timeZone === undefined || value.timeZone === null || typeof value.timeZone === 'string')
}

export function isAgentGoalUpdate(value: unknown): value is AgentGoalUpdate {
  if (!isRecord(value)) return false
  return (value.title === undefined || typeof value.title === 'string') &&
    (value.instructions === undefined || typeof value.instructions === 'string') &&
    (value.trigger === undefined || isAgentTrigger(value.trigger)) &&
    (value.status === undefined || value.status === 'active' || value.status === 'paused') &&
    (value.muted === undefined || typeof value.muted === 'boolean')
}

export function isAgentProposalAnswer(value: unknown): value is AgentProposalAnswer {
  return isRecord(value) && typeof value.approved === 'boolean'
}

/** The Worker's VAPID public key for PushManager.subscribe, or null when Web Push is not set up. */
export interface WebPushKey {
  publicKey: string | null
}

/** What PushSubscription.toJSON() gives, minus expirationTime. */
export interface WebPushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface WebPushTestResult {
  sent: number
  failed: number
}

export function isWebPushSubscriptionInput(value: unknown): value is WebPushSubscriptionInput {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || !isRecord(value.keys)) return false
  return value.endpoint.startsWith('https://') && value.endpoint.length <= 1000 &&
    typeof value.keys.p256dh === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(value.keys.p256dh) &&
    typeof value.keys.auth === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(value.keys.auth)
}

export interface ComposioStatus {
  /** The Worker holds a Composio API key, so the chat can reach other apps. */
  configured: boolean
  /** The Worker holds the webhook secret, so event goals can start. */
  webhookReady: boolean
  /** Where the Composio webhook subscription should point. */
  webhookUrl: string
}
