import { ASSISTANT_TOOLS, localMoment, planDelivery, zonedTime, type AssistantToolName, type PendingWrite } from '@ego/core'
import type {
  AgentInbox, AgentNotification, AgentNotificationPage, AgentProposal, AssistantMessage, DeviceIdentity
} from '@ego/api-contracts'
import { agentTimeZone, readAgentSettings, updateAgentSettings } from './agent-settings'
import { describeWrite, executeAssistantWrite, type ToolContext, type WriteCard } from './assistant-tools'
import type { Env } from './auth'
import { localDate } from './google-health'
import { query } from './reads'

export const AGENT_CHAT_TITLE = 'Agent'
const NOTIFICATION_BODY_MAX = 180
const NOTIFICATION_PAGE = 50
const DAY_MS = 86_400_000

interface ProposalRow {
  call_id: string
  chat_id: string
  tool_name: string
  arguments: string
  card: string | null
  created_at: string
  batch_id: string
  expires_at: string
}

interface NotificationRow {
  id: string
  chat_id: string
  title: string
  body: string
  deliver_at: string
  silent: number
  created_at: string
}

interface StoredCard extends WriteCard {
  goalTitle?: string | null
  proposalTitle?: string
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** The one pinned chat the agent posts into. Made the first time anything asks for it. */
export async function ensureAgentChat(db: D1Database, datasetId: string, now: string): Promise<string> {
  const find = (): Promise<{ id: string } | null> => db.prepare(`SELECT id FROM assistant_chats
    WHERE dataset_id = ? AND kind = 'agent' AND deleted_at IS NULL`).bind(datasetId).first<{ id: string }>()
  const existing = await find()
  if (existing) return existing.id
  await db.prepare(`INSERT OR IGNORE INTO assistant_chats (id, dataset_id, title, created_at, updated_at, kind)
    VALUES (?, ?, ?, ?, ?, 'agent')`).bind(crypto.randomUUID(), datasetId, AGENT_CHAT_TITLE, now, now).run()
  const made = await find()
  if (!made) throw new Error('The Agent chat could not be made')
  return made.id
}

/** A ToolContext for writes the agent makes or the user confirms, on the clock the apps last sent. */
export async function agentToolContext(env: Env, device: DeviceIdentity, now: string): Promise<ToolContext> {
  const settings = await readAgentSettings(env.DB, device.datasetId)
  const timeZone = agentTimeZone(settings)
  return { env, device, now, today: localDate(Date.parse(now), timeZone), timeZone, units: settings.units }
}

export interface NotifyOptions {
  urgent: boolean
  muted: boolean
  /** The earliest the notification may show, for goals with a set time. */
  notBefore: string | null
}

async function shownToday(db: D1Database, datasetId: string, timeZone: string, nowMs: number): Promise<number> {
  const dayStart = new Date(zonedTime(localMoment(nowMs, timeZone).date, '00:00', timeZone)).toISOString()
  const rows = await query<{ count: number }>(db, `SELECT COUNT(*) AS count FROM agent_notifications
    WHERE dataset_id = ? AND silent = 0 AND deliver_at >= ?`, [datasetId, dayStart])
  return rows[0]?.count ?? 0
}

/** Queues a notification for every device, applying quiet hours, the daily cap, and mute. */
export async function createNotification(env: Env, input: {
  datasetId: string
  chatId: string
  messageId: string | null
  goalId: string | null
  title: string
  body: string
  now: string
  options: NotifyOptions
}): Promise<AgentNotification> {
  const settings = await readAgentSettings(env.DB, input.datasetId)
  const timeZone = agentTimeZone(settings)
  const nowMs = Date.parse(input.now)
  const requestedMs = Math.max(nowMs, input.options.notBefore ? Date.parse(input.options.notBefore) : nowMs)
  const plan = planDelivery({
    requestedMs, urgent: input.options.urgent, muted: input.options.muted,
    shownToday: await shownToday(env.DB, input.datasetId, timeZone, requestedMs), settings, timeZone
  })
  const row: NotificationRow = {
    id: crypto.randomUUID(), chat_id: input.chatId, title: clip(input.title, 80), body: clip(input.body, NOTIFICATION_BODY_MAX),
    deliver_at: new Date(plan.deliverMs).toISOString(), silent: plan.silent ? 1 : 0, created_at: input.now
  }
  await env.DB.prepare(`INSERT INTO agent_notifications (id, dataset_id, chat_id, message_id, goal_id, title, body, deliver_at, silent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, input.datasetId, row.chat_id, input.messageId, input.goalId, row.title, row.body, row.deliver_at, row.silent, row.created_at).run()
  return toNotification(row)
}

function toNotification(row: NotificationRow): AgentNotification {
  return {
    id: row.id, chatId: row.chat_id, title: row.title, body: row.body, deliverAt: row.deliver_at,
    silent: row.silent === 1, createdAt: row.created_at
  }
}

function cursorOf(row: Pick<NotificationRow, 'created_at' | 'id'>): string {
  return `${row.created_at}|${row.id}`
}

/**
 * Notifications made after `after`. A device with no cursor yet gets none, only the cursor to
 * start from, so a new sign-in does not replay old messages.
 */
export async function listNotifications(env: Env, datasetId: string, after: string | null): Promise<AgentNotificationPage> {
  const settings = await readAgentSettings(env.DB, datasetId)
  if (!after) {
    const latest = await query<NotificationRow>(env.DB, `SELECT * FROM agent_notifications WHERE dataset_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1`, [datasetId])
    return { notifications: [], cursor: latest[0] ? cursorOf(latest[0]) : null, devices: settings.devices }
  }
  const [createdAt, id = ''] = after.split('|')
  const rows = await query<NotificationRow>(env.DB, `SELECT * FROM agent_notifications WHERE dataset_id = ?
    AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT ?`,
  [datasetId, createdAt, createdAt, id, NOTIFICATION_PAGE])
  const last = rows[rows.length - 1]
  return { notifications: rows.map(toNotification), cursor: last ? cursorOf(last) : after, devices: settings.devices }
}

export interface AgentPost {
  datasetId: string
  text: string
  goalId: string | null
  goalTitle: string | null
  trail?: string[]
  now: string
  /** Null posts without a notification. */
  notify: NotifyOptions | null
}

/** Puts a message from the agent in the Agent chat, and notifies when asked to. */
export async function postAgentMessage(env: Env, post: AgentPost): Promise<AssistantMessage> {
  const chatId = await ensureAgentChat(env.DB, post.datasetId, post.now)
  const id = crypto.randomUUID()
  const trail = post.trail ?? []
  await env.DB.prepare(`INSERT INTO assistant_messages (id, chat_id, seq, role, shown, text, payload, trail, has_image, created_at, goal_id)
    SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, 'assistant', 1, ?, ?, ?, 0, ?, ? FROM assistant_messages WHERE chat_id = ?`)
    .bind(id, chatId, post.text, JSON.stringify({ role: 'assistant', content: post.text }), JSON.stringify(trail), post.now, post.goalId, chatId)
    .run()
  await env.DB.prepare('UPDATE assistant_chats SET updated_at = ? WHERE id = ?').bind(post.now, chatId).run()
  const row = await env.DB.prepare('SELECT seq FROM assistant_messages WHERE id = ?').bind(id).first<{ seq: number }>()
  if (post.notify) {
    await createNotification(env, {
      datasetId: post.datasetId, chatId, messageId: id, goalId: post.goalId,
      title: post.goalTitle ?? AGENT_CHAT_TITLE, body: post.text, now: post.now, options: post.notify
    })
  }
  return {
    id, chatId, seq: row?.seq ?? 0, role: 'assistant', text: post.text, createdAt: post.now, trail, hasImage: false, undo: [],
    agent: { goalId: post.goalId, goalTitle: post.goalTitle }
  }
}

async function cardFor(ctx: ToolContext, write: PendingWrite): Promise<WriteCard> {
  try {
    return await describeWrite(ctx, write.name, write.args)
  } catch {
    return { title: ASSISTANT_TOOLS[write.name].description.split('.')[0], lines: [] }
  }
}

export interface ProposalOutcome {
  applied: Array<{ tool: AssistantToolName; trail: string; failed: boolean }>
  proposalId: string | null
  waiting: number
}

/**
 * The agent's changes to the user's data. Tools the user trusts apply at once and leave a note in
 * the Agent chat; the rest wait there on one card for Confirm or Reject.
 */
export async function proposeChanges(env: Env, ctx: ToolContext, input: {
  writes: PendingWrite[]
  goalId: string | null
  goalTitle: string | null
  muted: boolean
}): Promise<ProposalOutcome> {
  const datasetId = ctx.device.datasetId
  const settings = await readAgentSettings(env.DB, datasetId)
  const trusted = new Set(settings.trusted)
  const now = ctx.now
  const outcome: ProposalOutcome = { applied: [], proposalId: null, waiting: 0 }
  const direct = input.writes.filter((write) => trusted.has(write.name))
  const waiting = input.writes.filter((write) => !trusted.has(write.name))
  for (const write of direct) {
    try {
      const result = await executeAssistantWrite(ctx, { name: write.name, args: write.args, callId: write.callId })
      outcome.applied.push({ tool: write.name, trail: result.trail, failed: result.failed })
    } catch (error: unknown) {
      outcome.applied.push({ tool: write.name, trail: error instanceof Error ? error.message : 'The change failed', failed: true })
    }
  }
  if (outcome.applied.length > 0) {
    await postAgentMessage(env, {
      datasetId, goalId: input.goalId, goalTitle: input.goalTitle, now, notify: null,
      text: outcome.applied.every((item) => !item.failed) ? 'Done.' : 'Some of this did not save.',
      trail: outcome.applied.map((item) => item.trail)
    })
  }
  if (waiting.length === 0) return outcome
  const chatId = await ensureAgentChat(env.DB, datasetId, now)
  const batchId = crypto.randomUUID()
  const expiresAt = new Date(Date.parse(now) + settings.proposalDays * DAY_MS).toISOString()
  const titles: string[] = []
  for (const [index, write] of waiting.entries()) {
    const card: StoredCard = { ...await cardFor(ctx, write), goalTitle: input.goalTitle }
    titles.push(card.title)
    await env.DB.prepare(`INSERT INTO assistant_tool_calls
      (call_id, chat_id, message_id, tool_call_id, tool_name, arguments, status, label, undo, card, created_at, resolved_at, batch_id, expires_at)
      VALUES (?, ?, NULL, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), chatId, `agent-${batchId}-${index}`, write.name, JSON.stringify(write.args), JSON.stringify(card), now, batchId, expiresAt)
      .run()
  }
  await env.DB.prepare('UPDATE assistant_chats SET updated_at = ? WHERE id = ?').bind(now, chatId).run()
  await createNotification(env, {
    datasetId, chatId, messageId: null, goalId: input.goalId, title: 'Needs your OK', body: titles.join(', '), now,
    options: { urgent: false, muted: input.muted, notBefore: null }
  })
  outcome.proposalId = batchId
  outcome.waiting = waiting.length
  return outcome
}

