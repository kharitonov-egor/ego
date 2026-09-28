import React from 'react'
import { Pressable, View } from 'react-native'
import type { SyncEntity } from '@ego/api-contracts'
import type { OutboxEntry } from '../lib/sync/outbox'
import { TOUCH } from './money/tokens'
import { Text } from './ui/text'

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
  mood: 'Mood entry',
  habit: 'Habit',
  habitEntry: 'Habit check-in'
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

/** The rows of the Needs attention sheet. Money and Gym each wrap them in their own sheet. */
export function ConflictEntries({ entries, onKeepMine, onUseSaved }: {
  entries: OutboxEntry[]
  onKeepMine: (entry: OutboxEntry) => void
  onUseSaved: (entry: OutboxEntry) => void
}): React.ReactElement {
  return <>
    {entries.length === 0 && <Text className="text-[16px] text-muted-foreground">Nothing needs attention.</Text>}
    {entries.map((entry) => <View key={entry.operationId} className="mb-4 rounded-2xl border border-surface-700 bg-surface-900 p-4">
      <Text className="text-[16px] font-semibold text-surface-100">{entry.lastError ?? 'This record changed on another device'}</Text>
      <Text className="mt-1 text-[14px] text-surface-400">{changeLabel(entry)}</Text>
      {entry.status === 'conflict'
        ? <View className="mt-4 flex-row gap-2">
          <Pressable accessibilityRole="button" onPress={() => onKeepMine(entry)} style={{ minHeight: TOUCH }} className="flex-1 items-center justify-center rounded-xl bg-primary px-3">
            <Text className="text-[16px] font-semibold text-primary-foreground">Keep mine</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} style={{ minHeight: TOUCH }} className="flex-1 items-center justify-center rounded-xl border border-surface-600 px-3">
            <Text className="text-[16px] font-semibold text-surface-200">Use saved version</Text>
          </Pressable>
        </View>
        : <Pressable accessibilityRole="button" onPress={() => onUseSaved(entry)} style={{ minHeight: TOUCH }} className="mt-4 items-center justify-center rounded-xl border border-surface-600 px-3">
          <Text className="text-[16px] font-semibold text-surface-200">Discard this change</Text>
        </Pressable>}
    </View>)}
  </>
}
