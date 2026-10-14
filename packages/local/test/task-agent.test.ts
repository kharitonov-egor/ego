import { describe, expect, it } from 'vitest'
import type { TaskAgentRun } from '@ego/api-contracts'
import { agentChip } from '../src/tasks/agent'

const run = (overrides: Partial<TaskAgentRun>): TaskAgentRun => ({
  cardId: 'a', status: 'working', branch: 'jarvis/a-1', prUrl: null, note: null, updatedAt: '2026-10-14T00:00:00.000Z', ...overrides
})

describe('the Jarvis chip', () => {
  it('shows a card that just arrived as queued, and nothing on a done card without a run', () => {
    expect(agentChip(undefined, false)).toMatchObject({ status: 'queued', label: 'Queued', tone: 'muted', url: null })
    expect(agentChip(undefined, true)).toBeNull()
  })

  it('names the pull request and links it', () => {
    expect(agentChip(run({ status: 'pr', prUrl: 'https://github.com/kharitonov-egor/ego/pull/61' }), false))
      .toMatchObject({ label: 'PR #61', tone: 'positive', url: 'https://github.com/kharitonov-egor/ego/pull/61' })
  })

  it("prefers Jarvis's note to the stock text", () => {
    expect(agentChip(run({ status: 'asking', note: 'Which list?' }), false)).toMatchObject({ label: 'Asks you', tone: 'attention', detail: 'Which list?' })
    expect(agentChip(run({ status: 'failed' }), true)?.detail).toBe('Jarvis stopped. Drag the card out and back in to try again')
  })
})
