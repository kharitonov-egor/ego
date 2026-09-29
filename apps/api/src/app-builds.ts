import type { ApiResult, AppBuild, AppBuildStatus } from '@ego/api-contracts'
import type { Env } from './auth'

interface AppBuildRow {
  id: string
  app_version: string
  build_number: number
  apk_url: string
  title: string | null
  git_commit: string | null
  completed_at: string
  expires_at: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function lower(value: unknown): string | null {
  return text(value)?.toLowerCase() ?? null
}

function hexBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{40}$/i.test(hex)) return null
  return new Uint8Array(hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [])
}

/** EAS signs the raw body with HMAC-SHA1 and sends `sha1=<hex>` in the expo-signature header. */
export async function isSignedByEas(secret: string, body: string, header: string | null): Promise<boolean> {
  const signature = header?.startsWith('sha1=') ? hexBytes(header.slice('sha1='.length)) : null
  if (!signature) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(body))
}

/** Only a finished internal Android APK can replace the app on the phone, so every other report is dropped. */
export function installableBuild(payload: unknown): AppBuild | null {
  if (!isRecord(payload)) return null
  if (lower(payload.platform) !== 'android' || lower(payload.status) !== 'finished') return null
  const artifacts = isRecord(payload.artifacts) ? payload.artifacts : {}
  const metadata = isRecord(payload.metadata) ? payload.metadata : {}
  if (lower(metadata.distribution) !== 'internal') return null
  const id = text(payload.id)
  const apkUrl = text(artifacts.buildUrl)
  const appVersion = text(metadata.appVersion)
  const completedAt = text(payload.completedAt)
  const buildNumber = Number(metadata.appBuildVersion)
  if (!id || !appVersion || !completedAt) return null
  if (!apkUrl?.startsWith('https://') || !apkUrl.toLowerCase().endsWith('.apk')) return null
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) return null
  const message = text(metadata.gitCommitMessage) ?? text(metadata.message)
  return {
    id,
    appVersion,
    buildNumber,
    apkUrl,
    title: message ? message.split('\n')[0].slice(0, 200) : null,
    commit: text(metadata.gitCommitHash),
    completedAt,
    expiresAt: text(payload.expirationDate)
  }
}

export async function receiveBuildWebhook(request: Request, env: Env): Promise<ApiResult<{ stored: boolean }>> {
  if (!env.EAS_WEBHOOK_SECRET) {
    return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'EAS_WEBHOOK_SECRET is not set on the Worker' } }
  }
  const body = await request.text()
  if (!await isSignedByEas(env.EAS_WEBHOOK_SECRET, body, request.headers.get('expo-signature'))) {
    return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'The expo-signature header does not match' } }
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'The body is not valid JSON' } }
  }
  const build = installableBuild(payload)
  if (!build) return { ok: true, data: { stored: false } }
  await env.DB.prepare(`INSERT INTO app_builds
      (id, app_version, build_number, apk_url, title, git_commit, completed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET app_version = excluded.app_version, build_number = excluded.build_number,
      apk_url = excluded.apk_url, title = excluded.title, git_commit = excluded.git_commit,
      completed_at = excluded.completed_at, expires_at = excluded.expires_at`)
    .bind(build.id, build.appVersion, build.buildNumber, build.apkUrl, build.title, build.commit,
      build.completedAt, build.expiresAt)
    .run()
  return { ok: true, data: { stored: true } }
}

export async function readAppBuilds(env: Env, now: string): Promise<AppBuildStatus> {
  const row = await env.DB.prepare(`SELECT * FROM app_builds
    WHERE expires_at IS NULL OR expires_at > ?
    ORDER BY build_number DESC, completed_at DESC LIMIT 1`).bind(now).first<AppBuildRow>()
  return {
    webhookReady: Boolean(env.EAS_WEBHOOK_SECRET),
    latest: row
      ? {
        id: row.id,
        appVersion: row.app_version,
        buildNumber: row.build_number,
        apkUrl: row.apk_url,
        title: row.title,
        commit: row.git_commit,
        completedAt: row.completed_at,
        expiresAt: row.expires_at
      }
      : null
  }
}
