import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, BootstrapData, DiaryMediaInfo, OperationResponse } from '@ego/api-contracts'
import type { TaskAttachment, TaskCardInput, TaskGoalInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../mobile/lib/api-client'
import type { LocalDatabase } from '../../mobile/lib/database/types'
import { queueUploads, uploadPendingMedia, type UploadTransport } from '../../mobile/lib/diary/uploads'
import { localTasks } from '../../mobile/lib/tasks/repository'
import {
  createTaskBoard, createTaskGoal, createTaskLabel, createTaskList, deleteTaskCard, deleteTaskGoal, deleteTaskList,
  saveTaskCard, updateTaskGoal
} from '../../mobile/lib/sync/commands'
import { createSyncCoordinator } from '../../mobile/lib/sync/coordinator'
import { allOperations } from '../../mobile/lib/sync/outbox'
import { openTestLedger } from '../../mobile/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
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
