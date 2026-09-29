import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult, DiaryMediaInfo, DiaryMessageRecord } from '@ego/api-contracts'
import type { DiaryAttachment, DiaryMessageInput } from '@ego/core'
import type { LocalDatabase } from '../lib/database/types'
import { localDiaryMessages, localDiaryRevision } from '../lib/diary/repository'
import {
  localMediaFiles, queueUploads, retryMessageUploads, uploadPendingMedia, type PendingUpload, type UploadTransport
} from '../lib/diary/uploads'
import { createDiaryMessage, deleteDiaryMessage, updateDiaryMessage } from '../lib/sync/commands'
import { BOOTSTRAP_VERSION, bootstrap, createSyncCoordinator } from '../lib/sync/coordinator'
import { allOperations } from '../lib/sync/outbox'
import { emptyBootstrap, fakeApi } from './fake-api'
import { openTestLedger } from './local-db'

const NOW = '2026-09-28T21:00:00.000Z'
let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

const photo = (mediaId: string, previewId: string | null = null): DiaryAttachment => ({
  mediaId, kind: 'photo', mimeType: 'image/jpeg', fileName: null, size: 2000, width: 4000, height: 3000,
  durationSeconds: null, title: null, performer: null, emoji: null, previewId, waveform: null
})

const input = (overrides: Partial<DiaryMessageInput> = {}): DiaryMessageInput => ({
  sentAt: NOW, text: 'Sunset from the roof', entities: [], attachments: [], replyToId: null,
  forwarded: false, forwardedFrom: null, pinnedAt: null, editedAt: null, source: 'app', ...overrides
})

async function bootstrapped(): Promise<LocalDatabase> {
  const database = await openTestLedger()
  await database.run('UPDATE sync_state SET bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1', [NOW, BOOTSTRAP_VERSION])
  return database
}

async function sendWithPhoto(database: LocalDatabase, id = 'd-1'): Promise<void> {
  await database.transaction(async (tx) => {
    await createDiaryMessage(tx, input({ attachments: [photo('m-full', 'm-preview')] }), NOW, id, true)
    await queueUploads(tx, [
      { mediaId: 'm-full', messageId: id, localUri: 'file:///docs/m-full.jpg', contentType: 'image/jpeg', size: 2000 },
      { mediaId: 'm-preview', messageId: id, localUri: 'file:///docs/m-preview.jpg', contentType: 'image/jpeg', size: 90 }
    ], NOW)
  })
}

function recordingTransport(answers: Array<ApiResult<DiaryMediaInfo>> = []): UploadTransport & { sent: PendingUpload[] } {
  const sent: PendingUpload[] = []
  const transport = async (upload: PendingUpload): Promise<ApiResult<DiaryMediaInfo>> => {
    sent.push(upload)
    return answers.shift() ?? { ok: true, data: { id: upload.mediaId, contentType: upload.contentType, size: upload.size } }
  }
  return Object.assign(transport, { sent })
}

