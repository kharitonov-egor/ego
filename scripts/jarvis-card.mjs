#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_WORKER = 'https://ego-money.ega-khar.workers.dev'
const TOKEN_FILE = join(homedir(), '.config', 'ego', 'agent-token')
const STATUSES = ['working', 'asking', 'pr', 'failed']

function usage() {
  console.log(`Usage:
  node scripts/jarvis-card.mjs show <card>                    Prints the card and saves its files to a temp folder
  node scripts/jarvis-card.mjs report <card> <status> [--pr <url>] [--note <text>]

Status is one of ${STATUSES.join(', ')}. The token comes from EGO_AGENT_TOKEN or ${TOKEN_FILE}.
EGO_API_URL overrides the Worker (default ${DEFAULT_WORKER}).`)
}

function token() {
  const value = process.env.EGO_AGENT_TOKEN?.trim() || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '')
  if (!value) throw new Error(`No Jarvis token. Put it in ${TOKEN_FILE} or EGO_AGENT_TOKEN`)
  return value
}

const base = () => (process.env.EGO_API_URL?.trim() || DEFAULT_WORKER).replace(/\/+$/, '')
const cardPath = (card) => `/v1/tasks/agent/cards/${encodeURIComponent(card)}`

async function request(path, init = {}) {
  const response = await fetch(`${base()}${path}`, {
    ...init, headers: { authorization: `Bearer ${token()}`, ...(init.headers ?? {}) }
  })
  return response
}

async function json(path, init) {
  const response = await request(path, init)
  const payload = await response.json().catch(() => null)
  if (!payload?.ok) throw new Error(payload?.error?.message ?? `The Worker answered ${response.status}`)
  return payload.data
}

function checklistLines(checklists) {
  return checklists.flatMap((list) => [
    `### ${list.title}`,
    ...list.items.map((item) => `- [${item.doneAt ? 'x' : ' '}] ${item.text}`),
    ''
  ])
}

async function show(card) {
  const data = await json(cardPath(card))
  const { card: record, labels, board, list, link, run } = data
  const folder = join(tmpdir(), 'jarvis-cards', card)
  const files = []
  for (const file of record.attachments) {
    const response = await request(`${cardPath(card)}/media/${encodeURIComponent(file.mediaId)}`)
    if (!response.ok) {
      files.push(`- ${file.fileName ?? file.mediaId}: could not download (${response.status})`)
      continue
    }
    mkdirSync(folder, { recursive: true })
    const name = `${file.id}-${(file.fileName ?? `${file.kind}`).replace(/[^\w.-]+/g, '_')}`
    const path = join(folder, name)
    writeFileSync(path, Buffer.from(await response.arrayBuffer()))
    files.push(`- ${file.kind}, ${file.mimeType}: ${path}`)
  }
  console.log([
    `# ${record.title}`,
    '',
    `Card ${record.id} in ${board} › ${list}${link ? `, ${link}` : ''}`,
    `Jarvis status: ${run.status}, branch ${run.branch}${run.prUrl ? `, ${run.prUrl}` : ''}`,
    labels.length > 0 ? `Labels: ${labels.map((label) => label.name || label.color).join(', ')}` : null,
    record.priority !== 'none' ? `Priority: ${record.priority}` : null,
    record.dueDate ? `Due: ${record.dueDate}${record.dueTime ? ` ${record.dueTime}` : ''}` : null,
    '',
    '## Description',
    '',
    record.description.trim() || '(empty)',
    '',
    ...(record.checklists.length > 0 ? ['## Checklists', '', ...checklistLines(record.checklists)] : []),
    ...(files.length > 0 ? ['## Files', '', ...files, ''] : [])
  ].filter((line) => line !== null).join('\n'))
}

function option(args, name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

async function report(card, status, args) {
  if (!STATUSES.includes(status)) throw new Error(`Status must be one of ${STATUSES.join(', ')}`)
  const body = { status, prUrl: option(args, '--pr'), note: option(args, '--note') }
  const run = await json(`${cardPath(card)}/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  console.log(`${card}: ${run.status}${run.prUrl ? ` ${run.prUrl}` : ''}`)
}

async function main() {
  const [command, card, status, ...rest] = process.argv.slice(2)
  if (command === 'show' && card) return show(card)
  if (command === 'report' && card && status) return report(card, status, rest)
  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
