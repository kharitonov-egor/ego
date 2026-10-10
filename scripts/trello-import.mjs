#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import core from '@ego/core'

const { isTaskCardInput, isTaskLabelInput, isTaskListInput, TASK_DESCRIPTION_LIMIT } = core

/**
 * Loads a Trello board's JSON export into an Ego board through the Worker. IDs come from Trello's
 * IDs, so running it again skips what is already there. Images are left out; link attachments
 * and start dates go into the description. Trello's Done list arrives archived, with each card's
 * done state kept. A closed list whose open cards only repeat titles it already has archived
 * brings just the archived ones.
 *
 *   EGO_API_URL, EGO_DEVICE_TOKEN   the Worker and a device token from ego-device enroll
 *
 *   node scripts/trello-import.mjs <export.json> [--board GTD] [--clear]            print the plan
 *   node scripts/trello-import.mjs <export.json> [--board GTD] [--clear] --apply    send it
 *
 * --clear deletes the board's lists, cards, and labels that did not come from Trello first.
 * Needs the built core package (npm run typecheck builds it).
 */

const BATCH = 25
const ATTEMPTS = 4
const TIME_ZONE = 'America/New_York'
const STEP = 1024
const REMINDERS = [0, 10, 60, 1440, 2880]
const COLORS = { green: 'green', yellow: 'yellow', orange: 'orange', red: 'red', purple: 'purple', blue: 'blue', sky: 'sky', pink: 'pink', lime: 'green', black: 'sky' }
const LIST_KINDS = { Inbox: 'inbox', USF: 'usf' }
const DONE_LIST = 'Done'

const args = process.argv.slice(2)
const file = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--board')
const boardName = args.includes('--board') ? args[args.indexOf('--board') + 1] : 'GTD'
const apply = args.includes('--apply')
const clear = args.includes('--clear')
if (!file) {
  console.error('Usage: node scripts/trello-import.mjs <Trello export.json> [--board GTD] [--clear] [--apply]')
  process.exit(1)
}

const url = (process.env.EGO_API_URL ?? '').replace(/\/+$/, '')
const token = process.env.EGO_DEVICE_TOKEN ?? ''
if (!url || !token) {
  console.error('Set EGO_API_URL and EGO_DEVICE_TOKEN first. The plan needs the live board too.')
  process.exit(1)
}
const auth = { authorization: `Bearer ${token}` }

async function call(path, init = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${url}${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...init.headers } })
    const text = await response.text()
    let payload = null
    try { payload = JSON.parse(text) } catch { payload = null }
    if (response.ok && payload?.ok === true) return payload.data
    const message = payload?.error?.message ?? `HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`
    if (response.status < 500 || attempt >= ATTEMPTS) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
}

const trello = JSON.parse(readFileSync(file, 'utf8'))
const live = await call('/v1/bootstrap')
const board = (live.taskBoards ?? []).find((item) => item.archivedAt === null && item.name.trim().toLowerCase() === boardName.toLowerCase())
if (!board) {
  console.error(`No live board named ${boardName}.`)
  process.exit(1)
}
const existing = new Set([...(live.taskLists ?? []), ...(live.taskLabels ?? []), ...(live.taskCards ?? [])].map((record) => record.id))

const idFor = (trelloId) => `trello-${trelloId}`
const createdOf = (trelloId) => new Date(parseInt(trelloId.slice(0, 8), 16) * 1000).toISOString()
const byPos = (left, right) => left.pos - right.pos

