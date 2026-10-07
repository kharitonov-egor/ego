import { describe, expect, it } from 'vitest'
import { docketOpenTarget } from './docket'

function at(url: string): Pick<Location, 'pathname' | 'search'> {
  const parsed = new URL(url, 'https://ego.kharitonovegor.com')
  return { pathname: parsed.pathname, search: parsed.search }
}

describe('docketOpenTarget', () => {
  it('sends a private docket link back to its page', () => {
    expect(docketOpenTarget(at('/dockets?open=k3x9qa7m2p'))).toBe('/docket/k3x9qa7m2p')
    expect(docketOpenTarget(at('/dockets?open=k3x9qa7m2p/v/12'))).toBe('/docket/k3x9qa7m2p/v/12')
  })

  it('goes nowhere for anything but a docket ID, so the link cannot redirect off the site', () => {
    expect(docketOpenTarget(at('/dockets'))).toBeNull()
    expect(docketOpenTarget(at('/dockets/k3x9qa7m2p?open=k3x9qa7m2p'))).toBeNull()
    expect(docketOpenTarget(at('/dockets?open=//evil.example'))).toBeNull()
    expect(docketOpenTarget(at('/dockets?open=k3x9qa7m2p/../../x'))).toBeNull()
    expect(docketOpenTarget(at('/dockets?open=K3X9QA7M2P'))).toBeNull()
  })
})
