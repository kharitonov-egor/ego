import {
  BROWSER_IDLE_DAYS, DOCKET_COOKIE, DOCKET_ID_LENGTH, DOCKET_ID_PATTERN, DOCKET_KEY_PREFIX, DOCKET_OPEN_PARAM,
  DOCKET_OPEN_PATH, DOCKET_SESSION_PATH, HTTP_STATUS, MAX_DOCKET_BYTES, MAX_DOCKET_DESCRIPTION, MAX_DOCKET_TITLE, TAB_IDLE_DAYS,
  isDocketUpdate, isDocketUploadMeta,
  type ApiErrorCode, type DeviceIdentity, type DocketDetail, type DocketKeyCreated, type DocketKeySummary, type DocketSummary,
  type DocketUploaded, type DocketUploadMeta, type DocketVersion
} from '@ego/api-contracts'
import { authorize, bearer, deviceExpiry, hashToken, touchDevice, type Env } from './auth'
import { query } from './reads'
import { formFile } from './services'
import { webOrigins } from './web'

/**
 * HTML pages that coding agents upload with the docket CLI. The CLI holds a key that reaches these
 * routes and nothing else; Ego's own screens use the device token. Pages are served under
 * `/docket/` on the web app's domain through Vercel, so each one runs sandboxed: a script in an
 * agent's HTML gets an opaque origin and cannot read the Ego sign-in kept on that domain.
 */

interface DocketRow {
  id: string
  dataset_id: string
  title: string
  description: string
  public: number
  repository: string | null
  latest_version: number
  created_at: string
  updated_at: string
  version_count: number
}

interface VersionRow {
  version: number
  object_key: string
  size: number
  commit_sha: string | null
  ref: string | null
  created_at: string
}

interface KeyRow {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

type Caller =
  | { kind: 'device'; device: DeviceIdentity }
  | { kind: 'key'; keyId: string; datasetId: string }

interface Upload {
  bytes: Uint8Array
  meta: DocketUploadMeta
}

const DOCKET_COLUMNS = `id, dataset_id, title, description, public, repository, latest_version, created_at, updated_at,
  (SELECT COUNT(*) FROM docket_versions WHERE docket_id = dockets.id) AS version_count`

/** The multipart wrapper around the file adds a little on top of the file itself. */
const UPLOAD_OVERHEAD = 64 * 1024
/** Title and description come from the head of the file, which is never this far in. */
const HEAD_BYTES = 64 * 1024
const MAX_REPOSITORY = 200
const MAX_COMMIT = 64
const MAX_REF = 200
const MAX_KEY_NAME = 80
const MIN_COOKIE_LENGTH = 32

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const PAGE_PATH = /^\/docket\/([a-z0-9]{10})(?:\/v\/([1-9][0-9]{0,5}))?$/

/** No allow-same-origin: that would hand the page the web app's storage. */
const DOCKET_PAGE_POLICY = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads; frame-ancestors 'none'"
const MESSAGE_PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  })
}

function ok<T>(data: T, headers: Record<string, string> = {}): Response {
  return json({ ok: true, data }, 200, headers)
}

function failure(code: ApiErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

function notFound(): Response {
  return failure('NOT_FOUND', 'No docket has that ID')
}

export function newDocketId(): string {
  let id = ''
  while (id.length < DOCKET_ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 252 is the largest multiple of 36 under 256, so every character is equally likely.
      if (byte < 252 && id.length < DOCKET_ID_LENGTH) id += ID_ALPHABET[byte % ID_ALPHABET.length]
    }
  }
  return id
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

function tidy(text: string, limit: number): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, limit)
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

export function htmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return (match && tidy(match[1], MAX_DOCKET_TITLE)) || null
}

export function htmlDescription(html: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag[0])
    if (attributes.get('name')?.toLowerCase() === 'description') return tidy(attributes.get('content') ?? '', MAX_DOCKET_DESCRIPTION) || null
  }
  return null
}