const clock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
})
function local(iso) {
  const parts = Object.fromEntries(clock.formatToParts(new Date(iso)).map((part) => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function dayLabel(iso) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric' })
}

function reminderFor(minutes) {
  if (typeof minutes !== 'number' || minutes < 0) return null
  return [...REMINDERS].reverse().find((value) => value <= minutes) ?? 0
}

function clip(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

const lists = [...trello.lists].sort(byPos)
const listById = new Map(lists.map((list) => [list.id, list]))
const checklists = new Map(trello.checklists.map((checklist) => [checklist.id, checklist]))
const labelIds = new Set(trello.labels.map((label) => label.id))

/** The newest activity under a closed list stands in for when it closed; Trello keeps no date for it. */
const listClosedAt = new Map()
for (const card of trello.cards) {
  const list = listById.get(card.idList)
  if (!list?.closed) continue
  const at = card.dateLastActivity
  if (!listClosedAt.has(list.id) || at > listClosedAt.get(list.id)) listClosedAt.set(list.id, at)
}

/** In a closed list, open cards that only repeat a title already archived there are an automation's copies. */
const archivedTitles = new Map()
for (const card of trello.cards) {
  if (!card.closed || !listById.get(card.idList)?.closed) continue
  if (!archivedTitles.has(card.idList)) archivedTitles.set(card.idList, new Set())
  archivedTitles.get(card.idList).add(card.name.trim())
}
const repeats = []
const cards = trello.cards.filter((card) => {
  const list = listById.get(card.idList)
  if (!list) return false
  if (list.closed && !card.closed && archivedTitles.get(list.id)?.has(card.name.trim())) {
    repeats.push(card)
    return false
  }
  return true
})

const labelOps = trello.labels.map((label, index) => {
  const payload = {
    boardId: board.id, name: clip(label.name ?? '', 40), color: COLORS[(label.color ?? 'blue').replace(/_(dark|light)$/, '')] ?? 'blue',
    position: (index + 1) * STEP
  }
  if (!isTaskLabelInput(payload)) throw new Error(`Label ${label.id} would be refused`)
  return { entityId: idFor(label.id), command: { entity: 'taskLabel', type: 'create', payload } }
})

const inboxSeen = new Set()
const listOps = lists.map((list, index) => {
  let kind = list.closed ? 'cards' : LIST_KINDS[list.name.trim()] ?? 'cards'
  if (kind !== 'cards' && inboxSeen.has(kind)) kind = 'cards'
  inboxSeen.add(kind)
  const payload = {
    boardId: board.id, name: clip(list.name.trim() || 'List', 120), position: (index + 1) * STEP,
    archivedAt: list.closed ? listClosedAt.get(list.id) ?? new Date().toISOString() : null, kind
  }
  if (!isTaskListInput(payload)) throw new Error(`List ${list.id} would be refused`)
  return { entityId: idFor(list.id), command: { entity: 'taskList', type: 'create', payload } }
})

function descriptionOf(card) {
  const name = card.name.trim()
  const parts = []
  if (name.length > 500) parts.push(name)
  if (card.desc.trim()) parts.push(card.desc.trim())
  const links = (card.attachments ?? []).filter((attachment) => !attachment.isUpload && !(attachment.mimeType ?? '').startsWith('image/') &&
    /^https?:\/\//.test(attachment.url ?? '') && !/^https:\/\/api\.telegram\.org\/file\//.test(attachment.url))
  if (links.length > 0) parts.push(['Links:', ...links.map((link) => `- [${(link.name || link.url).replace(/[[\]]/g, '')}](${link.url})`)].join('\n'))
  if (card.start) parts.push(`Start date: ${dayLabel(card.start)}`)
  return clip(parts.join('\n\n'), TASK_DESCRIPTION_LIMIT)
}

function titleOf(card) {
  const name = card.name.trim()
  if (!name) return '(no title)'
  if (name.length <= 500) return name
  return clip(name.split('\n')[0].trim() || name, 500)
}

function checklistsOf(card) {
  return (card.idChecklists ?? [])
    .map((id) => checklists.get(id))
    .filter(Boolean)
    .sort(byPos)
    .slice(0, 20)
    .map((checklist) => ({
      id: checklist.id,
      title: clip(checklist.name.trim() || 'Checklist', 120),
      items: [...checklist.checkItems].sort(byPos)
        .filter((item) => item.name.trim())
        .slice(0, 200)
        .map((item) => ({ id: item.id, text: clip(item.name.trim(), 500), doneAt: item.state === 'complete' ? card.dateLastActivity : null }))
    }))
}

const positions = new Map()
for (const list of lists) {
  cards.filter((card) => card.idList === list.id).sort(byPos).forEach((card, index) => positions.set(card.id, (index + 1) * STEP))
}

const refused = []
const cardOps = cards.map((card) => {
  const list = listById.get(card.idList)
  const listName = list.name.trim()
  const doneAt = card.dueComplete ? card.dateCompleted ?? card.dateLastActivity : null
  const archivedAt = card.closed
    ? card.dateClosed ?? card.dateLastActivity
    : listName === DONE_LIST && !list.closed ? doneAt ?? card.dateLastActivity : null
  const due = card.due ? local(card.due) : null
  const activity = [
    { at: createdOf(card.id), kind: 'create', text: clip(`Added this card to "${listName}" in Trello`, 300) },
    ...(doneAt ? [{ at: doneAt, kind: 'done', text: 'Marked this card as done' }] : []),
    ...(archivedAt ? [{ at: archivedAt, kind: 'archive', text: 'Archived this card' }] : [])
  ].sort((left, right) => left.at.localeCompare(right.at))
  const payload = {
    boardId: board.id,
    listId: idFor(card.idList),
    title: titleOf(card),
    description: descriptionOf(card),
    position: positions.get(card.id),
    labelIds: [...new Set(card.idLabels.filter((id) => labelIds.has(id)).map(idFor))].slice(0, 20),
    priority: 'none',
    dueDate: due?.date ?? null,
    dueTime: due?.time ?? null,
    reminderMinutes: due ? reminderFor(card.dueReminder) : null,
    doneAt,
    archivedAt,
    checklists: checklistsOf(card),
    attachments: [],
    activity
  }
  if (!isTaskCardInput(payload)) refused.push(card)
  return { entityId: idFor(card.id), command: { entity: 'taskCard', type: 'create', payload } }
})
if (refused.length > 0) {
  console.error(`${refused.length} cards would be refused: ${refused.map((card) => card.id).join(', ')}`)
  process.exit(1)
}

const ours = (record) => record.id.startsWith('trello-')
const stale = clear ? {
  cards: (live.taskCards ?? []).filter((record) => record.boardId === board.id && !ours(record)),
  lists: (live.taskLists ?? []).filter((record) => record.boardId === board.id && !ours(record)),
  labels: (live.taskLabels ?? []).filter((record) => record.boardId === board.id && !ours(record))
} : { cards: [], lists: [], labels: [] }

const count = (items, test) => items.filter(test).length
const cardPayloads = cardOps.map((op) => op.command.payload)
console.log(`Into "${board.name}" (${board.id}) from "${trello.name}".`)
console.log(`Labels: ${labelOps.length}. Lists: ${listOps.length} (${count(listOps, (op) => op.command.payload.archivedAt)} archived; Inbox and USF marked).`)
console.log(`Cards: ${cardOps.length}. On the board: ${count(cardPayloads, (card) => !card.archivedAt)}. Archived: ${count(cardPayloads, (card) => card.archivedAt)}, ${count(cardPayloads, (card) => card.archivedAt && card.doneAt)} of them done.`)
console.log(`With due dates: ${count(cardPayloads, (card) => card.dueDate)}. With checklists: ${count(cardPayloads, (card) => card.checklists.length > 0)}. Skipped copies in closed lists: ${repeats.length}.`)
console.log(`Already in Ego: ${[...labelOps, ...listOps, ...cardOps].filter((op) => existing.has(op.entityId)).length}.`)
if (clear) {
  console.log(`Deleting first: ${stale.cards.length} cards (${stale.cards.map((record) => `"${record.title}"`).join(', ') || 'none'}), ` +
    `${stale.lists.length} lists (${stale.lists.map((record) => `"${record.name}"`).join(', ') || 'none'}), ` +
    `${stale.labels.length} labels (${stale.labels.map((record) => `"${record.name}"`).join(', ') || 'none'}).`)
}

if (!apply) {
  console.log('\nAdd --apply to send it.')
  process.exit(0)
}

const now = new Date().toISOString()
const operations = [
  ...stale.cards.map((record) => ({ operationId: `trello-clear-${record.id}`, entityId: record.id, expectedRevision: record.revision, createdAt: now, command: { entity: 'taskCard', type: 'delete' } })),
  ...stale.lists.map((record) => ({ operationId: `trello-clear-${record.id}`, entityId: record.id, expectedRevision: record.revision, createdAt: now, command: { entity: 'taskList', type: 'delete' } })),
  ...stale.labels.map((record) => ({ operationId: `trello-clear-${record.id}`, entityId: record.id, expectedRevision: record.revision, createdAt: now, command: { entity: 'taskLabel', type: 'delete' } })),
  ...[...labelOps, ...listOps, ...cardOps]
    .filter((op) => !existing.has(op.entityId))
    .map((op) => ({ operationId: op.entityId, entityId: op.entityId, expectedRevision: null, createdAt: now, command: op.command }))
]

let sent = 0
for (let start = 0; start < operations.length; start += BATCH) {
  const batch = operations.slice(start, start + BATCH)
  const result = await call('/v1/operations', { method: 'POST', body: JSON.stringify({ operations: batch }) })
  sent += result.results.length
  if (result.failed) {
    console.error(`\nStopped at ${result.failed.operationId}: ${result.failed.error.message}. ${sent} sent. Run it again to continue.`)
    process.exit(1)
  }
  process.stdout.write(`\r${sent} of ${operations.length} sent`)
}
console.log(`\nDone. ${sent} operations applied.`)
