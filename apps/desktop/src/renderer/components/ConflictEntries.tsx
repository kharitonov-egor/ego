import React, { useState } from 'react'
import type { SyncEntity } from '@ego/api-contracts'
import type { OutboxEntry } from '@ego/local/sync/outbox'
import { useLedger } from '../lib/ledger'
import { Button } from './ui/button'
import { Sheet } from './ui/dialog'

const ENTITY_LABELS: Record<SyncEntity, string> = {
  account: 'Account',
  category: 'Category',
  transaction: 'Transaction',
  purchase: 'Receipt',
  budget: 'Budget',
  gymCategory: 'Gym category',
  gymExercise: 'Exercise',
  gymSet: 'Set',
  gymWorkout: 'Workout order',
  gymPlan: 'Workout plan',
  mood: 'Mood entry',
  habit: 'Habit',
  habitEntry: 'Habit check-in',
  diaryMessage: 'Diary message',
  taskBoard: 'Board',
  taskList: 'List',
  taskLabel: 'Label',
  taskCard: 'Card',
  taskGoal: 'Goal',
  sheet: 'Sheet',
  sheetRow: 'Sheet row'
}

const COMMAND_LABELS: Record<string, string> = {
  create: 'new',
  update: 'edit',
  delete: 'delete',
  archive: 'archive',
  save: 'save'
}

export function changeLabel(entry: Pick<OutboxEntry, 'entity' | 'commandType'>): string {
  return `${ENTITY_LABELS[entry.entity] ?? entry.entity}, ${COMMAND_LABELS[entry.commandType] ?? entry.commandType}`
}

/** One decision at a time: a double click must not queue the same change twice. */
export function ConflictEntries({ entries, onKeepMine, onUseSaved }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => Promise<void>
  onUseSaved: (entry: OutboxEntry) => Promise<void>
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const decide = (choice: (entry: OutboxEntry) => Promise<void>, entry: OutboxEntry): void => {
    if (busy) return
    setBusy(true)
    void choice(entry).finally(() => setBusy(false))
  }
  return <>
    {entries.length === 0 && <p className="text-[16px] text-muted-foreground">Nothing needs attention.</p>}
    {entries.map((entry) => <div key={entry.operationId} className="mb-4 rounded-2xl border border-surface-700 bg-surface-900 p-4">
      <p className="text-[16px] font-semibold text-surface-100">{entry.lastError ?? 'This record changed on another device'}</p>
      <p className="mt-1 text-[14px] text-surface-400">{changeLabel(entry)}</p>
      {entry.status === 'conflict'
        ? <div className="mt-4 flex gap-2">
          <Button disabled={busy} onClick={() => decide(onKeepMine, entry)} className="flex-1">Keep mine</Button>
          <Button variant="outline" disabled={busy} onClick={() => decide(onUseSaved, entry)} className="flex-1">Use saved version</Button>
        </div>
        : <Button variant="outline" disabled={busy} onClick={() => decide(onUseSaved, entry)} className="mt-4 w-full">Discard this change</Button>}
    </div>)}
  </>
}

/** Every change the server turned down, from any app, in one place. */
export function ConflictsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement | null {
  const ledger = useLedger()
  return <Sheet visible={visible} title="Needs attention" onClose={onClose} dismissOnBackdrop>
    <ConflictEntries
      entries={ledger.conflicts}
      onKeepMine={ledger.resolveKeepMine}
      onUseSaved={ledger.resolveUseSaved}
    />
  </Sheet>
}
