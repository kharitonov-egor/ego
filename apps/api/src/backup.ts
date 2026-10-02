import type { Env } from './auth'

export const BACKUP_CRON = '0 7 * * *'
const MAX_POLLS = 60

type BackupEnv = Pick<Env, 'BACKUPS' | 'D1_ACCOUNT_ID' | 'D1_DATABASE_ID' | 'D1_EXPORT_TOKEN'>

interface ExportPoll {
  status: string
  bookmark: string
  signedUrl: string | null
  error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readPoll(body: unknown): ExportPoll {
  const result = isRecord(body) && isRecord(body.result) ? body.result : null
  const status = text(result?.status)
  const bookmark = text(result?.at_bookmark)
  if (!result || !status || !bookmark) throw new Error('D1 export returned an unexpected response')
  const output = isRecord(result.result) ? result.result : {}
  return { status, bookmark, signedUrl: text(output.signed_url), error: text(result.error) }
}

async function apiError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  const first = isRecord(body) && Array.isArray(body.errors) ? body.errors[0] : null
  const message = isRecord(first) ? text(first.message) : null
  return `D1 export failed with status ${response.status}${message ? `: ${message}` : ''}`
}

export function backupKey(now: Date): string {
  return `d1/${now.toISOString().slice(0, 10)}.sql`
}

export async function runScheduledBackup(env: BackupEnv, now: Date, pollDelayMs = 1000): Promise<void> {
  const { BACKUPS: bucket, D1_ACCOUNT_ID: account, D1_DATABASE_ID: database, D1_EXPORT_TOKEN: token } = env
  if (!bucket || !account || !database || !token) throw new Error('Database backup is not configured')

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/export`
  let bookmark: string | undefined
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ output_format: 'polling', current_bookmark: bookmark })
    })
    if (!response.ok) throw new Error(await apiError(response))
    const state = readPoll(await response.json())
    if (state.status === 'error') throw new Error(`D1 export failed: ${state.error ?? 'no reason given'}`)
    if (state.status === 'complete') {
      if (!state.signedUrl) throw new Error('D1 export finished without a download link')
      const download = await fetch(state.signedUrl)
      if (!download.ok || !download.body) throw new Error(`D1 export download failed with status ${download.status}`)
      await bucket.put(backupKey(now), download.body, {
        httpMetadata: { contentType: 'application/sql' },
        customMetadata: { bookmark: state.bookmark }
      })
      return
    }
    bookmark = state.bookmark
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs))
  }
  throw new Error('D1 export did not finish')
}
