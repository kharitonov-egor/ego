import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, DiaryMediaInfo } from '@ego/api-contracts'
import type { DiaryMessageInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../mobile/lib/api-client'
import type { LocalDatabase } from '../../mobile/lib/database/types'
import { localDiaryMessages } from '../../mobile/lib/diary/repository'
import { queueUploads, uploadPendingMedia, type UploadTransport } from '../../mobile/lib/diary/uploads'
import { createDiaryMessage, updateDiaryMessage } from '../../mobile/lib/sync/commands'
import { createSyncCoordinator } from '../../mobile/lib/sync/coordinator'
import { openTestLedger } from '../../mobile/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'
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

/** Stands in for the native upload: the same PUT, with bytes made up from the file name. */
function transportOver(env: Env): UploadTransport {
  return async (upload): Promise<ApiResult<DiaryMediaInfo>> => {
    const bytes = new TextEncoder().encode(upload.localUri.padEnd(upload.size, '.'))
    return over(env, `/v1/diary/media/${upload.mediaId}`, {
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

const withPhoto: DiaryMessageInput = {
  sentAt: NOW, text: 'First day at the new place', entities: [],
  attachments: [{
    mediaId: 'photo-1', kind: 'photo', mimeType: 'image/jpeg', fileName: null, size: 64, width: 4000, height: 3000,
    durationSeconds: null, title: null, performer: null, emoji: null, previewId: 'photo-1-preview', waveform: null
  }],
  replyToId: null, forwarded: false, forwardedFrom: null, pinnedAt: null, editedAt: null, source: 'app'
}

describe('diary between two phones and the Worker', () => {
  it('uploads the files, sends the message, and shows it on the other phone', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createDiaryMessage(tx, withPhoto, NOW, 'd-1', true)
      await queueUploads(tx, [
        { mediaId: 'photo-1', messageId: 'd-1', localUri: 'file:///docs/photo-1.jpg', contentType: 'image/jpeg', size: 64 },
        { mediaId: 'photo-1-preview', messageId: 'd-1', localUri: 'file:///docs/photo-1-preview.jpg', contentType: 'image/jpeg', size: 32 }
      ], NOW)
    })
    await first.sync()
    expect((await localDiaryMessages(first.db))[0].delivery).toBe('sent')

    const served = await handle(new Request('https://ego.example/v1/diary/media/photo-1', { headers: { authorization: `Bearer ${TOKEN}` } }), env)
    expect(served.status).toBe(200)
    expect((await served.text()).startsWith('file:///docs/photo-1.jpg')).toBe(true)

    const second = await phone(env)
    await second.sync()
    const [seen] = await localDiaryMessages(second.db)
    expect(seen).toMatchObject({ id: 'd-1', text: 'First day at the new place', delivery: 'sent' })
    expect(seen.attachments[0]).toMatchObject({ mediaId: 'photo-1', previewId: 'photo-1-preview' })

    await updateDiaryMessage(second.db, 'd-1', seen.revision, { ...withPhoto, text: 'First day, edited', editedAt: NOW }, NOW)
    await second.sync()
    await first.sync()
    expect((await localDiaryMessages(first.db))[0]).toMatchObject({ text: 'First day, edited', editedAt: NOW, revision: 2 })
  })
})
