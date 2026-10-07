import React from 'react'
import { isWeb } from '../lib/platform'

/** A link that leaves Ego: a plain new-tab link in the browser, the default browser on the desktop. */
export function ExternalLink({ href, className, children }: {
  href: string
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  if (isWeb()) return <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>
  return <button
    type="button"
    onClick={() => void window.api.openExternalUrl(href).catch(() => undefined)}
    className={className}
  >{children}</button>
}
