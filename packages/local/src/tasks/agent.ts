import type { TaskAgentRun, TaskAgentStatus } from '@ego/api-contracts'

export type AgentTone = 'muted' | 'active' | 'attention' | 'positive' | 'danger'

/** The status chip on a card in an agent list, the same on every platform. */
export interface AgentChip {
  status: TaskAgentStatus
  label: string
  tone: AgentTone
  /** Jarvis's note when it left one, otherwise what the status means. */
  detail: string
  /** The pull request, which pressing the chip opens. */
  url: string | null
}

const PR_NUMBER = /\/pull\/(\d+)$/

/**
 * Null for a card that needs no chip. A card that just arrived has no run until the server sees it,
 * and shows as queued so the drop gets an answer at once.
 */
export function agentChip(run: TaskAgentRun | undefined, done: boolean): AgentChip | null {
  if (!run) {
    return done ? null : { status: 'queued', label: 'Queued', tone: 'muted', detail: 'Waiting to reach Jarvis', url: null }
  }
  const chip = (label: string, tone: AgentTone, detail: string, url: string | null = null): AgentChip =>
    ({ status: run.status, label, tone, detail: run.note ?? detail, url })
  switch (run.status) {
    case 'queued': return chip('Queued', 'muted', 'Waiting for a free slot on Jarvis')
    case 'sent': return chip('Starting', 'muted', 'Sent to Jarvis. Its T3 thread starts shortly')
    case 'working': return chip('Working', 'active', 'Jarvis is working on this in T3')
    case 'asking': return chip('Asks you', 'attention', 'Jarvis asked a question in its T3 thread')
    case 'pr': {
      const number = run.prUrl ? PR_NUMBER.exec(run.prUrl)?.[1] : undefined
      return chip(number ? `PR #${number}` : 'PR open', 'positive', 'The pull request is open. Nothing ships until you say so', run.prUrl)
    }
    case 'failed': return chip('Failed', 'danger', 'Jarvis stopped. Drag the card out and back in to try again')
  }
}