function fileTitle(fileName: string | undefined): string | null {
  const base = fileName?.split(/[\\/]/).pop()?.replace(/\.html?$/i, '').trim()
  return base ? base.slice(0, MAX_DOCKET_TITLE) : null
}

function baseUrl(env: Env): string {
  const configured = env.DOCKET_BASE_URL?.trim()
  return (configured || [...webOrigins(env)][0] || '').replace(/\/+$/, '')
}

function docketUrl(env: Env, id: string): string {
  return `${baseUrl(env)}/docket/${id}`
}

function versionUrl(env: Env, id: string, version: number): string {
  return `${docketUrl(env, id)}/v/${version}`
}

function summaryOf(env: Env, row: DocketRow): DocketSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    public: row.public === 1,
    repository: row.repository,
    latestVersion: row.latest_version,
    versionCount: row.version_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: docketUrl(env, row.id)
  }
}

function keyOf(row: KeyRow): DocketKeySummary {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at }
}

async function findDocket(db: D1Database, datasetId: string, id: string): Promise<DocketRow | null> {
  const rows = await query<DocketRow>(db, `SELECT ${DOCKET_COLUMNS} FROM dockets WHERE id = ? AND dataset_id = ?`, [id, datasetId])
  return rows[0] ?? null
}

async function versionsOf(db: D1Database, id: string): Promise<VersionRow[]> {
  return query<VersionRow>(db, `SELECT version, object_key, size, commit_sha, ref, created_at
    FROM docket_versions WHERE docket_id = ? ORDER BY version DESC`, [id])
}

async function caller(request: Request, env: Env, now: string): Promise<Caller | null> {
  const token = bearer(request)
  if (token?.startsWith(DOCKET_KEY_PREFIX)) {
    const row = await env.DB.prepare('SELECT id, dataset_id FROM docket_keys WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(await hashToken(token)).first<{ id: string; dataset_id: string }>()
    if (!row) return null
    await env.DB.prepare('UPDATE docket_keys SET last_used_at = ? WHERE id = ?').bind(now, row.id).run()
    return { kind: 'key', keyId: row.id, datasetId: row.dataset_id }
  }
  const device = await authorize(request, env.DB)
  if (!device.ok) return null
  void touchDevice(env.DB, device.data.deviceId, now).catch(() => undefined)
  return { kind: 'device', device: device.data }
}

function datasetOf(who: Caller): string {
  return who.kind === 'key' ? who.datasetId : who.device.datasetId
}

function cleanText(value: string | undefined, limit: number): string | undefined | null {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length > limit) return null
  return trimmed || undefined
}

/** Trims every field, drops empty ones, and refuses any that run too long. */
function cleanMeta(meta: DocketUploadMeta): DocketUploadMeta | string {
  const limits: Array<[keyof DocketUploadMeta, number, string]> = [
    ['title', MAX_DOCKET_TITLE, `The title can be up to ${MAX_DOCKET_TITLE} characters`],
    ['description', MAX_DOCKET_DESCRIPTION, `The description can be up to ${MAX_DOCKET_DESCRIPTION} characters`],
    ['fileName', 255, 'The file name is too long'],
    ['repository', MAX_REPOSITORY, 'The repository name is too long'],
    ['commit', MAX_COMMIT, 'The commit is too long'],
    ['ref', MAX_REF, 'The branch name is too long']
  ]
  const cleaned: DocketUploadMeta = { public: meta.public }
  for (const [field, limit, message] of limits) {
    const value = meta[field]
    const text = cleanText(typeof value === 'string' ? value : undefined, limit)
    if (text === null) return message
    if (text !== undefined) Object.assign(cleaned, { [field]: text })
  }
  return cleaned
}

function tooLarge(): Response {
  return failure('INVALID_REQUEST', `A docket can be up to ${MAX_DOCKET_BYTES / 1024 / 1024} MB. Inline fewer or smaller images.`)
}

