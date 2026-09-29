import { File, Paths, UploadType } from 'expo-file-system'
import {
  DIARY_PART_SIZE, DIARY_SINGLE_UPLOAD_LIMIT,
  type ApiResult, type DiaryMediaInfo, type DiaryMultipartPart
} from '@ego/api-contracts'
import { resultFrom, type DiaryMediaApi } from '../api-client'
import { reportUploadProgress } from './progress'
import type { PendingUpload, UploadTransport } from './uploads'

const OFFLINE: ApiResult<never> = { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }

async function put<T>(file: File, url: string, headers: Record<string, string>, onProgress: (sent: number) => void): Promise<ApiResult<T>> {
  try {
    const response = await file.upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      onProgress: ({ bytesSent }) => onProgress(bytesSent)
    })
    return resultFrom<T>(response.status, response.body)
  } catch {
    return OFFLINE
  }
}

/**
 * Past one request's limit the file goes up in parts. Each part is copied into the cache and
 * streamed from there, so at most one part is ever held in memory.
 */
async function putInParts(api: DiaryMediaApi, file: File, upload: PendingUpload): Promise<ApiResult<DiaryMediaInfo>> {
  const start = await api.diaryMultipartStart(upload.mediaId, upload.contentType)
  if (!start.ok) return start
  if (start.data.media) return { ok: true, data: start.data.media }
  const uploadId = start.data.uploadId
  if (!uploadId) return { ok: false, error: { code: 'SERVER_ERROR', message: 'The server did not start the upload' } }
  const parts: DiaryMultipartPart[] = []
  const count = Math.ceil(upload.size / DIARY_PART_SIZE)
  const handle = file.open()
  try {
    for (let number = 1; number <= count; number += 1) {
      const offset = (number - 1) * DIARY_PART_SIZE
      handle.offset = offset
      const chunk = new File(Paths.cache, `diary-part-${upload.mediaId}-${number}`)
      chunk.create({ overwrite: true })
      chunk.write(handle.readBytes(Math.min(DIARY_PART_SIZE, upload.size - offset)))
      const result = await put<DiaryMultipartPart>(chunk, api.diaryPartUrl(upload.mediaId, uploadId, number),
        { ...api.authHeaders(), 'content-type': 'application/octet-stream' },
        (sent) => reportUploadProgress(upload.mediaId, (offset + sent) / upload.size))
      chunk.delete()
      if (!result.ok) return result
      parts.push(result.data)
    }
  } finally {
    handle.close()
  }
  return api.diaryMultipartComplete(upload.mediaId, uploadId, parts)
}

export function diaryUploadTransport(api: DiaryMediaApi): UploadTransport {
  return async (upload) => {
    const file = new File(upload.localUri)
    if (!file.exists) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'This file is no longer on the phone' } }
    reportUploadProgress(upload.mediaId, 0)
    try {
      if (upload.size > DIARY_SINGLE_UPLOAD_LIMIT) return await putInParts(api, file, upload)
      return await put<DiaryMediaInfo>(file, api.diaryMediaUrl(upload.mediaId),
        { ...api.authHeaders(), 'content-type': upload.contentType },
        (sent) => reportUploadProgress(upload.mediaId, sent / Math.max(upload.size, 1)))
    } finally {
      reportUploadProgress(upload.mediaId, null)
    }
  }
}