describe('diary messages on the phone', () => {
  it('holds a message with files and shows it as sending', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    expect((await allOperations(db)).map((entry) => [entry.entity, entry.commandType, entry.status])).toEqual([
      ['diaryMessage', 'create', 'held']
    ])
    const [message] = await localDiaryMessages(db)
    expect(message).toMatchObject({ id: 'd-1', delivery: 'sending', revision: 1, text: 'Sunset from the roof' })
    expect(message.attachments[0]).toMatchObject({ mediaId: 'm-full', previewId: 'm-preview' })
    expect(await localMediaFiles(db)).toEqual(new Map([['m-full', 'file:///docs/m-full.jpg'], ['m-preview', 'file:///docs/m-preview.jpg']]))
  })

  it('uploads the preview first, then releases the message to the outbox', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    const transport = recordingTransport()
    const run = await uploadPendingMedia(db, transport, () => NOW)
    expect(run).toEqual({ error: null, paused: false, uploaded: 2, released: 1 })
    expect(transport.sent.map((upload) => upload.mediaId)).toEqual(['m-preview', 'm-full'])
    expect((await allOperations(db))[0].status).toBe('pending')
  })

  it('waits and retries when the network is down', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    const transport = recordingTransport([{ ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }])
    const run = await uploadPendingMedia(db, transport, () => NOW, () => 0)
    expect(run).toMatchObject({ paused: false, uploaded: 0, released: 0, error: { code: 'OFFLINE' } })
    expect((await allOperations(db))[0].status).toBe('held')
    const soon = recordingTransport()
    expect(await uploadPendingMedia(db, soon, () => NOW)).toMatchObject({ uploaded: 1, released: 0 })
    expect(soon.sent.map((upload) => upload.mediaId)).toEqual(['m-full'])
    const later = new Date(Date.parse(NOW) + 60000).toISOString()
    expect(await uploadPendingMedia(db, recordingTransport(), () => later)).toMatchObject({ uploaded: 1, released: 1 })
  })

  it('marks a message failed when the server refuses a file, and can try it again', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    const refused = recordingTransport([{ ok: false, error: { code: 'INVALID_REQUEST', message: 'This file is no longer on the phone' } }])
    expect(await uploadPendingMedia(db, refused, () => NOW)).toMatchObject({ uploaded: 1, released: 0 })
    expect((await localDiaryMessages(db))[0].delivery).toBe('failed')
    expect((await allOperations(db))[0]).toMatchObject({ status: 'failed', lastError: 'This file is no longer on the phone' })

    await retryMessageUploads(db, 'd-1')
    expect((await allOperations(db))[0].status).toBe('held')
    expect(await uploadPendingMedia(db, recordingTransport(), () => NOW)).toMatchObject({ uploaded: 1, released: 1 })
  })

  it('folds an edit into a message that is still uploading', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    await updateDiaryMessage(db, 'd-1', 1, input({ text: 'Sunset, edited', attachments: [photo('m-full', 'm-preview')] }), NOW)
    const outbox = await allOperations(db)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].command).toMatchObject({ type: 'create', payload: { text: 'Sunset, edited' } })
    expect((await localDiaryMessages(db))[0].text).toBe('Sunset, edited')
  })

  it('drops a message that never left the phone, with its uploads', async () => {
    db = await openTestLedger()
    await sendWithPhoto(db)
    const files = await deleteDiaryMessage(db, 'd-1', 1, NOW)
    expect(files.sort()).toEqual(['file:///docs/m-full.jpg', 'file:///docs/m-preview.jpg'])
    expect(await allOperations(db)).toHaveLength(0)
    expect(await localDiaryMessages(db)).toHaveLength(0)
    expect(await localMediaFiles(db)).toEqual(new Map())
  })

  it('sends an update and a delete for a message the server has', async () => {
    db = await openTestLedger()
    await createDiaryMessage(db, input(), NOW, 'd-2')
    await db.run("DELETE FROM outbox")
    await updateDiaryMessage(db, 'd-2', 1, input({ pinnedAt: NOW }), NOW)
    expect(await localDiaryRevision(db, 'd-2')).toBe(2)
    expect(await deleteDiaryMessage(db, 'd-2', 2, NOW)).toEqual([])
    expect((await allOperations(db)).map((entry) => [entry.commandType, entry.expectedRevision])).toEqual([['update', 1], ['delete', 2]])
    expect(await localDiaryMessages(db)).toHaveLength(0)
  })
})

describe('diary sync', () => {
  const record = (overrides: Partial<DiaryMessageRecord> = {}): DiaryMessageRecord => ({
    ...input({ source: 'telegram', text: 'Always wanted a channel', sentAt: '2021-03-08T01:04:59.000Z' }),
    id: 'tg-4', createdAt: NOW, updatedAt: NOW, revision: 1, ...overrides
  })

  it('downloads the diary with everything else', async () => {
    db = await openTestLedger()
    const api = fakeApi({ bootstrap: [{ ok: true, data: { ...emptyBootstrap(12), diaryMessages: [record()] } }] })
    expect(await bootstrap({ db, api, now: () => NOW })).toBeNull()
    expect((await localDiaryMessages(db)).map((message) => [message.id, message.delivery, message.source])).toEqual([['tg-4', 'sent', 'telegram']])
  })

  it('delivers everything else before uploading, then sends the released message', async () => {
    db = await bootstrapped()
    await sendWithPhoto(db)
    await createDiaryMessage(db, input({ text: 'Plain note' }), NOW, 'd-2')
    const api = fakeApi()
    const order: string[] = []
    const transport = recordingTransport()
    const coordinator = createSyncCoordinator({
      db, api, now: () => NOW,
      uploadMedia: async () => {
        order.push(`upload after ${api.sentOperations.length} deliveries`)
        return uploadPendingMedia(db as LocalDatabase, transport, () => NOW)
      }
    })
    const outcome = await coordinator.sync()
    expect(order).toEqual(['upload after 1 deliveries'])
    expect(api.sentOperations.map((batch) => batch.map((operation) => operation.entityId))).toEqual([['d-2'], ['d-1']])
    expect(outcome).toMatchObject({ state: 'synced', delivered: 2, pendingCount: 0 })
    expect(outcome.touched.diary).toBe(true)
    expect((await localDiaryMessages(db)).every((message) => message.delivery === 'sent')).toBe(true)
  })

  it('counts a held message as pending until its files are up', async () => {
    db = await bootstrapped()
    await sendWithPhoto(db)
    const offline: UploadTransport = async () => ({ ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } })
    const outcome = await createSyncCoordinator({
      db, api: fakeApi(), now: () => NOW, uploadMedia: () => uploadPendingMedia(db as LocalDatabase, offline, () => NOW)
    }).sync()
    expect(outcome).toMatchObject({ state: 'offline', pendingCount: 1, delivered: 0 })
  })

  it('stops for sign-in when the server refuses the device during an upload', async () => {
    db = await bootstrapped()
    await sendWithPhoto(db)
    const signedOut: UploadTransport = async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in again' } })
    const outcome = await createSyncCoordinator({
      db, api: fakeApi(), now: () => NOW, uploadMedia: () => uploadPendingMedia(db as LocalDatabase, signedOut, () => NOW)
    }).sync()
    expect(outcome.state).toBe('paused')
  })
})
