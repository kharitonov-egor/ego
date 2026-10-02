/**
 * Storage is namespaced by the connection it belongs to. Pointing the app at another dataset
 * opens another file instead of mixing two ledgers.
 */
export function datasetIdFor(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function databaseFileFor(datasetId: string): string {
  return `ego-money-${datasetId}.db`
}
