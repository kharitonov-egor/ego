import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_API_URL = 'https://ego-money.ega-khar.workers.dev'
export const DEFAULT_WEB_URL = 'https://ego.kharitonovegor.com'
export const KEY_PREFIX = 'egodk_'

export type Env = Readonly<Record<string, string | undefined>>

export interface SavedLogin {
  apiUrl: string
  key: string
  keyName: string | null
}

export interface Connection {
  apiUrl: string
  key: string
  /** Where the key came from, for `docket auth status`. */
  source: 'DOCKET_API_KEY' | 'config'
}

export function configPath(env: Env, platform: NodeJS.Platform = process.platform): string {
  if (env.DOCKET_CONFIG_DIR) return join(env.DOCKET_CONFIG_DIR, 'config.json')
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'docket', 'config.json')
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'docket', 'config.json')
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readLogin(path: string): Promise<SavedLogin | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.key !== 'string' || !parsed.key) return null
  return {
    apiUrl: typeof parsed.apiUrl === 'string' && parsed.apiUrl ? normalizeUrl(parsed.apiUrl) : DEFAULT_API_URL,
    key: parsed.key,
    keyName: typeof parsed.keyName === 'string' ? parsed.keyName : null
  }
}

/** Readable by this user only on macOS and Linux. On Windows the profile folder already is. */
export async function saveLogin(path: string, login: SavedLogin): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(login, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') await chmod(path, 0o600)
}

export async function clearLogin(path: string): Promise<boolean> {
  try {
    await rm(path)
    return true
  } catch {
    return false
  }
}

/** DOCKET_API_KEY wins over the saved login, so an agent's sandbox can bring its own key. */
export function resolveConnection(env: Env, saved: SavedLogin | null): Connection | null {
  const apiUrl = normalizeUrl(env.DOCKET_API_URL || saved?.apiUrl || DEFAULT_API_URL)
  const fromEnv = env.DOCKET_API_KEY?.trim()
  if (fromEnv) return { apiUrl, key: fromEnv, source: 'DOCKET_API_KEY' }
  return saved ? { apiUrl, key: saved.key, source: 'config' } : null
}

export function webUrl(env: Env): string {
  return normalizeUrl(env.DOCKET_WEB_URL || DEFAULT_WEB_URL)
}
