import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError, ApiResult, BootstrapData, DiaryMediaInfo, OperationResponse } from '@ego/api-contracts'
import type { TaskAttachment, TaskCardInput, TaskGoalInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../../packages/local/src/api-client'
import type { LocalDatabase } from '../../../packages/local/src/database/types'
import { queueUploads, uploadPendingMedia, type UploadTransport } from '../../../packages/local/src/diary/uploads'
import { localTasks } from '../../../packages/local/src/tasks/repository'
import {
  createTaskBoard, createTaskGoal, createTaskLabel, createTaskList, deleteTaskCard, deleteTaskGoal, deleteTaskList,
  saveTaskCard, updateTaskGoal
} from '../../../packages/local/src/sync/commands'
import { createSyncCoordinator } from '../../../packages/local/src/sync/coordinator'
import { allOperations } from '../../../packages/local/src/sync/outbox'
import { openTestLedger } from '../../../packages/local/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { cardText } from '../src/telegram'
import { NOW, exec, operation, seedLedger, type Ledger } from './helpers'
import { createTestBucket } from './r2'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let server: Ledger | null = null
const phones: LocalDatabase[] = []

afterEach(async () => {
  server?.close()
  server = null
  for (const phone of phones.splice(0)) await phone.close()
})

interface Envelope {
  ok: boolean
  data?: unknown
  error?: ApiError
}

async function over<T>(env: Env, path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  const payload = await (await handle(new Request(`https://ego.example${path}`, { ...init, headers }), env)).json() as Envelope
  return payload.ok ? { ok: true, data: payload.data as T } : { ok: false, error: payload.error ?? { code: 'SERVER_ERROR', message: 'Failed' } }
}

function apiOver(env: Env): MoneyApi {
  return {
    reference: () => over(env, '/v1/reference'),
    bootstrap: () => over(env, '/v1/bootstrap'),
    transactions: (filters, cursor, limit) => over(env, `/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => over(env, `/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => over(env, '/v1/balances'),
    changes: (after, limit) => over(env, `/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => over(env, '/v1/operations', {
      method: 'POST', body: JSON.stringify({ operations }), headers: { 'content-type': 'application/json' }
    })
  }
}

/** Stands in for the native upload: the same PUT to the file's own route, with made-up bytes. */
function transportOver(env: Env): UploadTransport {
  return async (upload): Promise<ApiResult<DiaryMediaInfo>> => {
    const bytes = new TextEncoder().encode(upload.localUri.padEnd(upload.size, '.'))
    return over(env, `/v1/${upload.scope ?? 'diary'}/media/${upload.mediaId}`, {
      method: 'PUT', body: bytes, headers: { 'content-type': upload.contentType, 'content-length': String(bytes.length) }
    })
  }
}

async function setup(): Promise<Env> {
  server = await seedLedger()
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: server.db, DIARY_MEDIA: createTestBucket().bucket }
}

async function phone(env: Env): Promise<{ db: LocalDatabase; sync: () => Promise<unknown> }> {
  const db = await openTestLedger(`phone-${phones.length}`)
  phones.push(db)
  const coordinator = createSyncCoordinator({
    db, api: apiOver(env), now: () => NOW, uploadMedia: () => uploadPendingMedia(db, transportOver(env), () => NOW)
  })
  return { db, sync: () => coordinator.sync() }
}

const photo: TaskAttachment = {
  id: 'a-1', mediaId: 'photo-1', kind: 'photo', mimeType: 'image/jpeg', fileName: 'whiteboard.jpg', size: 64,
  width: 4000, height: 3000, durationSeconds: null, previewId: 'photo-1-preview', addedAt: NOW
}

const card = (overrides: Partial<TaskCardInput> = {}): TaskCardInput => ({
  boardId: 'b-1', listId: 'l-1', title: 'Plan the move', description: '**Boxes** first', position: 1024,
  labelIds: ['x-1'], priority: 'high', dueDate: '2026-10-03', dueTime: '17:30', reminderMinutes: 60, doneAt: null,
  archivedAt: null, checklists: [{ id: 'c-1', title: 'Steps', items: [{ id: 'i-1', text: 'Book a van', doneAt: null }] }],
  attachments: [], activity: [{ at: NOW, kind: 'create', text: 'Added this card to "To Do"' }], ...overrides
})

const goal = (overrides: Partial<TaskGoalInput> = {}): TaskGoalInput => ({
  title: 'Build a calmer financial life', why: 'Make room for choices later.', horizon: 'year', targetDate: '2026-12-31',
  status: 'active', position: 1024, reviewDate: '2026-10-10', milestones: [
    { id: 'm-1', title: 'Set a monthly baseline', dueDate: null, doneAt: null }
  ], boardIds: ['b-1'], cardIds: [], archivedAt: null, ...overrides
})

async function seedBoard(db: LocalDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await createTaskBoard(tx, { name: 'Life', icon: '🏠', position: 1024, hideDone: false, archivedAt: null }, NOW, 'b-1')
    await createTaskList(tx, { boardId: 'b-1', name: 'To Do', position: 1024, archivedAt: null }, NOW, 'l-1')
    await createTaskList(tx, { boardId: 'b-1', name: 'Doing', position: 2048, archivedAt: null }, NOW, 'l-2')
    await createTaskLabel(tx, { boardId: 'b-1', name: 'Home', color: 'green', position: 1024 }, NOW, 'x-1')
  })
}

describe('tasks between two phones and the Worker', () => {
  it('uploads a card\'s files first, then shows the card and its moves on the other phone', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await first.db.transaction(async (tx) => {
      await saveTaskCard(tx, 'k-1', null, card({ attachments: [photo] }), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'photo-1', messageId: 'k-1', localUri: 'file:///docs/photo-1.jpg', contentType: 'image/jpeg', size: 64, scope: 'tasks' },
        { mediaId: 'photo-1-preview', messageId: 'k-1', localUri: 'file:///docs/photo-1-preview.jpg', contentType: 'image/jpeg', size: 32, scope: 'tasks' }
      ], NOW)
    })
    expect((await localTasks(first.db)).uploads.get('k-1')).toBe('sending')
    await first.sync()
    expect((await localTasks(first.db)).uploads.size).toBe(0)
    expect(await allOperations(first.db)).toEqual([])

    const served = await handle(new Request('https://ego.example/v1/tasks/media/photo-1', { headers: { authorization: `Bearer ${TOKEN}` } }), env)
    expect(served.status).toBe(200)
    const diaryRoute = await handle(new Request('https://ego.example/v1/diary/media/photo-1', { headers: { authorization: `Bearer ${TOKEN}` } }), env)
    expect(diaryRoute.status).toBe(404)

    const second = await phone(env)
    await second.sync()
    const seen = await localTasks(second.db)
    expect(seen.boards.map((board) => board.name)).toEqual(['Life'])
    expect(seen.lists.map((list) => list.name)).toEqual(['To Do', 'Doing'])
    expect(seen.labels[0]).toMatchObject({ name: 'Home', color: 'green' })
    expect(seen.cards[0]).toMatchObject({
      id: 'k-1', title: 'Plan the move', description: '**Boxes** first', priority: 'high', dueTime: '17:30',
      reminderMinutes: 60, labelIds: ['x-1']
    })
    expect(seen.cards[0].attachments[0]).toMatchObject({ mediaId: 'photo-1', previewId: 'photo-1-preview' })
    expect(seen.cards[0].checklists[0].items[0].text).toBe('Book a van')

    const moved = card({ attachments: [photo], listId: 'l-2', doneAt: NOW })
    await saveTaskCard(second.db, 'k-1', seen.cards[0].revision, moved, NOW)
    await second.sync()
    await first.sync()
    expect((await localTasks(first.db)).cards[0]).toMatchObject({ listId: 'l-2', doneAt: NOW, revision: 2 })
  })

  it('folds an edit made while files upload into the waiting operation', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await first.db.transaction(async (tx) => {
      await saveTaskCard(tx, 'k-1', null, card({ attachments: [photo] }), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'photo-1', messageId: 'k-1', localUri: 'file:///docs/photo-1.jpg', contentType: 'image/jpeg', size: 64, scope: 'tasks' },
        { mediaId: 'photo-1-preview', messageId: 'k-1', localUri: 'file:///docs/photo-1-preview.jpg', contentType: 'image/jpeg', size: 32, scope: 'tasks' }
      ], NOW)
    })
    await saveTaskCard(first.db, 'k-1', 1, card({ attachments: [photo], title: 'Plan the move, renamed' }), NOW)
    const queued = (await allOperations(first.db)).filter((entry) => entry.entity === 'taskCard')
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ commandType: 'create', status: 'held' })
    await first.sync()
    const second = await phone(env)
    await second.sync()
    expect((await localTasks(second.db)).cards[0].title).toBe('Plan the move, renamed')
  })

  it('drops a card the server never saw, with its files', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await first.db.transaction(async (tx) => {
      await saveTaskCard(tx, 'k-1', null, card({ attachments: [photo] }), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'photo-1', messageId: 'k-1', localUri: 'file:///docs/photo-1.jpg', contentType: 'image/jpeg', size: 64, scope: 'tasks' }
      ], NOW)
    })
    const files = await deleteTaskCard(first.db, 'k-1', 1, NOW)
    expect(files).toEqual(['file:///docs/photo-1.jpg'])
    expect((await allOperations(first.db)).filter((entry) => entry.entity === 'taskCard')).toEqual([])
    expect((await localTasks(first.db)).cards).toEqual([])
  })

  it('hides the cards of a deleted list on both sides', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await saveTaskCard(first.db, 'k-1', null, card(), NOW)
    await first.sync()
    await deleteTaskList(first.db, 'l-1', 1, NOW)
    await first.sync()
    expect((await localTasks(first.db)).cards).toEqual([])
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.taskCards).toEqual([])
    expect(bootstrap.ok && bootstrap.data.taskLists?.map((list) => list.id)).toEqual(['l-2'])
  })

  it('syncs a goal with its checkpoints and links, then removes it', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await createTaskGoal(first.db, goal(), NOW, 'g-1')
    await first.sync()

    const second = await phone(env)
    await second.sync()
    const downloaded = await localTasks(second.db)
    expect(downloaded.goals).toHaveLength(1)
    const downloadedGoal = downloaded.goals?.[0]
    if (!downloadedGoal) throw new Error('The downloaded goal was missing')
    expect(downloadedGoal).toMatchObject({ id: 'g-1', title: 'Build a calmer financial life', boardIds: ['b-1'] })

    await updateTaskGoal(second.db, 'g-1', downloadedGoal.revision, goal({
      title: 'Build a calmer financial life, together',
      milestones: [{ id: 'm-1', title: 'Set a monthly baseline', dueDate: null, doneAt: NOW }]
    }), NOW)
    await second.sync()
    await first.sync()
    const updatedGoal = (await localTasks(first.db)).goals?.[0]
    if (!updatedGoal) throw new Error('The updated goal was missing')
    expect(updatedGoal).toMatchObject({
      title: 'Build a calmer financial life, together', revision: 2, milestones: [{ doneAt: NOW }]
    })

    await deleteTaskGoal(first.db, 'g-1', 2, NOW)
    await first.sync()
    await second.sync()
    expect((await localTasks(second.db)).goals).toEqual([])
  })
})

describe('the Worker checks a card before saving it', () => {
  async function send(env: Env, payload: TaskCardInput, id = 'k-1'): Promise<OperationResponse> {
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({ operationId: `op-${id}`, entityId: id, command: { entity: 'taskCard', type: 'create', payload } })] })
    })
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  it('refuses files that were never uploaded and a list from another board', async () => {
    const env = await setup()
    const first = await phone(env)
    await seedBoard(first.db)
    await first.db.transaction(async (tx) => {
      await createTaskBoard(tx, { name: 'Work', icon: '', position: 2048, hideDone: false, archivedAt: null }, NOW, 'b-2')
      await createTaskList(tx, { boardId: 'b-2', name: 'Inbox', position: 1024, archivedAt: null }, NOW, 'l-9')
    })
    await first.sync()
    expect((await send(env, card({ attachments: [photo] }))).failed?.error.message).toBe('Upload the 2 attached files before saving')
    expect((await send(env, card({ listId: 'l-9' }), 'k-2')).failed?.error.message).toBe('That list is on another board')
    expect((await send(env, card(), 'k-3')).failed).toBeNull()
  })
})

describe('list kinds and the Telegram inbox', () => {
  const SECRET = 'webhook-secret-0123456789abcdef'
  const BOT = { TELEGRAM_BOT_TOKEN: '123:bot-token', TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_OWNER_ID: '42' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function textUpdate(text: string, overrides: Record<string, unknown> = {}): unknown {
    return {
      update_id: 1,
      message: { message_id: 7, date: 1760000000, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Egor' }, text, ...overrides }
    }
  }

  async function telegram(env: Env, update: unknown, secret = SECRET): Promise<{ status: number }> {
    const response = await handle(new Request('https://ego.example/v1/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' },
      body: JSON.stringify(update)
    }), env)
    return { status: response.status }
  }

  /** Answers like the Bot API and OpenAI, and records each call as its method name. */
  function fakeTelegram(transcript: string | null = null): { calls: string[] } {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url.startsWith('https://api.openai.com/')) {
        calls.push('transcribe')
        return transcript ? Response.json({ text: transcript }) : Response.json({ error: { message: 'Bad audio' } }, { status: 400 })
      }
      const file = /\/file\/bot[^/]+\/(.+)$/.exec(url)
      if (file) {
        calls.push(`download ${file[1]}`)
        return new Response(new TextEncoder().encode(`bytes of ${file[1]}`))
      }
      const method = url.split('/').at(-1) ?? ''
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
      if (method === 'getFile') {
        calls.push('getFile')
        return Response.json({ ok: true, result: { file_path: `files/${String(body.file_id)}` } })
      }
      calls.push(method === 'sendMessage' ? `sendMessage ${String(body.text)}` : method)
      return Response.json({ ok: true, result: true })
    }))
    return { calls }
  }

  async function seedInbox(env: Env): Promise<{ db: LocalDatabase; sync: () => Promise<unknown> }> {
    const first = await phone(env)
    await seedBoard(first.db)
    await createTaskList(first.db, { boardId: 'b-1', name: 'Inbox', position: 512, archivedAt: null, kind: 'inbox' }, NOW, 'l-inbox')
    await saveTaskCard(first.db, 'k-1', null, card({ listId: 'l-inbox', position: 2048 }), NOW)
    await first.sync()
    return first
  }

  it('keeps a list\'s kind when a build without kinds saves the list', async () => {
    const env = await setup()
    const first = await seedInbox(env)
    const saved = (await localTasks(first.db)).lists.find((list) => list.id === 'l-inbox')
    expect(saved?.kind).toBe('inbox')
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({
        operationId: 'op-rename', entityId: 'l-inbox', expectedRevision: saved?.revision ?? 1,
        command: { entity: 'taskList', type: 'update', payload: { boardId: 'b-1', name: 'In', position: 512, archivedAt: null } }
      })] })
    })
    expect(result.ok && result.data.failed).toBeNull()
    const second = await phone(env)
    await second.sync()
    expect((await localTasks(second.db)).lists.find((list) => list.id === 'l-inbox')).toMatchObject({ name: 'In', kind: 'inbox' })
  })

  it('needs the bot settings and the webhook secret', async () => {
    const env = await setup()
    expect((await telegram(env, textUpdate('Hi'))).status).toBe(503)
    expect((await telegram({ ...env, ...BOT }, textUpdate('Hi'), 'wrong-secret')).status).toBe(401)
  })

  it('adds a message to the bottom of the Inbox once and reacts to it', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await seedInbox(env)
    const bot = fakeTelegram()
    expect((await telegram(env, textUpdate('Renew passport\nPhotos first\nthen the form'))).status).toBe(200)
    expect((await telegram(env, textUpdate('Renew passport\nPhotos first\nthen the form'))).status).toBe(200)
    expect(bot.calls).toEqual(['setMessageReaction', 'setMessageReaction'])

    await first.sync()
    const cards = (await localTasks(first.db)).cards.filter((item) => item.id.startsWith('tg-'))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 'tg-42-7', listId: 'l-inbox', boardId: 'b-1', title: 'Renew passport', description: 'Photos first\nthen the form',
      position: 3072, labelIds: [], dueDate: null, attachments: []
    })
    expect(cards[0].activity.map((entry) => entry.text)).toEqual(['Added this card to "Inbox"'])
  })

  it('ignores everyone but the owner', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await seedInbox(env)
    const bot = fakeTelegram()
    await telegram(env, textUpdate('Spam', { from: { id: 99 } }))
    await telegram(env, textUpdate('Group chatter', { chat: { id: -100, type: 'group' } }))
    expect(bot.calls).toEqual([])
    await first.sync()
    expect((await localTasks(first.db)).cards.some((item) => item.id.startsWith('tg-'))).toBe(false)
  })

  it('notes where a forward came from', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await seedInbox(env)
    fakeTelegram()
    await telegram(env, textUpdate('Free tickets [today]', {
      forward_origin: { type: 'channel', chat: { id: -1001, type: 'channel', title: 'Tampa [Events]', username: 'tampaevents' }, message_id: 5 }
    }))
    await first.sync()
    expect((await localTasks(first.db)).cards.find((item) => item.id === 'tg-42-7')).toMatchObject({
      title: 'Free tickets [today]', description: 'From [Tampa Events](https://t.me/tampaevents/5)'
    })
  })

  it('puts an album on one card with a preview for each photo', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await seedInbox(env)
    const bot = fakeTelegram()
    const photo = (id: string) => [
      { file_id: `${id}-s`, width: 90, height: 67 }, { file_id: `${id}-x`, width: 800, height: 600 },
      { file_id: `${id}-w`, width: 2560, height: 1920, file_size: 300000 }
    ]
    await telegram(env, textUpdate('', { message_id: 8, media_group_id: '1357', caption: 'Whiteboard from class', photo: photo('a') }))
    await telegram(env, textUpdate('', { message_id: 9, media_group_id: '1357', photo: photo('b') }))
    expect(bot.calls.filter((call) => call.startsWith('download'))).toEqual([
      'download files/a-w', 'download files/a-x', 'download files/b-w', 'download files/b-x'
    ])

    await first.sync()
    const album = (await localTasks(first.db)).cards.find((item) => item.id === 'tg-42-album-1357')
    expect(album?.title).toBe('Whiteboard from class')
    expect(album?.attachments.map((file) => [file.mediaId, file.kind, file.previewId, file.width])).toEqual([
      ['tg-42-8', 'photo', 'tg-42-8-p', 2560], ['tg-42-9', 'photo', 'tg-42-9-p', 2560]
    ])
    expect(album?.activity.map((entry) => entry.text)).toEqual(['Added this card to "Inbox"', 'Attached "a photo"'])
  })

  it('turns a voice note into the title and keeps the recording', async () => {
    const env = { ...await setup(), ...BOT, OPENAI_API_KEY: 'sk-test' }
    const first = await seedInbox(env)
    const bot = fakeTelegram('Call the dentist about Friday')
    await telegram(env, textUpdate('', { voice: { file_id: 'v-1', duration: 4, mime_type: 'audio/ogg', file_size: 9000 } }))
    expect(bot.calls).toEqual(['getFile', 'download files/v-1', 'transcribe', 'setMessageReaction'])

    await first.sync()
    const card = (await localTasks(first.db)).cards.find((item) => item.id === 'tg-42-7')
    expect(card?.title).toBe('Call the dentist about Friday')
    expect(card?.attachments).toMatchObject([{ mediaId: 'tg-42-7', kind: 'file', mimeType: 'audio/ogg', fileName: 'Voice note.ogg', durationSeconds: 4 }])
  })

  it('still adds a voice note it could not transcribe, and says why', async () => {
    const env = { ...await setup(), ...BOT, OPENAI_API_KEY: 'sk-test' }
    const first = await seedInbox(env)
    const bot = fakeTelegram(null)
    await telegram(env, textUpdate('', { voice: { file_id: 'v-1', duration: 4 } }))
    expect(bot.calls.at(-1)).toBe('sendMessage Added, but I could not transcribe it: Bad audio.')
    await first.sync()
    expect((await localTasks(first.db)).cards.find((item) => item.id === 'tg-42-7')?.title).toBe('Voice note')
  })

  it('skips a file over the bot download limit but keeps the card', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await seedInbox(env)
    const bot = fakeTelegram()
    await telegram(env, textUpdate('', { document: { file_id: 'd-1', file_name: 'lecture.mp4', mime_type: 'video/mp4', file_size: 40_000_000 } }))
    expect(bot.calls).toEqual(['setMessageReaction', 'sendMessage Added, but the video stayed in Telegram: it is over the 20 MB a bot may download.'])
    await first.sync()
    expect((await localTasks(first.db)).cards.find((item) => item.id === 'tg-42-7')).toMatchObject({ title: 'lecture.mp4', attachments: [] })
  })

  it('answers when no board has an Inbox', async () => {
    const env = { ...await setup(), ...BOT }
    const first = await phone(env)
    await seedBoard(first.db)
    await first.sync()
    const bot = fakeTelegram()
    await telegram(env, textUpdate('Lost'))
    expect(bot.calls).toEqual(['sendMessage Not added: No board has an Inbox list. Send it again.'])
  })

  it('splits a title from the description and moves an overlong first line into it', () => {
    expect(cardText('  Buy milk  \n\n2%  ')).toEqual({ title: 'Buy milk', description: '2%' })
    const long = `${'word '.repeat(120)}end`
    const split = cardText(long)
    expect(split.title.length).toBeLessThanOrEqual(500)
    expect(split.title.endsWith('word…')).toBe(true)
    expect(split.description).toBe(long)
  })
})

describe('the move-done setting', () => {
  it('keeps the setting when a build without it saves the board', async () => {
    const env = await setup()
    const first = await phone(env)
    await createTaskBoard(first.db, { name: 'GTD', icon: '', position: 1024, hideDone: false, moveDone: true, archivedAt: null }, NOW, 'b-gtd')
    await first.sync()
    const saved = (await localTasks(first.db)).boards.find((board) => board.id === 'b-gtd')
    expect(saved?.moveDone).toBe(true)
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({
        operationId: 'op-hide', entityId: 'b-gtd', expectedRevision: saved?.revision ?? 1,
        command: { entity: 'taskBoard', type: 'update', payload: { name: 'GTD', icon: '', position: 1024, hideDone: true, archivedAt: null } }
      })] })
    })
    expect(result.ok && result.data.failed).toBeNull()
    const second = await phone(env)
    await second.sync()
    expect((await localTasks(second.db)).boards.find((board) => board.id === 'b-gtd')).toMatchObject({ hideDone: true, moveDone: true })
  })
})

describe('a column style', () => {
  it('syncs a color, emoji, and outline, and keeps them when a build without them saves the list', async () => {
    const env = await setup()
    const first = await phone(env)
    await createTaskBoard(first.db, { name: 'GTD', icon: '', position: 1024, hideDone: false, archivedAt: null }, NOW, 'b-gtd')
    await createTaskList(first.db, {
      boardId: 'b-gtd', name: 'USF', position: 1024, archivedAt: null, kind: 'usf', color: '#006747', icon: '🎓', border: true
    }, NOW, 'l-usf')
    await createTaskList(first.db, { boardId: 'b-gtd', name: 'Later', position: 2048, archivedAt: null, color: 'sky' }, NOW, 'l-later')
    await first.sync()
    const saved = (await localTasks(first.db)).lists.find((list) => list.id === 'l-usf')
    expect(saved).toMatchObject({ color: '#006747', icon: '🎓', border: true })
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({
        operationId: 'op-rename', entityId: 'l-usf', expectedRevision: saved?.revision ?? 1,
        command: { entity: 'taskList', type: 'update', payload: { boardId: 'b-gtd', name: 'School', position: 1024, archivedAt: null } }
      })] })
    })
    expect(result.ok && result.data.failed).toBeNull()
    const second = await phone(env)
    await second.sync()
    const lists = (await localTasks(second.db)).lists
    expect(lists.find((list) => list.id === 'l-usf')).toMatchObject({ name: 'School', kind: 'usf', color: '#006747', icon: '🎓', border: true })
    expect(lists.find((list) => list.id === 'l-later')).toMatchObject({ color: 'sky', icon: '', border: false })
  })

  it('refuses a color that is neither a label color nor a hex code', async () => {
    const env = await setup()
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({
        operationId: 'op-bad', entityId: 'l-bad', expectedRevision: null,
        command: { entity: 'taskList', type: 'create', payload: { boardId: 'b-gtd', name: 'Bad', position: 1024, archivedAt: null } }
      })] }).replace('"archivedAt":null', '"archivedAt":null,"color":"teal"')
    })
    expect(result.ok ? null : result.error.code).toBe('INVALID_REQUEST')
  })
})
