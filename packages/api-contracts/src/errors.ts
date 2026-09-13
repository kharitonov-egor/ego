import type { ChangeRecord } from './records'

export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'OFFLINE'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'

export interface ApiError {
  code: ApiErrorCode
  message: string
  /** Present on CONFLICT so the caller can offer Keep mine or Use saved version. */
  current?: ChangeRecord
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  AUTH_REQUIRED: 401,
  OFFLINE: 503,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVER_ERROR: 500
}

export function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: { code: 'INVALID_REQUEST', message } }
}

export function notFound<T>(message: string): ApiResult<T> {
  return { ok: false, error: { code: 'NOT_FOUND', message } }
}

export function conflict<T>(message: string, current?: ChangeRecord): ApiResult<T> {
  return { ok: false, error: { code: 'CONFLICT', message, current } }
}
