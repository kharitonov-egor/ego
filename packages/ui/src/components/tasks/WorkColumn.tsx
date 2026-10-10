import React from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import type { TrelloWork } from '../../lib/tasks/trello-work'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/** Sits in the column's header, which drags the list, so it keeps the press to itself. */
export function WorkRefresh({ work }: { work: TrelloWork }): React.ReactElement {
  return <button
    type="button"
    aria-label="Sync with Trello"
    title="Sync with Trello"
    disabled={work.syncing}
    onPointerDown={stop}
    onKeyDown={stop}
    onClick={(event) => {
      event.stopPropagation()
      work.refresh()
    }}
    className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-800 disabled:opacity-60"
  >
    <RefreshCw color={color.textMuted} size={16} className={cn(work.syncing && 'animate-spin motion-reduce:animate-none')} />
  </button>
}

export function WorkProblem({ text }: { text: string }): React.ReactElement {
  return <p className="flex items-start gap-1 px-3.5 pb-1.5 text-[12px] leading-4 text-red-300">
    <TriangleAlert size={12} className="mt-0.5 shrink-0" />{text}
  </p>
}
