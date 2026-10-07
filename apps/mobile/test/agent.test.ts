import { describe, expect, it } from 'vitest'
import { ASSISTANT_TOOLS, type AgentTrigger } from '@ego/core'
import {
  TRUSTABLE_TOOLS, TRUSTED_TOOL_LABELS, blankDraft, clockLabel, draftFor, draftTrigger, goalFormValue, normalizeClock, shiftClock
} from '../lib/agent'

const today = '2026-10-07'
const base = blankDraft(today)

describe('goal form', () => {
  it('builds each kind of trigger', () => {
    expect(draftTrigger({ ...base, type: 'weekdays', time: '7:00' })).toEqual({ type: 'weekdays', time: '07:00' })
    expect(draftTrigger({ ...base, type: 'weekly', weekday: 7, time: '18:00' })).toEqual({ type: 'weekly', weekday: 7, time: '18:00' })
    expect(draftTrigger({ ...base, type: 'interval', hours: '6' })).toEqual({ type: 'interval', hours: 6 })
    expect(draftTrigger({ ...base, type: 'once' })).toEqual({ type: 'once', date: '2026-10-08', time: '07:00' })
    expect(draftTrigger({ ...base, type: 'manual', time: '' })).toEqual({ type: 'manual' })
  })

  it('says what to fix', () => {
    expect(draftTrigger({ ...base, type: 'daily', time: '25:00' })).toBe('Enter the time as HH:MM, like 07:00')
    expect(draftTrigger({ ...base, type: 'interval', hours: '200' })).toBe('Hours go from 1 to 168')
    expect(draftTrigger({ ...base, type: 'interval', hours: '1.5' })).toBe('Hours go from 1 to 168')
    expect(draftTrigger({ ...base, type: 'once', date: '10/08/2026' })).toBe('Enter the date as YYYY-MM-DD')
  })

  it('needs a title and instructions', () => {
    expect(goalFormValue({ ...base, instructions: 'Post a brief' })).toBe('Give the goal a title')
    expect(goalFormValue({ ...base, title: 'Brief', instructions: 'Hi' })).toBe('Say what the agent should do')
    expect(goalFormValue({ ...base, title: ' Brief ', instructions: ' Post a brief ' }))
      .toEqual({ title: 'Brief', instructions: 'Post a brief', trigger: { type: 'daily', time: '07:00' } })
  })

  it('fills the form back from a saved goal', () => {
    const triggers: AgentTrigger[] = [
      { type: 'weekly', weekday: 3, time: '09:30' },
      { type: 'interval', hours: 12 },
      { type: 'once', date: '2026-12-01', time: '20:00' },
      { type: 'manual' }
    ]
    for (const trigger of triggers) {
      expect(draftTrigger(draftFor({ title: 'Goal', instructions: 'Do it', trigger }, today))).toEqual(trigger)
    }
  })

  it('pads a one-digit hour', () => {
    expect(normalizeClock(' 7:05 ')).toBe('07:05')
    expect(normalizeClock('7.05')).toBe('7.05')
  })
})

describe('agent settings', () => {
  it('labels every write the agent can be trusted with', () => {
    for (const tool of TRUSTABLE_TOOLS) {
      expect(ASSISTANT_TOOLS[tool.name].access).toBe('write')
      expect(TRUSTED_TOOL_LABELS[tool.name]).toBe(tool.label)
    }
    const names = TRUSTABLE_TOOLS.map((tool) => tool.name)
    expect(names).toContain('log_habit')
    expect(names).not.toContain('create_goal')
    expect(names).not.toContain('delegate_task')
  })

  it('steps quiet hours around midnight', () => {
    expect(shiftClock('23:30', 30)).toBe('00:00')
    expect(shiftClock('00:00', -30)).toBe('23:30')
    expect(clockLabel('22:00')).toBe('10:00 PM')
    expect(clockLabel('00:30')).toBe('12:30 AM')
    expect(clockLabel('12:00')).toBe('12:00 PM')
  })
})
