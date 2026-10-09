import type { BrowserWorker } from '@cloudflare/puppeteer'
import type { ContentItemInput } from '@ego/core'
import type { Env } from './auth'
import { applyOperation } from './commands'

export const PREVIEW_PATH = '/v1/content/previews/'
const RETRY_AFTER_MS = 6 * 3_600_000
const MAX_ATTEMPTS = 3
const NAVIGATION_TIMEOUT_MS = 15_000

/** One JPEG per URL, or the reason that page could not be captured. */
export type PageRenderer = (urls: string[]) => Promise<Array<Uint8Array | string>>

interface PendingRow {
  id: string
  data: string
  revision: number
  status: 'ready' | 'failed' | null
  token: string | null
  attempts: number | null
  preview_url: string | null
}

function browserRenderer(binding: BrowserWorker): PageRenderer {
  return async (urls) => {
    const { default: puppeteer } = await import('@cloudflare/puppeteer')
    const browser = await puppeteer.launch(binding)
    const results: Array<Uint8Array | string> = []
    try {
      for (const url of urls) {
        const page = await browser.newPage()
        try {
          await page.setViewport({ width: 1024, height: 576, deviceScaleFactor: 0.625 })
          let status = 0
          try {
            status = (await page.goto(url, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT_MS }))?.status() ?? 0
          } catch (error) {
            // A page that keeps polling never goes idle but has usually painted by now.
            if (!(error instanceof Error && error.name === 'TimeoutError')) throw error
          }
          if (status >= 400) { results.push(`The page answered ${status}`); continue }
          await new Promise(resolve => setTimeout(resolve, 800))
          results.push(new Uint8Array(await page.screenshot({ type: 'jpeg', quality: 70 })))
        } catch (error) {
          results.push(error instanceof Error ? error.message.slice(0, 300) : 'The page could not be captured')
        } finally {
          await page.close().catch(() => undefined)
        }
      }
    } finally {
      await browser.close().catch(() => undefined)
    }
    return results
  }
}

export function previewBase(env: Env, request?: Request): string | undefined {
  return env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? (request ? new URL(request.url).origin : undefined)
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Screenshots live bookmarks that have no cover and makes the screenshot their cover through an
 * ordinary update, so every device picks it up on its next sync without a client release.
 */
export async function renderContentPreviews(
  env: Env, base: string | undefined, limit: number, render?: PageRenderer, now = new Date()
): Promise<{ applied: number; failed: number }> {
  const bucket = env.CONTENT_PREVIEWS
  const renderer = render ?? (env.BROWSER ? browserRenderer(env.BROWSER) : null)
  if (!bucket || !renderer || !base) return { applied: 0, failed: 0 }
  const nowIso = now.toISOString()
  const pending = (await env.DB.prepare(`SELECT i.id, i.data, i.revision, p.status, p.token, p.attempts, p.url AS preview_url
    FROM content_items i LEFT JOIN content_previews p ON p.item_id = i.id
    WHERE i.deleted_at IS NULL AND json_extract(i.data, '$.coverUrl') IS NULL AND json_extract(i.data, '$.trashedAt') IS NULL
      AND (p.item_id IS NULL OR p.url <> json_extract(i.data, '$.url') OR p.status = 'ready'
        OR (p.status = 'failed' AND p.attempts < ? AND p.updated_at < ?))
    ORDER BY i.created_at DESC LIMIT ?`)
    .bind(MAX_ATTEMPTS, new Date(now.getTime() - RETRY_AFTER_MS).toISOString(), limit).all<PendingRow>()).results
  const items = pending.map(row => ({ row, input: JSON.parse(row.data) as ContentItemInput }))
  const stale = items.filter(({ row, input }) => !(row.status === 'ready' && row.token && row.preview_url === input.url))
  const images = stale.length ? await renderer(stale.map(({ input }) => input.url)) : []
  let failed = 0
  for (const [index, { row, input }] of stale.entries()) {
    const image = images[index] ?? 'The page could not be captured'
    const attempts = row.preview_url === input.url ? (row.attempts ?? 0) + 1 : 1
    if (typeof image === 'string') {
      failed += 1
      await env.DB.prepare(`INSERT INTO content_previews (item_id, url, token, status, attempts, error, updated_at)
        VALUES (?, ?, NULL, 'failed', ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET url = excluded.url, token = NULL,
        status = 'failed', attempts = excluded.attempts, error = excluded.error, updated_at = excluded.updated_at`)
        .bind(row.id, input.url, attempts, image, nowIso).run()
      row.status = 'failed'
      continue
    }
    const token = randomToken()
    await bucket.put(`${token}.jpg`, image, { httpMetadata: { contentType: 'image/jpeg' } })
    await env.DB.prepare(`INSERT INTO content_previews (item_id, url, token, status, attempts, error, updated_at)
      VALUES (?, ?, ?, 'ready', ?, NULL, ?) ON CONFLICT(item_id) DO UPDATE SET url = excluded.url, token = excluded.token,
      status = 'ready', attempts = excluded.attempts, error = NULL, updated_at = excluded.updated_at`)
      .bind(row.id, input.url, token, attempts, nowIso).run()
    Object.assign(row, { status: 'ready', token, preview_url: input.url })
  }
  let applied = 0
  for (const { row, input } of items) {
    if (row.status !== 'ready' || !row.token) continue
    const result = await applyOperation(env.DB, {
      operationId: `preview-${row.token}`, entityId: row.id, expectedRevision: row.revision, createdAt: nowIso,
      command: { entity: 'contentItem', type: 'update', payload: { ...input, coverUrl: `${base}${PREVIEW_PATH}${row.token}.jpg` } }
    }, nowIso)
    // A conflict means a device edited the bookmark meanwhile; the next run applies the screenshot to the new revision.
    if (!result.ok) continue
    applied += 1
    await env.DB.prepare(`UPDATE content_previews SET status = 'applied', updated_at = ? WHERE item_id = ?`).bind(nowIso, row.id).run()
  }
  return { applied, failed }
}

export async function servePreview(env: Env, path: string): Promise<Response> {
  const name = path.slice(PREVIEW_PATH.length)
  const object = /^[a-f0-9]{48}\.jpg$/.test(name) ? await env.CONTENT_PREVIEWS?.get(name) : null
  if (!object) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  return new Response(object.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }
  })
}