function proposalTitle(cards: readonly StoredCard[]): string {
  return cards.length === 1 ? cards[0].title : `${cards.length} changes`
}

function groupProposals(rows: readonly ProposalRow[]): AgentProposal[] {
  const batches = new Map<string, ProposalRow[]>()
  for (const row of rows) batches.set(row.batch_id, [...(batches.get(row.batch_id) ?? []), row])
  return [...batches.values()].map((batch) => {
    const cards = batch.map((row) => parseJson<StoredCard>(row.card, { title: row.tool_name, lines: [] }))
    return {
      id: batch[0].batch_id,
      chatId: batch[0].chat_id,
      goalTitle: cards[0].goalTitle ?? null,
      title: proposalTitle(cards),
      changes: batch.map((row, index) => ({ toolName: row.tool_name, title: cards[index].title, lines: cards[index].lines })),
      createdAt: batch[0].created_at,
      expiresAt: batch[0].expires_at
    }
  })
}

/** The Agent chat's open proposals, oldest first. */
export async function listProposals(db: D1Database, chatId: string): Promise<AgentProposal[]> {
  const rows = await query<ProposalRow>(db, `SELECT call_id, chat_id, tool_name, arguments, card, created_at, batch_id, expires_at
    FROM assistant_tool_calls WHERE chat_id = ? AND batch_id IS NOT NULL AND status = 'pending' AND resolved_at IS NULL
    ORDER BY created_at, rowid`, [chatId])
  return groupProposals(rows)
}