async function readUpload(request: Request): Promise<Upload | Response> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_DOCKET_BYTES + UPLOAD_OVERHEAD) return tooLarge()
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return failure('INVALID_REQUEST', 'Send the HTML as multipart form data with a file part')
  }
  const file = formFile(form, 'file')
  if (!file) return failure('INVALID_REQUEST', 'The upload has no file')
  if (file.size === 0) return failure('INVALID_REQUEST', 'The file is empty')
  if (file.size > MAX_DOCKET_BYTES) return tooLarge()
  const rawMeta = form.get('meta')
  let meta: unknown = {}
  if (typeof rawMeta === 'string' && rawMeta.trim()) {
    try {
      meta = JSON.parse(rawMeta)
    } catch {
      return failure('INVALID_REQUEST', 'The upload details are not valid JSON')
    }
  }
  if (!isDocketUploadMeta(meta)) return failure('INVALID_REQUEST', 'Check the upload details')
  const cleaned = cleanMeta(meta)
  if (typeof cleaned === 'string') return failure('INVALID_REQUEST', cleaned)
  return { bytes: new Uint8Array(await file.arrayBuffer()), meta: cleaned }
}

function headOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, HEAD_BYTES))
}

function bucketOf(env: Env): R2Bucket | null {
  return env.DOCKETS ?? null
}

function storageMissing(): Response {
  return failure('NOT_CONFIGURED', 'Docket storage is not set up on the server')
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint/i.test(error.message)
}

async function uploaded(env: Env, datasetId: string, id: string, version: number): Promise<Response> {
  const row = await findDocket(env.DB, datasetId, id)
  if (!row) return notFound()
  const body: DocketUploaded = { docket: summaryOf(env, row), version, versionUrl: versionUrl(env, id, version) }
  return ok(body)
}

async function storeVersion(bucket: R2Bucket, id: string, bytes: Uint8Array): Promise<string> {
  const objectKey = `dockets/${id}/${crypto.randomUUID()}.html`
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: 'text/html; charset=utf-8' } })
  return objectKey
}

function insertVersion(db: D1Database, id: string, version: number, objectKey: string, upload: Upload, sha: string,
  keyId: string | null, now: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO docket_versions (docket_id, version, object_key, size, sha256, repository, commit_sha, ref,
    key_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, version, objectKey, upload.bytes.byteLength, sha, upload.meta.repository ?? null, upload.meta.commit ?? null,
      upload.meta.ref ?? null, keyId, now)
}

async function createDocket(env: Env, who: Caller, upload: Upload, now: string): Promise<Response> {
  const bucket = bucketOf(env)
  if (!bucket) return storageMissing()
  const datasetId = datasetOf(who)
  const head = headOf(upload.bytes)
  const title = upload.meta.title ?? htmlTitle(head) ?? fileTitle(upload.meta.fileName) ?? 'Untitled docket'
  const description = upload.meta.description ?? htmlDescription(head) ?? ''
  const sha = await sha256Hex(upload.bytes)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = newDocketId()
    const taken = await env.DB.prepare('SELECT 1 AS taken FROM dockets WHERE id = ?').bind(id).first<{ taken: number }>()
    if (taken) continue
    const objectKey = await storeVersion(bucket, id, upload.bytes)
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO dockets (id, dataset_id, title, description, public, repository, latest_version,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
          .bind(id, datasetId, title, description, upload.meta.public === true ? 1 : 0, upload.meta.repository ?? null, now, now),
        insertVersion(env.DB, id, 1, objectKey, upload, sha, who.kind === 'key' ? who.keyId : null, now)
      ])
    } catch (error) {
      await bucket.delete(objectKey)
      if (isConstraintError(error)) continue
      throw error
    }
    return uploaded(env, datasetId, id, 1)
  }
  return failure('CONFLICT', 'Could not find a free docket ID. Upload again.')
}

