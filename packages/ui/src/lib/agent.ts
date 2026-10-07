import type { AgentMemory, AgentMemorySource } from '@ego/api-contracts'

const SOURCE_LABELS: Record<AgentMemorySource, string> = { chat: 'Chat', agent: 'Claude', user: 'You' }

export function sourceLabel(source: AgentMemorySource): string {
  return SOURCE_LABELS[source]
}

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function dayLabel(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : DAY.format(at)
}

export function noteCount(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`
}

/** Adding text Ego already has returns the existing note, so it moves to the top instead of appearing twice. */
export function putFirst(memories: readonly AgentMemory[], memory: AgentMemory): AgentMemory[] {
  return [memory, ...memories.filter((item) => item.id !== memory.id)]
}
