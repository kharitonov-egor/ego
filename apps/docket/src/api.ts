import type { Connection } from './config.ts'

export const VERSION = '0.1.0'

const REQUEST_TIMEOUT_MS = 20_000
const UPLOAD_TIMEOUT_MS = 120_000

/** The CLI stands alone, so these repeat the shapes in @ego/api-contracts. */
export interface DocketSummary {
  id: string
  title: string
  description: string
  public: boolean
  repository: string | null
  latestVersion: number
  versionCount: number
  createdAt: string
  updatedAt: string
  url: string
}

export interface DocketVersion {
  version: number
  size: number
  commit: string | null
  ref: string | null
  createdAt: string
  url: string
}

export interface DocketDetail extends DocketSummary {
  versions: DocketVersion[]
}

export interface DocketUploaded {
  docket: DocketSummary
  version: number
  versionUrl: string
}

export interface KeySummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface UploadMeta {
  title?: string
  description?: string
  public?: boolean
  fileName?: string
  repository?: string
  commit?: string
  ref?: string
}

export interface DocketUpdate {
  title?: string
  description?: string
  public?: boolean
}

export class DocketError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unexpected(): DocketError {
  return new DocketError('Ego answered with something this version of docket does not understand', 'SERVER_ERROR')
}

function text(record: Fields, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') throw unexpected()
  return value
}

function maybeText(record: Fields, field: string): string | null {
  const value = record[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw unexpected()
  return value
}

function count(record: Fields, field: string): number {
  const value = record[field]
  if (typeof value !== 'number') throw unexpected()
  return value
}

function flag(record: Fields, field: string): boolean {
  const value = record[field]
  if (typeof value !== 'boolean') throw unexpected()
  return value
}

function record(value: unknown): Fields {
  if (!isRecord(value)) throw unexpected()
  return value
}

export function readSummary(value: unknown): DocketSummary {
  const row = record(value)
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    description: text(row, 'description'),
    public: flag(row, 'public'),
    repository: maybeText(row, 'repository'),
    latestVersion: count(row, 'latestVersion'),
    versionCount: count(row, 'versionCount'),
    createdAt: text(row, 'createdAt'),
    updatedAt: text(row, 'updatedAt'),
    url: text(row, 'url')
  }
}

export function readDetail(value: unknown): DocketDetail {
  const row = record(value)
  const versions = row.versions
  if (!Array.isArray(versions)) throw unexpected()
  return {
    ...readSummary(row),
    versions: versions.map((entry) => {
      const version = record(entry)
      return {
        version: count(version, 'version'),
        size: count(version, 'size'),
        commit: maybeText(version, 'commit'),
        ref: maybeText(version, 'ref'),
        createdAt: text(version, 'createdAt'),
        url: text(version, 'url')
      }
    })
  }
}

export function readList(value: unknown): DocketSummary[] {
  const dockets = record(value).dockets
  if (!Array.isArray(dockets)) throw unexpected()
  return dockets.map(readSummary)
}

export function readUploaded(value: unknown): DocketUploaded {
  const row = record(value)
  return { docket: readSummary(row.docket), version: count(row, 'version'), versionUrl: text(row, 'versionUrl') }
}

export function readKey(value: unknown): KeySummary {
  const row = record(value)
  return { id: text(row, 'id'), name: text(row, 'name'), createdAt: text(row, 'createdAt'), lastUsedAt: maybeText(row, 'lastUsedAt') }
}

function errorFrom(payload: unknown, status: number): DocketError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
  const code = error && typeof error.code === 'string' ? error.code : status === 401 ? 'AUTH_REQUIRED' : 'SERVER_ERROR'
  if (code === 'AUTH_REQUIRED') {
    return new DocketError('Ego did not accept this API key. Make a new one under Docket > CLI setup and run docket auth login.', code)
  }
  const message = error && typeof error.message === 'string' ? error.message : `Ego answered with HTTP ${status}`
  return new DocketError(message, code)
}

export interface Client {
  json: <T>(path: string, read: (data: unknown) => T, init?: RequestInit) => Promise<T>
  html: (path: string) => Promise<{ bytes: Uint8Array; version: number | null }>
}

export function createClient(connection: Connection, fetchImpl: typeof fetch): Client {
  const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${connection.key}`)
    headers.set('user-agent', `docket-cli/${VERSION}`)
    const timeout = init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    try {
      return await fetchImpl(`${connection.apiUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) })
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'it took too long to answer' : 'the network request failed'
      throw new DocketError(`Could not reach Ego at ${connection.apiUrl}: ${reason}`, 'OFFLINE')
    }
  }

  return {
    json: async (path, read, init) => {
      const response = await send(path, init)
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new DocketError(`Ego answered with HTTP ${response.status} and no readable body`, 'SERVER_ERROR')
      }
      if (!response.ok || !isRecord(payload) || payload.ok !== true) throw errorFrom(payload, response.status)
      return read(payload.data)
    },
    html: async (path) => {
      const response = await send(path)
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        throw errorFrom(payload, response.status)
      }
      const version = Number(response.headers.get('x-docket-version'))
      return { bytes: new Uint8Array(await response.arrayBuffer()), version: Number.isSafeInteger(version) && version > 0 ? version : null }
    }
  }
}

export function uploadForm(bytes: Uint8Array, meta: UploadMeta): FormData {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'text/html' }), meta.fileName ?? 'docket.html')
  form.append('meta', JSON.stringify(meta))
  return form
}