async function addVersion(env: Env, who: Caller, id: string, upload: Upload, now: string): Promise<Response> {
  const bucket = bucketOf(env)
  if (!bucket) return storageMissing()
  const datasetId = datasetOf(who)
  const row = await findDocket(env.DB, datasetId, id)
  if (!row) return notFound()
  const head = headOf(upload.bytes)
  const version = row.latest_version + 1
  const title = upload.meta.title ?? htmlTitle(head) ?? row.title
  const description = upload.meta.description ?? htmlDescription(head) ?? row.description
  const visible = upload.meta.public === undefined ? row.public : upload.meta.public ? 1 : 0
  const objectKey = await storeVersion(bucket, id, upload.bytes)
  try {
    await env.DB.batch([
      insertVersion(env.DB, id, version, objectKey, upload, await sha256Hex(upload.bytes), who.kind === 'key' ? who.keyId : null, now),
      env.DB.prepare(`UPDATE dockets SET latest_version = ?, title = ?, description = ?, public = ?,
        repository = COALESCE(?, repository), updated_at = ? WHERE id = ? AND latest_version = ?`)
        .bind(version, title, description, visible, upload.meta.repository ?? null, now, id, row.latest_version)
    ])
  } catch (error) {
    await bucket.delete(objectKey)
    if (isConstraintError(error)) return failure('CONFLICT', 'Another version was uploaded at the same moment. Upload again.')
    throw error
  }
  return uploaded(env, datasetId, id, version)
}

async function listDockets(env: Env, datasetId: string): Promise<Response> {
  const rows = await query<DocketRow>(env.DB, `SELECT ${DOCKET_COLUMNS} FROM dockets WHERE dataset_id = ?
    ORDER BY updated_at DESC, id`, [datasetId])
  return ok({ dockets: rows.map((row) => summaryOf(env, row)) })
}

async function readDocket(env: Env, datasetId: string, id: string): Promise<Response> {
  const row = await findDocket(env.DB, datasetId, id)
  if (!row) return notFound()
  const versions: DocketVersion[] = (await versionsOf(env.DB, id)).map((version) => ({
    version: version.version,
    size: version.size,
    commit: version.commit_sha,
    ref: version.ref,
    createdAt: version.created_at,
    url: versionUrl(env, id, version.version)
  }))
  const detail: DocketDetail = { ...summaryOf(env, row), versions }
  return ok(detail)
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Visibility and wording only. A new version is the only way to change the HTML. */
async function updateDocket(request: Request, env: Env, datasetId: string, id: string): Promise<Response> {
  const body = await readJson(request)
  if (!isDocketUpdate(body)) return failure('INVALID_REQUEST', 'Send a title, a description, or public')
  const title = cleanText(body.title, MAX_DOCKET_TITLE)
  if (title === null) return failure('INVALID_REQUEST', `The title can be up to ${MAX_DOCKET_TITLE} characters`)
  if (body.title !== undefined && title === undefined) return failure('INVALID_REQUEST', 'The title cannot be empty')
  if (body.description !== undefined && body.description.trim().length > MAX_DOCKET_DESCRIPTION) {
    return failure('INVALID_REQUEST', `The description can be up to ${MAX_DOCKET_DESCRIPTION} characters`)
  }
  const result = await env.DB.prepare(`UPDATE dockets SET title = COALESCE(?, title), description = COALESCE(?, description),
    public = COALESCE(?, public) WHERE id = ? AND dataset_id = ?`)
    .bind(title ?? null, body.description?.trim() ?? null, body.public === undefined ? null : body.public ? 1 : 0, id, datasetId)
    .run()
  if ((result.meta.changes ?? 0) === 0) return notFound()
  return readDocket(env, datasetId, id)
}

async function deleteDocket(env: Env, datasetId: string, id: string): Promise<Response> {
  const row = await findDocket(env.DB, datasetId, id)
  if (!row) return notFound()
  const versions = await versionsOf(env.DB, id)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM docket_versions WHERE docket_id = ?').bind(id),
    env.DB.prepare('DELETE FROM dockets WHERE id = ? AND dataset_id = ?').bind(id, datasetId)
  ])
  const bucket = bucketOf(env)
  if (bucket && versions.length > 0) await bucket.delete(versions.map((version) => version.object_key)).catch(() => undefined)
  return ok({ deleted: true })
}

