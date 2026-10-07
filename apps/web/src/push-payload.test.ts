import { describe, expect, it } from 'vitest'
import { AGENT_ROUTE, clickedRoute, parsePushPayload, safeRoute } from './push-payload'

describe('parsePushPayload', () => {
  it('reads what the Worker sends', () => {
    const sent = { title: 'Rent is due', body: 'Pay it before Friday.', route: '/ai?chat=agent', tag: 'n-42', urgent: true }
    expect(parsePushPayload(JSON.stringify(sent))).toEqual(sent)
  })

  it('still has something to show when the payload is missing or unreadable', () => {
    const generic = { title: 'Ego', body: 'Your agent posted a message.', route: AGENT_ROUTE, tag: '', urgent: false }
    expect(parsePushPayload(undefined)).toEqual(generic)
    expect(parsePushPayload(null)).toEqual(generic)
    expect(parsePushPayload('')).toEqual(generic)
    expect(parsePushPayload('not json')).toEqual(generic)
    expect(parsePushPayload('"just a string"')).toEqual(generic)
    expect(parsePushPayload('[1, 2]')).toEqual(generic)
  })

  it('fills in each field that is missing or the wrong type', () => {
    expect(parsePushPayload(JSON.stringify({ title: '  ', body: '', tag: 7, urgent: 'yes', route: 5 })))
      .toEqual({ title: 'Ego', body: '', route: AGENT_ROUTE, tag: '', urgent: false })
  })
})

describe('safeRoute', () => {
  it('keeps a path on this site', () => {
    expect(safeRoute('/ai?chat=agent')).toBe('/ai?chat=agent')
    expect(safeRoute('/tasks#today')).toBe('/tasks#today')
    expect(safeRoute('/')).toBe('/')
  })

  it('sends anything that would leave the site to the Agent chat', () => {
    expect(safeRoute('https://evil.example/')).toBe(AGENT_ROUTE)
    expect(safeRoute('//evil.example/')).toBe(AGENT_ROUTE)
    expect(safeRoute('/\\evil.example/')).toBe(AGENT_ROUTE)
    expect(safeRoute('/\t/evil.example/')).toBe(AGENT_ROUTE)
    expect(safeRoute('ai?chat=agent')).toBe(AGENT_ROUTE)
    expect(safeRoute(undefined)).toBe(AGENT_ROUTE)
  })
})

describe('clickedRoute', () => {
  it('reads the route a notification stored', () => {
    expect(clickedRoute({ route: '/calendar' })).toBe('/calendar')
    expect(clickedRoute(null)).toBe(AGENT_ROUTE)
    expect(clickedRoute({ route: '//evil.example' })).toBe(AGENT_ROUTE)
  })
})
