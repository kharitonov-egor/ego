#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import core from '@ego/core'

const { planTelegramImport, isDiaryMessageInput } = core

/**
 * Loads a Telegram Desktop JSON export into the diary through the Worker. Files go to R2 first,
 * then the messages. IDs come from Telegram's message IDs, so running it again skips what is
 * already there. A later export that has files this one left out fills them in.
 *
 *   EGO_API_URL, EGO_DEVICE_TOKEN   the Worker and a device token from ego-device enroll
 *
 *   node scripts/diary-import.mjs <export folder>            print the plan
 *   node scripts/diary-import.mjs <export folder> --apply    upload and send
 *
 * Needs the built core package (npm run typecheck builds it) and ffmpeg on PATH for video posters
 * and photo previews. Without ffmpeg it falls back to Telegram's small thumbnails.
 */

const BATCH = 25
const ATTEMPTS = 4
const SINGLE_UPLOAD_LIMIT = 95 * 1024 * 1024
const PART_SIZE = 20 * 1024 * 1024

const folder = process.argv.slice(2).find((value) => !value.startsWith('--'))
const apply = process.argv.includes('--apply')
if (!folder) {
  console.error('Usage: node scripts/diary-import.mjs <Telegram export folder> [--apply]')
  process.exit(1)
}
const resultPath = join(folder, 'result.json')
if (!existsSync(resultPath)) {
  console.error(`No result.json in ${folder}. Export the chat from Telegram Desktop as JSON.`)
  process.exit(1)
}

const plan = planTelegramImport(JSON.parse(readFileSync(resultPath, 'utf8')))
const scratch = mkdtempSync(join(tmpdir(), 'ego-diary-'))
let ffmpegWorks = true

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function onDisk(paths) {
  return paths.map((path) => join(folder, path)).find((path) => existsSync(path)) ?? null
}

function ffmpeg(args) {
  if (!ffmpegWorks) return false
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      ffmpegWorks = false
      console.warn('ffmpeg is not on PATH, so posters and previews use Telegram\'s thumbnails.')
    }
    return false
  }
}

function poster(video, out) {
  const scale = "scale='min(720,iw)':-2"
  return ffmpeg(['-ss', '0.5', '-i', video, '-frames:v', '1', '-vf', scale, '-q:v', '4', out]) ||
    ffmpeg(['-i', video, '-frames:v', '1', '-vf', scale, '-q:v', '4', out])
}

function preview(image, out) {
  const scale = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'"
  return ffmpeg(['-i', image, '-frames:v', '1', '-vf', scale, '-q:v', '3', out])
}

/** The bytes to upload for one planned file, or null when the export has nothing for it. */
function prepare(upload) {
  const source = onDisk(upload.candidates)
  if (source) {
    if (upload.transform === 'none') return { bytes: readFileSync(source), contentType: upload.mimeType, from: source }
    if (upload.transform === 'gunzip') {
      const json = gunzipSync(readFileSync(source))
      JSON.parse(json.toString('utf8'))
      return { bytes: json, contentType: 'application/json', from: source }
    }
    const out = join(scratch, `${upload.mediaId}.jpg`)
    const made = upload.transform === 'poster' ? poster(source, out) : preview(source, out)
    if (made && existsSync(out)) return { bytes: readFileSync(out), contentType: 'image/jpeg', from: `${source} (${upload.transform})` }
  }
  const fallback = onDisk(upload.fallbacks)
  if (fallback) return { bytes: readFileSync(fallback), contentType: TYPES[extname(fallback).toLowerCase()] ?? upload.mimeType, from: fallback }
  return null
}

/** Points the message only at files that exist; a missing original shows as missing in the app. */
function resolvedInput(message, ready) {
  const input = structuredClone(message.input)
  input.attachments = input.attachments.map((attachment) => ({
    ...attachment,
    mediaId: attachment.mediaId && ready.has(attachment.mediaId) ? attachment.mediaId : null,
    previewId: attachment.previewId && ready.has(attachment.previewId) ? attachment.previewId : null
  }))
  input.entities = input.entities.map((entity) => {
    if (!entity.mediaId || ready.has(entity.mediaId)) return entity
    const { mediaId: _dropped, ...rest } = entity
    return rest
  })
  return input
}

const prepared = new Map()
const missing = []
for (const message of plan.messages) {
  for (const upload of message.uploads) {
    const file = prepare(upload)
    if (file) prepared.set(upload.mediaId, file)
    else if (upload.role === 'file') missing.push(`${message.id}: ${upload.candidates[0] ?? 'a file with no name'}`)
  }
}
const bytes = [...prepared.values()].reduce((total, file) => total + file.bytes.length, 0)
const ready = new Set(prepared.keys())
const inputs = plan.messages.map((message) => ({ message, input: resolvedInput(message, ready) }))
const invalid = inputs.filter(({ input }) => !isDiaryMessageInput(input))

