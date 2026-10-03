import { HEALTH_RETURN_URL } from '@ego/api-contracts'

/**
 * Google Health sends the browser back to `ego://health`, and Windows hands that link to a second
 * copy of Ego. This turns it into the Health route, keeping only the `connected` and `error`
 * values the overview reads, as the phone's does.
 */
export function healthRouteIn(argv: readonly string[]): string | null {
  const link = argv.find((value) => value === HEALTH_RETURN_URL || value.startsWith(`${HEALTH_RETURN_URL}?`))
  if (!link) return null
  let params: URLSearchParams
  try {
    params = new URL(link).searchParams
  } catch {
    return '/health'
  }
  const route = new URLSearchParams()
  if (params.get('connected')) route.set('connected', '1')
  const error = params.get('error')
  if (error && /^[a-z_]{1,32}$/.test(error)) route.set('error', error)
  const query = route.toString()
  return query ? `/health?${query}` : '/health'
}