async function readHtml(env: Env, datasetId: string, id: string, url: URL): Promise<Response> {
  const bucket = bucketOf(env)
  if (!bucket) return storageMissing()
  const row = await findDocket(env.DB, datasetId, id)
  if (!row) return notFound()
  const asked = url.searchParams.get('version')
  const version = asked === null ? row.latest_version : Number(asked)
  if (!Number.isSafeInteger(version) || version < 1) return failure('INVALID_REQUEST', 'version must be a version number')
  const stored = await env.DB.prepare('SELECT object_key FROM docket_versions WHERE docket_id = ? AND version = ?')
    .bind(id, version).first<{ object_key: string }>()
  const object = stored ? await bucket.get(stored.object_key) : null
  if (!object) return failure('NOT_FOUND', `This docket has no version ${version}`)
  return new Response(object.body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-docket-version': String(version) }
  })
}

async function listKeys(env: Env, datasetId: string): Promise<Response> {
  const rows = await query<KeyRow>(env.DB, `SELECT id, name, created_at, last_used_at FROM docket_keys
    WHERE dataset_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id`, [datasetId])
  return ok({ keys: rows.map(keyOf) })
}

async function createKey(request: Request, env: Env, datasetId: string, now: string): Promise<Response> {
  const body = await readJson(request)
  const asked = typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string' ? body.name.trim() : ''
  if (asked.length > MAX_KEY_NAME) return failure('INVALID_REQUEST', `A key name can be up to ${MAX_KEY_NAME} characters`)
  const token = `${DOCKET_KEY_PREFIX}${randomToken()}`
  const key: DocketKeySummary = { id: crypto.randomUUID(), name: asked || `CLI · ${now.slice(0, 10)}`, createdAt: now, lastUsedAt: null }
  await env.DB.prepare(`INSERT INTO docket_keys (id, dataset_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(key.id, datasetId, key.name, await hashToken(token), now).run()
  const created: DocketKeyCreated = { key, token }
  return ok(created)
}

async function revokeKey(env: Env, datasetId: string, keyId: string, now: string): Promise<Response> {
  const result = await env.DB.prepare('UPDATE docket_keys SET revoked_at = ? WHERE id = ? AND dataset_id = ? AND revoked_at IS NULL')
    .bind(now, keyId, datasetId).run()
  return (result.meta.changes ?? 0) === 1 ? ok({ revoked: true }) : failure('NOT_FOUND', 'That key is already revoked')
}

async function currentKey(env: Env, keyId: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, name, created_at, last_used_at FROM docket_keys WHERE id = ?')
    .bind(keyId).first<KeyRow>()
  return row ? ok(keyOf(row)) : failure('AUTH_REQUIRED', 'That key was revoked')
}

async function keyRoute(request: Request, env: Env, who: Caller, path: string, now: string): Promise<Response> {
  if (path === '/v1/docket-keys/current' && request.method === 'GET') {
    return who.kind === 'key' ? currentKey(env, who.keyId) : failure('NOT_FOUND', 'Only a CLI key has a current key')
  }
  if (who.kind !== 'device') return failure('INVALID_REQUEST', 'A CLI key cannot manage keys. Use CLI setup in Ego.')
  const datasetId = datasetOf(who)
  if (path === '/v1/docket-keys') {
    if (request.method === 'GET') return listKeys(env, datasetId)
    if (request.method === 'POST') return createKey(request, env, datasetId, now)
  }
  if (request.method === 'DELETE' && path.startsWith('/v1/docket-keys/')) {
    return revokeKey(env, datasetId, decodeURIComponent(path.slice('/v1/docket-keys/'.length)), now)
  }
  return failure('NOT_FOUND', 'That endpoint does not exist')
}

async function docketApi(request: Request, env: Env, path: string, now: string): Promise<Response> {
  const who = await caller(request, env, now)
  if (!who) return failure('AUTH_REQUIRED', 'Sign in again, or run docket auth login with a new key')
  if (path.startsWith('/v1/docket-keys')) return keyRoute(request, env, who, path, now)
  const datasetId = datasetOf(who)
  const { method } = request
  if (path === '/v1/dockets') {
    if (method === 'GET') return listDockets(env, datasetId)
    if (method === 'POST') {
      const upload = await readUpload(request)
      return upload instanceof Response ? upload : createDocket(env, who, upload, now)
    }
    return failure('NOT_FOUND', 'That endpoint does not exist')
  }
  const [id, child, ...rest] = path.slice('/v1/dockets/'.length).split('/')
  if (!DOCKET_ID_PATTERN.test(id) || rest.length > 0) return notFound()
  if (child === undefined) {
    if (method === 'GET') return readDocket(env, datasetId, id)
    if (method === 'PATCH') return updateDocket(request, env, datasetId, id)
    if (method === 'DELETE') return deleteDocket(env, datasetId, id)
  }
  if (child === 'versions' && method === 'POST') {
    const upload = await readUpload(request)
    return upload instanceof Response ? upload : addVersion(env, who, id, upload, now)
  }
  if (child === 'html' && method === 'GET') return readHtml(env, datasetId, id, new URL(request.url))
  return failure('NOT_FOUND', 'That endpoint does not exist')
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || null
  }
  return null
}

function cookieHeader(value: string, maxAgeSeconds: number | null): string {
  const lifetime = maxAgeSeconds === null ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${DOCKET_COOKIE}=${value}; Path=/docket; HttpOnly; Secure; SameSite=Lax${lifetime}`
}

/**
 * The web app calls this through its own domain whenever it runs signed in, so the browser holds a
 * cookie for private docket pages. A cookie that still matches is sent back unchanged with a fresh
 * lifetime; two tabs asking together would otherwise each replace the other's.
 */
async function docketSession(request: Request, env: Env, now: string): Promise<Response> {
  if (request.method !== 'POST') return failure('NOT_FOUND', 'That endpoint does not exist')
  const device = await authorize(request, env.DB)
  if (!device.ok) return failure('AUTH_REQUIRED', 'Sign in to Ego again')
  void touchDevice(env.DB, device.data.deviceId, now).catch(() => undefined)
  const row = await env.DB.prepare('SELECT docket_cookie_hash, idle_days FROM devices WHERE id = ?')
    .bind(device.data.deviceId).first<{ docket_cookie_hash: string | null; idle_days: number | null }>()
  const presented = cookieValue(request, DOCKET_COOKIE)
  let token = presented && row?.docket_cookie_hash && await hashToken(presented) === row.docket_cookie_hash ? presented : null
  if (!token) {
    token = randomToken()
    await env.DB.prepare('UPDATE devices SET docket_cookie_hash = ? WHERE id = ?').bind(await hashToken(token), device.data.deviceId).run()
  }
  // A tab-only sign-in gets a cookie that ends with the browser session.
  const maxAge = row?.idle_days === TAB_IDLE_DAYS ? null : BROWSER_IDLE_DAYS * 86_400
  return ok({ ready: true }, { 'set-cookie': cookieHeader(token, maxAge) })
}

/** The dataset of the browser whose cookie came with the page request, or null for none or a stale one. */
async function cookieViewer(token: string | null, env: Env, now: string): Promise<string | null> {
  if (!token || token.length < MIN_COOKIE_LENGTH) return null
  const row = await env.DB.prepare(`SELECT dataset_id, created_at, last_seen_at, idle_days FROM devices
    WHERE docket_cookie_hash = ? AND revoked_at IS NULL`).bind(await hashToken(token))
    .first<{ dataset_id: string; created_at: string; last_seen_at: string | null; idle_days: number | null }>()
  if (!row) return null
  const expiry = deviceExpiry(row)
  return expiry !== null && expiry <= now ? null : row.dataset_id
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Ego's own pages for a missing or private docket, in the app's black and white. */
function messagePage(status: number, title: string, detail: string, action: { label: string; href: string } | null,
  extraHeaders: Record<string, string> = {}): Response {
  const button = action ? `<a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ''
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { height: 100%; margin: 0; background: #000; color: #fafafa; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { display: flex; min-height: 100%; flex-direction: column; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; text-align: center; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 10px 0 0; max-width: 420px; color: #a3a3a3; font-size: 16px; line-height: 24px; }
  a { margin-top: 24px; display: inline-block; border-radius: 12px; background: #fafafa; color: #000; padding: 12px 20px; font-weight: 600; text-decoration: none; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${button}</main></body>
</html>`
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': MESSAGE_PAGE_POLICY,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      ...extraHeaders
    }
  })
}

