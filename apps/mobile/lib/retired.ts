import * as SecureStore from 'expo-secure-store'
import type { RetiredCredentials } from './settings'

/** The same key the old direct-D1 client derived for its cached snapshot chunks. */
function legacyCacheKey(credentials: RetiredCredentials): string {
  const datasetId = `${credentials.cloudflareAccountId}:${credentials.d1DatabaseId}`
  let hash = 0x811c9dc5
  for (let index = 0; index < datasetId.length; index += 1) {
    hash ^= datasetId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `ego.money.snapshot.${hash.toString(36)}`
}

/** Deletes the old ledger copy that lived in SecureStore chunks next to the Cloudflare token. */
export async function clearLegacySnapshot(credentials: RetiredCredentials): Promise<void> {
  const key = legacyCacheKey(credentials)
  const metaRaw = await SecureStore.getItemAsync(`${key}.meta`).catch(() => null)
  let chunks = 0
  try {
    const meta: unknown = metaRaw ? JSON.parse(metaRaw) : null
    if (typeof meta === 'object' && meta !== null && 'chunks' in meta && Number.isSafeInteger(meta.chunks)) {
      chunks = Number(meta.chunks)
    }
  } catch {
    chunks = 0
  }
  await Promise.all(Array.from({ length: chunks }, (_, index) =>
    SecureStore.deleteItemAsync(`${key}.${index}`).catch(() => undefined)))
  await SecureStore.deleteItemAsync(`${key}.meta`).catch(() => undefined)
}
