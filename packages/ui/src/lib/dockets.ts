import { isWeb } from './platform'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-10-06 15:02` in local time, the way the CLI prints it. */
export function stamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Where a docket link opens. In the browser it stays on the page's own origin, so the dev server
 * opens its own proxy and the cookie it set rather than the live site.
 */
export function pageHref(url: string, web = isWeb()): string {
  if (!web) return url
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

export function versionLabel(count: number): string {
  return count === 1 ? '1 version' : `${count} versions`
}

export function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 7) : ''
}