function missingPage(): Response {
  return messagePage(404, 'No docket here', 'This docket was deleted, or the link is wrong.', null)
}

async function docketPage(request: Request, env: Env, path: string, now: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return messagePage(405, 'Not allowed', 'Dockets can only be viewed.', null)
  const match = PAGE_PATH.exec(path)
  if (!match) return missingPage()
  const [, id, asked] = match
  const row = await env.DB.prepare('SELECT dataset_id, public, latest_version FROM dockets WHERE id = ?')
    .bind(id).first<{ dataset_id: string; public: number; latest_version: number }>()
  if (!row) return missingPage()
  if (row.public !== 1) {
    const presented = cookieValue(request, DOCKET_COOKIE)
    const viewer = await cookieViewer(presented, env, now)
    if (viewer !== row.dataset_id) {
      const target = asked ? `${id}/v/${asked}` : id
      const href = `${baseUrl(env)}${DOCKET_OPEN_PATH}?${DOCKET_OPEN_PARAM}=${target}`
      const stale: Record<string, string> = presented !== null && viewer === null ? { 'set-cookie': cookieHeader('', 0) } : {}
      return messagePage(401, 'This docket is private', 'Sign in to Ego in this browser to see it.', { label: 'Open in Ego', href }, stale)
    }
  }
  const bucket = bucketOf(env)
  if (!bucket) return messagePage(503, 'Dockets are not set up', 'The server has no docket storage yet.', null)
  const version = asked ? Number(asked) : row.latest_version
  const stored = await env.DB.prepare('SELECT object_key FROM docket_versions WHERE docket_id = ? AND version = ?')
    .bind(id, version).first<{ object_key: string }>()
  const object = stored ? await bucket.get(stored.object_key) : null
  if (!object) return messagePage(404, 'No such version', `This docket has no version ${version}.`, { label: 'Open the latest', href: docketUrl(env, id) })
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': DOCKET_PAGE_POLICY,
      'cache-control': row.public === 1 ? 'no-store' : 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow, noarchive'
    }
  })
}

/**
 * Docket routes check their own credentials: the CLI's key, a device token, or for a page the
 * private-docket cookie. Returns null for any other path.
 */
export function docketRoute(request: Request, env: Env, path: string, now: string): Promise<Response> | null {
  if (path === DOCKET_SESSION_PATH) return docketSession(request, env, now)
  if (path === '/docket' || path.startsWith('/docket/')) return docketPage(request, env, path, now)
  if (path === '/v1/dockets' || path.startsWith('/v1/dockets/') || path === '/v1/docket-keys' || path.startsWith('/v1/docket-keys/')) {
    return docketApi(request, env, path, now)
  }
  return null
}
