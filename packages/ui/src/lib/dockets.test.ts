import { describe, expect, it } from 'vitest'
import { pageHref, stamp, versionLabel } from './dockets'

describe('docket list helpers', () => {
  it('stamps local time to the minute', () => {
    expect(stamp(new Date(2026, 9, 6, 15, 2).toISOString())).toBe('2026-10-06 15:02')
    expect(stamp('not a date')).toBe('not a date')
  })

  it('keeps a browser on its own origin and gives the desktop the full link', () => {
    expect(pageHref('https://ego.kharitonovegor.com/docket/k3x9qa7m2p/v/2', true)).toBe('/docket/k3x9qa7m2p/v/2')
    expect(pageHref('https://ego.kharitonovegor.com/docket/k3x9qa7m2p', false)).toBe('https://ego.kharitonovegor.com/docket/k3x9qa7m2p')
    expect(versionLabel(1)).toBe('1 version')
    expect(versionLabel(3)).toBe('3 versions')
  })
})
