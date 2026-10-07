import { describe, expect, it } from 'vitest'
import type { AssistantChat } from '@ego/api-contracts'
import { ASSISTANT_TOOLS, isAgentTrigger } from '@ego/core'
import {
  defaultChat, draftFromTrigger, findChat, fireMessage, momentInSentence, momentLabel, putChatFirst, testPushMessage, triggerFromDraft, trustOptions,
  withTrust, type TriggerDraft
} from './agent'

const BLANK: TriggerDraft = { type: 'daily', time: '07:00', weekday: 1, hours: '4', date: '2026-10-07' }

describe('the When picker', () => {
  it('builds each kind of trigger from only the fields it needs', () => {
    expect(triggerFromDraft({ ...BLANK, type: 'weekdays' })).toEqual({ type: 'weekdays', time: '07:00' })
    expect(triggerFromDraft({ ...BLANK, type: 'weekly', weekday: 7, time: '10:00' })).toEqual({ type: 'weekly', weekday: 7, time: '10:00' })
    expect(triggerFromDraft({ ...BLANK, type: 'interval', hours: '6' })).toEqual({ type: 'interval', hours: 6 })
    expect(triggerFromDraft({ ...BLANK, type: 'once', date: '2026-10-09', time: '15:30' })).toEqual({ type: 'once', date: '2026-10-09', time: '15:30' })
    expect(triggerFromDraft({ ...BLANK, type: 'manual', time: '' })).toEqual({ type: 'manual' })
  })

  it('says what is missing instead of saving a trigger the Worker would refuse', () => {
    expect(triggerFromDraft({ ...BLANK, time: '' })).toBe('Pick a time')
    expect(triggerFromDraft({ ...BLANK, type: 'once', date: '' })).toBe('Pick a date')
    expect(triggerFromDraft({ ...BLANK, type: 'interval', hours: '' })).toBe('Pick a whole number of hours from 1 to 168')
    expect(triggerFromDraft({ ...BLANK, type: 'interval', hours: '2.5' })).toBe('Pick a whole number of hours from 1 to 168')
    expect(triggerFromDraft({ ...BLANK, type: 'interval', hours: '169' })).toBe('Pick a whole number of hours from 1 to 168')
  })

  it('round-trips a saved trigger through the picker', () => {
    for (const trigger of [
      { type: 'daily', time: '21:15' }, { type: 'weekly', weekday: 3, time: '08:00' }, { type: 'interval', hours: 12 },
      { type: 'once', date: '2026-12-31', time: '23:59' }, { type: 'manual' }
    ]) {
      expect(isAgentTrigger(trigger)).toBe(true)
      if (isAgentTrigger(trigger)) expect(triggerFromDraft(draftFromTrigger(trigger, '2026-10-07'))).toEqual(trigger)
    }
  })
})

describe('agent labels', () => {
  it('names the day relative to now and the time on a 24-hour clock', () => {
    const now = new Date(2026, 9, 7, 12, 0)
    expect(momentLabel(new Date(2026, 9, 7, 7, 5).toISOString(), now)).toBe('Today at 7:05')
    expect(momentLabel(new Date(2026, 9, 8, 18, 30).toISOString(), now)).toBe('Tomorrow at 18:30')
    expect(momentLabel(new Date(2026, 9, 6, 9, 0).toISOString(), now)).toBe('Yesterday at 9:00')
    expect(momentLabel(new Date(2026, 9, 11, 10, 0).toISOString(), now)).toBe('Sun, Oct 11 at 10:00')
    expect(momentLabel('soon', now)).toBe('soon')
    expect(momentInSentence(new Date(2026, 9, 8, 9, 0).toISOString(), now)).toBe('tomorrow at 9:00')
    expect(momentInSentence(new Date(2026, 9, 11, 10, 0).toISOString(), now)).toBe('Sun, Oct 11 at 10:00')
  })

  it('reports a fire as started, failed, or with nothing to do', () => {
    expect(fireMessage({ fired: true, runs: 1, sessionUrl: null, error: null })).toBe('The agent is on it')
    expect(fireMessage({ fired: false, runs: 1, sessionUrl: null, error: 'The routine could not be reached' })).toBe('The routine could not be reached')
    expect(fireMessage({ fired: false, runs: 0, sessionUrl: null, error: null })).toBe('No goals are due right now')
  })

  it('reports a test push as sent, refused, or with no subscription to send to', () => {
    expect(testPushMessage({ sent: 1, failed: 0 })).toEqual({ text: 'Sent. It should show in a few seconds.', good: true })
    expect(testPushMessage({ sent: 1, failed: 1 }).good).toBe(true)
    expect(testPushMessage({ sent: 0, failed: 1 })).toEqual({ text: 'The push service turned it down. Turn notifications off and on again.', good: false })
    expect(testPushMessage({ sent: 0, failed: 0 }).text).toMatch(/no subscription for this browser/)
  })
})

describe('the chat list', () => {
  const chat = (id: string, kind?: 'chat' | 'agent'): AssistantChat => ({
    id, title: id, createdAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z', ...(kind ? { kind } : {})
  })
  const agent = chat('a', 'agent')

  it('finds the Agent chat by name and any other chat by id', () => {
    expect(findChat([agent, chat('b')], 'agent')).toBe(agent)
    expect(findChat([agent, chat('b')], 'b')?.id).toBe('b')
    expect(findChat([chat('b')], 'agent')).toBeNull()
  })

  it('opens the latest chat of the user\'s own by default', () => {
    expect(defaultChat([agent, chat('b'), chat('c')])?.id).toBe('b')
    expect(defaultChat([agent])).toBeNull()
  })

  it('keeps the Agent chat pinned above a chat that moves to the top', () => {
    expect(putChatFirst([agent, chat('b'), chat('c')], chat('c')).map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect(putChatFirst([agent, chat('b')], chat('n')).map((item) => item.id)).toEqual(['a', 'n', 'b'])
    expect(putChatFirst([chat('b')], chat('n')).map((item) => item.id)).toEqual(['n', 'b'])
  })
})

describe('trusted changes', () => {
  it('offers every write tool except goals and delegation, each with a plain label', () => {
    const options = trustOptions()
    const names = options.map((option) => option.name)
    expect(names).toContain('log_habit')
    expect(names).toContain('record_transactions')
    expect(names).not.toContain('create_goal')
    expect(names).not.toContain('update_goal')
    expect(names).not.toContain('delegate_task')
    expect(names.every((name) => ASSISTANT_TOOLS[name].access === 'write')).toBe(true)
    expect(options.filter((option) => option.label === option.name.replace(/_/g, ' '))).toEqual([])
  })

  it('toggles one tool and leaves the rest of the list alone', () => {
    expect(withTrust(['log_habit', 'create_goal'], 'record_transactions', true)).toEqual(['log_habit', 'create_goal', 'record_transactions'])
    expect(withTrust(['log_habit', 'create_goal'], 'log_habit', false)).toEqual(['create_goal'])
    expect(withTrust(['log_habit'], 'log_habit', true)).toEqual(['log_habit'])
  })
})
