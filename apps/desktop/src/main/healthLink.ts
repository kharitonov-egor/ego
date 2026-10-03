import { CALENDAR_RETURN_URL, HEALTH_RETURN_URL } from '@ego/api-contracts'

/**
 * Google sends the browser back to `ego://health` or `ego://calendar`, and Windows hands that link
 * to a second copy of Ego. This turns it into the app's route, keeping only the `connected` and
 * `error` values the screen reads, as the phone's does.
 */
function returnRouteIn(argv: readonly string[], returnUrl: string, route: string): string | null {
  const link = argv.find((value) => value === returnUrl || value.startsWith(`${returnUrl}?`))
  if (!link) return null
  let params: URLSearchParams
  try {
    params = new URL(link).searchParams
  } catch {
    return route
  }
  const next = new URLSearchParams()
  if (params.get('connected')) next.set('connected', '1')
  const error = params.get('error')
  if (error && /^[a-z_]{1,32}$/.test(error)) next.set('error', error)
  const query = next.toString()
  return query ? `${route}?${query}` : route
}

export function healthRouteIn(argv: readonly string[]): string | null {
  return returnRouteIn(argv, HEALTH_RETURN_URL, '/health')
}

export function calendarRouteIn(argv: readonly string[]): string | null {
  return returnRouteIn(argv, CALENDAR_RETURN_URL, '/calendar')
}

/** The Google return link in a launch, for whichever app it belongs to. */
export function googleReturnRouteIn(argv: readonly string[]): string | null {
  return healthRouteIn(argv) ?? calendarRouteIn(argv)
}