/** Takes a whole proposal in one statement, so a double tap cannot save it twice. */
async function claimProposal(db: D1Database, chatId: string, batchId: string, now: string): Promise<ProposalRow[]> {
  const rows = await query<ProposalRow & { position: number }>(db, `UPDATE assistant_tool_calls SET resolved_at = ?
    WHERE chat_id = ? AND batch_id = ? AND status = 'pending' AND resolved_at IS NULL
    RETURNING call_id, chat_id, tool_name, arguments, card, created_at, batch_id, expires_at, rowid AS position`, [now, chatId, batchId])
  return rows.sort((left, right) => left.position - right.position)
}

/** Confirm saves every change on the card in order; Reject drops them all. Either way a note says so. */
export async function answerProposal(env: Env, ctx: ToolContext, batchId: string, approved: boolean): Promise<AssistantMessage | null> {
  const datasetId = ctx.device.datasetId
  const chatId = await ensureAgentChat(env.DB, datasetId, ctx.now)
  const rows = await claimProposal(env.DB, chatId, batchId, ctx.now)
  if (rows.length === 0) return null
  const cards = rows.map((row) => parseJson<StoredCard>(row.card, { title: row.tool_name, lines: [] }))
  const goalTitle = cards[0].goalTitle ?? null
  if (!approved) {
    await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'rejected' WHERE chat_id = ? AND batch_id = ?`).bind(chatId, batchId).run()
    return postAgentMessage(env, { datasetId, goalId: null, goalTitle, now: ctx.now, notify: null, text: `Rejected: ${proposalTitle(cards)}` })
  }
  const trail: string[] = []
  let failed = false
  for (const row of rows) {
    const name = row.tool_name as AssistantToolName
    try {
      const result = await executeAssistantWrite(ctx, { name, args: parseJson<Record<string, unknown>>(row.arguments, {}), callId: row.call_id })
      await env.DB.prepare('UPDATE assistant_tool_calls SET status = ? WHERE call_id = ?').bind(result.failed ? 'failed' : 'succeeded', row.call_id).run()
      trail.push(result.trail)
      failed ||= result.failed
    } catch (error: unknown) {
      await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'failed' WHERE call_id = ?`).bind(row.call_id).run()
      trail.push(error instanceof Error ? error.message : 'The change could not be saved')
      failed = true
    }
  }
  return postAgentMessage(env, {
    datasetId, goalId: null, goalTitle, now: ctx.now, notify: null, trail,
    text: failed ? `Some of this did not save: ${proposalTitle(cards)}` : `Saved: ${proposalTitle(cards)}`
  })
}

