import { describe, expect, it } from 'vitest'
import type { AgentNotification, AgentNotificationPage } from '@ego/api-contracts'
import { AGENT_CHAT_ROUTE, agentNotificationIdentifier, agentNotificationPlan, agentNotificationRoute } from '../lib/agent'

const now = new Date('2026-10-07T12:00:00.000Z')
const hours = (count: number): string => new Date(now.getTime() + count * 3_600_000).toISOString()

function notification(id: string, change: Partial<AgentNotification> = {}): AgentNotification {
  return {
    id, chatId: 'agent-chat', title: 'Weekday brief', body: 'Two tasks due today', deliverAt: hours(0), silent: false, createdAt: hours(-1),
    ...change
  }
}

function page(notifications: AgentNotification[], phone = true): AgentNotificationPage {
  return { notifications, cursor: 'cursor', devices: { phone, desktop: true, web: true } }
}

describe('agent notification plan', () => {
  it('shows a due message now and schedules a later one for its time', () => {
    const plan = agentNotificationPlan(page([notification('a', { deliverAt: hours(-1) }), notification('b', { deliverAt: hours(3) })]), now, new Set())
    expect(plan).toEqual([
      { identifier: agentNotificationIdentifier('a'), title: 'Weekday brief', body: 'Two tasks due today', at: null },
      { identifier: agentNotificationIdentifier('b'), title: 'Weekday brief', body: 'Two tasks due today', at: new Date(hours(3)) }
    ])
  })

  it('shows a message due this instant right away', () => {
    expect(agentNotificationPlan(page([notification('a')]), now, new Set())[0]?.at).toBeNull()
  })

  it('skips silent messages', () => {
    expect(agentNotificationPlan(page([notification('a', { silent: true })]), now, new Set())).toEqual([])
  })

  it('skips everything when Phone is switched off', () => {
    expect(agentNotificationPlan(page([notification('a')], false), now, new Set())).toEqual([])
  })

  it('skips messages delivered more than 6 hours ago', () => {
    const plan = agentNotificationPlan(page([
      notification('old', { deliverAt: hours(-6.1) }),
      notification('edge', { deliverAt: hours(-6) })
    ]), now, new Set())
    expect(plan.map((item) => item.identifier)).toEqual([agentNotificationIdentifier('edge')])
  })

  it('skips what the phone already shows or has scheduled', () => {
    const shown = new Set([agentNotificationIdentifier('a')])
    const plan = agentNotificationPlan(page([notification('a'), notification('b')]), now, shown)
    expect(plan.map((item) => item.identifier)).toEqual([agentNotificationIdentifier('b')])
  })

  it('skips a delivery time it cannot read', () => {
    expect(agentNotificationPlan(page([notification('a', { deliverAt: 'soon' })]), now, new Set())).toEqual([])
  })

  it('keeps one identifier per message, so scheduling twice replaces it', () => {
    const first = agentNotificationPlan(page([notification('a')]), now, new Set())
    const second = agentNotificationPlan(page([notification('a')]), now, new Set())
    expect(first[0]?.identifier).toBe(second[0]?.identifier)
  })
})

describe('agent notification taps', () => {
  it('opens the Agent chat', () => {
    expect(agentNotificationRoute(agentNotificationIdentifier('a'), { route: '/ai?chat=agent' })).toBe(AGENT_CHAT_ROUTE)
    expect(agentNotificationRoute(agentNotificationIdentifier('a'), undefined)).toBe(AGENT_CHAT_ROUTE)
    expect(agentNotificationRoute(agentNotificationIdentifier('a'), { route: 'https://example.com' })).toBe(AGENT_CHAT_ROUTE)
  })

  it('leaves other notifications alone', () => {
    expect(agentNotificationRoute('ego-task-card-1', { route: '/ai?chat=agent' })).toBeNull()
    expect(agentNotificationRoute('ego-daily-reminder-2026-10-07', undefined)).toBeNull()
  })
})