console.log(`"${plan.title}": ${plan.messages.length} messages from ${plan.messages.reduce((total, message) => total + message.telegramIds.length, 0)} Telegram posts.`)
console.log(`Albums merged: ${plan.messages.filter((message) => message.telegramIds.length > 1).length}. Forwards: ${plan.messages.filter((message) => message.input.forwarded).length}. Replies: ${plan.messages.filter((message) => message.input.replyToId).length}. Pinned: ${plan.messages.filter((message) => message.input.pinnedAt).length}.`)
console.log(`Files ready: ${prepared.size}, ${(bytes / 1024 / 1024).toFixed(1)} MB.`)
if (plan.skipped.length > 0) console.log(`Skipped ${plan.skipped.length}: ${plan.skipped.map((item) => `${item.telegramId} (${item.reason})`).join(', ')}`)
if (missing.length > 0) {
  console.log(`\n${missing.length} files are not in this export and will show as missing:`)
  for (const line of missing) console.log(`  ${line}`)
}
if (invalid.length > 0) {
  console.error(`\n${invalid.length} messages would be refused: ${invalid.map(({ message }) => message.id).join(', ')}`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

if (!apply) {
  console.log('\nAdd --apply to upload the files and send the messages.')
  rmSync(scratch, { recursive: true, force: true })
  process.exit(0)
}

const url = (process.env.EGO_API_URL ?? '').replace(/\/+$/, '')
const token = process.env.EGO_DEVICE_TOKEN ?? ''
if (!url || !token) {
  console.error('Set EGO_API_URL and EGO_DEVICE_TOKEN first.')
  process.exit(1)
}
const auth = { authorization: `Bearer ${token}` }

async function withRetries(label, work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      if (attempt >= ATTEMPTS || error.permanent) throw new Error(`${label}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    }
  }
}

async function call(path, init = {}) {
  const response = await fetch(`${url}${path}`, { ...init, headers: { ...auth, ...init.headers } })
  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    const error = new Error(`HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
    error.permanent = response.status < 500
    throw error
  }
  if (response.ok && payload?.ok === true) return payload.data
  const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
  error.permanent = response.status < 500
  throw error
}

async function stored(mediaId) {
  const response = await fetch(`${url}/v1/diary/media/${encodeURIComponent(mediaId)}`, { method: 'HEAD', headers: auth })
  if (response.status === 401) throw Object.assign(new Error('The device token was refused'), { permanent: true })
  return response.status === 200
}

async function send(mediaId, file) {
  const path = `/v1/diary/media/${encodeURIComponent(mediaId)}`
  if (file.bytes.length <= SINGLE_UPLOAD_LIMIT) {
    return call(path, { method: 'PUT', body: file.bytes, headers: { 'content-type': file.contentType } })
  }
  const start = await call(`${path}/multipart`, { method: 'POST', body: JSON.stringify({ contentType: file.contentType }), headers: { 'content-type': 'application/json' } })
  if (start.media) return start.media
  const uploadId = encodeURIComponent(start.uploadId)
  const parts = []
  for (let offset = 0, number = 1; offset < file.bytes.length; offset += PART_SIZE, number += 1) {
    parts.push(await call(`${path}/multipart/${uploadId}/${number}`, { method: 'PUT', body: file.bytes.subarray(offset, offset + PART_SIZE) }))
  }
  return call(`${path}/multipart/${uploadId}/complete`, { method: 'POST', body: JSON.stringify({ parts }), headers: { 'content-type': 'application/json' } })
}

const existing = new Map((await withRetries('Reading the diary', () => call('/v1/bootstrap'))).diaryMessages?.map((record) => [record.id, record]) ?? [])
const createdAt = new Date().toISOString()
const operations = []
for (const { message, input } of inputs) {
  const current = existing.get(message.id)
  if (!current) {
    operations.push({ operationId: `import-${message.id}`, entityId: message.id, expectedRevision: null, createdAt, command: { entity: 'diaryMessage', type: 'create', payload: input } })
    continue
  }
  const filled = current.attachments.map((attachment, index) => {
    const found = input.attachments[index]
    if (!found || attachment.kind !== found.kind) return attachment
    return {
      ...attachment,
      mediaId: attachment.mediaId ?? found.mediaId,
      previewId: attachment.previewId ?? found.previewId
    }
  })
  if (JSON.stringify(filled) === JSON.stringify(current.attachments)) continue
  const { id: _id, createdAt: _created, updatedAt: _updated, revision, ...saved } = current
  operations.push({
    operationId: `import-${message.id}-fill-${revision}`, entityId: message.id, expectedRevision: revision, createdAt,
    command: { entity: 'diaryMessage', type: 'update', payload: { ...saved, attachments: filled } }
  })
}

const needed = new Set()
for (const operation of operations) {
  const payload = operation.command.payload
  for (const attachment of payload.attachments) {
    if (attachment.mediaId) needed.add(attachment.mediaId)
    if (attachment.previewId) needed.add(attachment.previewId)
  }
  for (const entity of payload.entities) if (entity.mediaId) needed.add(entity.mediaId)
}

console.log(`\n${existing.size} diary messages already on the server. Sending ${operations.length} messages and up to ${needed.size} files.`)
let uploaded = 0
let skipped = 0
for (const mediaId of needed) {
  const file = prepared.get(mediaId)
  if (!file) continue
  if (await withRetries(`Checking ${mediaId}`, () => stored(mediaId))) {
    skipped += 1
    continue
  }
  await withRetries(`Uploading ${file.from}`, () => send(mediaId, file))
  uploaded += 1
  process.stdout.write(`\rUploaded ${uploaded} files`)
}
console.log(`\rUploaded ${uploaded} files, ${skipped} were already there.`)

let applied = 0
let duplicates = 0
for (let index = 0; index < operations.length; index += BATCH) {
  const batch = operations.slice(index, index + BATCH)
  const result = await withRetries('Sending messages', () => call('/v1/operations', {
    method: 'POST', body: JSON.stringify({ operations: batch }), headers: { 'content-type': 'application/json' }
  }))
  for (const outcome of result.results) {
    if (outcome.status === 'applied') applied += 1
    else duplicates += 1
  }
  if (result.failed) {
    console.error(`\nStopped at ${result.failed.operationId}: ${result.failed.error.message}`)
    process.exit(1)
  }
  process.stdout.write(`\rSent ${applied + duplicates} of ${operations.length}`)
}
console.log(`\rDone. ${applied} applied, ${duplicates} already there.`)
rmSync(scratch, { recursive: true, force: true })
