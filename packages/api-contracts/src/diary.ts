/** Which app a file belongs to. Each keeps its files under its own R2 prefix and route. */
export type MediaScope = 'diary' | 'tasks' | 'food'

/** What the Worker keeps about one uploaded file. The bytes are in R2 under `<scope>/<id>`. */
export interface DiaryMediaInfo {
  id: string
  contentType: string
  size: number
}

/** `media` is set instead of `uploadId` when the file is already stored, so there is nothing to send. */
export interface DiaryMultipartStart {
  uploadId: string | null
  media: DiaryMediaInfo | null
}

export interface DiaryMultipartPart {
  partNumber: number
  etag: string
}

export interface DiaryMultipartComplete {
  parts: DiaryMultipartPart[]
}

/**
 * One request body stays under Cloudflare's 100 MB cap. A bigger file goes up in parts, which R2
 * wants at least 5 MB each apart from the last.
 */
export const DIARY_SINGLE_UPLOAD_LIMIT = 95 * 1024 * 1024
export const DIARY_PART_SIZE = 20 * 1024 * 1024
export const DIARY_MAX_PARTS = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDiaryMultipartComplete(value: unknown): value is DiaryMultipartComplete {
  return isRecord(value) && Array.isArray(value.parts) && value.parts.length > 0 &&
    value.parts.length <= DIARY_MAX_PARTS &&
    value.parts.every((part) => isRecord(part) && Number.isSafeInteger(part.partNumber) &&
      Number(part.partNumber) >= 1 && Number(part.partNumber) <= DIARY_MAX_PARTS &&
      typeof part.etag === 'string' && part.etag.length > 0 && part.etag.length <= 200)
}