/** Proposals nobody answered in time are dropped, each with a note in the Agent chat. */
export async function expireProposals(env: Env, now: string): Promise<number> {
  const due = await query<{ batch_id: string; chat_id: string; dataset_id: string }>(env.DB, `SELECT DISTINCT t.batch_id, t.chat_id, c.dataset_id
    FROM assistant_tool_calls t JOIN assistant_chats c ON c.id = t.chat_id
    WHERE t.batch_id IS NOT NULL AND t.status = 'pending' AND t.resolved_at IS NULL AND t.expires_at <= ?`, [now])
  for (const batch of due) {
    const rows = await claimProposal(env.DB, batch.chat_id, batch.batch_id, now)
    if (rows.length === 0) continue
    await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'rejected', label = 'expired' WHERE chat_id = ? AND batch_id = ?`)
      .bind(batch.chat_id, batch.batch_id).run()
    const cards = rows.map((row) => parseJson<StoredCard>(row.card, { title: row.tool_name, lines: [] }))
    await postAgentMessage(env, {
      datasetId: batch.dataset_id, goalId: null, goalTitle: cards[0].goalTitle ?? null, now, notify: null,
      text: `Expired without an answer: ${proposalTitle(cards)}`
    })
  }
  return due.length
}

export async function agentInbox(env: Env, datasetId: string, now: string): Promise<AgentInbox> {
  const chatId = await ensureAgentChat(env.DB, datasetId, now)
  const settings = await readAgentSettings(env.DB, datasetId)
  const [unread, open] = await Promise.all([
    query<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM assistant_messages
      WHERE chat_id = ? AND role = 'assistant' AND shown = 1 AND created_at > ?`, [chatId, settings.readAt ?? '']),
    query<{ count: number }>(env.DB, `SELECT COUNT(DISTINCT batch_id) AS count FROM assistant_tool_calls
      WHERE chat_id = ? AND batch_id IS NOT NULL AND status = 'pending' AND resolved_at IS NULL`, [chatId])
  ])
  return { chatId, unread: unread[0]?.count ?? 0, proposals: open[0]?.count ?? 0 }
}

export async function markAgentRead(env: Env, datasetId: string, now: string): Promise<AgentInbox> {
  await updateAgentSettings(env.DB, datasetId, now, (current) => ({ ...current, readAt: now }))
  return agentInbox(env, datasetId, now)
}
