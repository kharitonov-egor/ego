import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { AccountRecord, CategoryRecord } from '@ego/api-contracts'
import type { PeriodPreset, TransactionKind } from '@ego/core'
import { clearFilters, toggleIn, type ActivityView } from '../../lib/activity-view'
import { PERIOD_PRESETS, periodLabel } from '../../lib/period-context'
import { MoneyIcon, Sheet } from './Common'
import { CustomPeriodSheet } from './PeriodSheet'

const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers'
}

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Today', week: 'This week', month: 'This month', year: 'This year',
  all: 'All time', custom: 'Custom'
}

function Choice({ label, selected, onPress, icon, color }: {
  label: string
  selected: boolean
  onPress: () => void
  icon?: string
  color?: string
}): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected }}
    accessibilityLabel={label}
    onPress={onPress}
    className={`min-h-11 flex-row items-center rounded-full border px-3 py-2 ${selected ? 'border-accent-500/50 bg-accent-500/20' : 'border-surface-700 bg-surface-900'}`}
  >
    {icon && <View className="mr-1.5 h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#707078' }}>
      <MoneyIcon name={icon} size={11} />
    </View>}
    <Text className={`text-[14px] ${selected ? 'font-semibold text-accent-400' : 'text-surface-300'}`}>{label}</Text>
  </Pressable>
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-5">
    <Text className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-surface-400">{title}</Text>
    <View className="flex-row flex-wrap gap-2">{children}</View>
  </View>
}

export default function FilterSheet({ visible, view, accounts, categories, onApply, onClose }: {
  visible: boolean
  view: ActivityView
  accounts: AccountRecord[]
  categories: CategoryRecord[]
  onApply: (next: ActivityView) => void
  onClose: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<ActivityView>(view)
  const [picking, setPicking] = useState(false)

  React.useEffect(() => {
    if (visible) setDraft(view)
  }, [view, visible])

  const usable = (record: { archivedAt: string | null; id: string }, chosen: string[]): boolean =>
    !record.archivedAt || chosen.includes(record.id)

  return <Sheet visible={visible} title="Filters" onClose={onClose}>
    <Group title="Type">
      {(Object.keys(KIND_LABELS) as TransactionKind[]).map((kind) => <Choice
        key={kind}
        label={KIND_LABELS[kind]}
        selected={draft.kinds.includes(kind)}
        onPress={() => setDraft({ ...draft, kinds: toggleIn(draft.kinds, kind) })}
      />)}
    </Group>

    <Group title="Period">
      {PERIOD_PRESETS.map((preset) => <Choice
        key={preset}
        label={preset === 'custom' && draft.period === 'custom' && (draft.custom.from || draft.custom.to)
          ? periodLabel('custom', draft.custom)
          : PERIOD_LABELS[preset]}
        selected={draft.period === preset}
        onPress={() => preset === 'custom' ? setPicking(true) : setDraft({ ...draft, period: preset })}
      />)}
    </Group>

    <Group title="Account">
      {accounts.filter((account) => usable(account, draft.accountIds)).map((account) => <Choice
        key={account.id}
        label={account.name}
        icon={account.icon}
        color={account.color}
        selected={draft.accountIds.includes(account.id)}
        onPress={() => setDraft({ ...draft, accountIds: toggleIn(draft.accountIds, account.id) })}
      />)}
    </Group>

    <Group title="Category">
      {categories.filter((category) => usable(category, draft.categoryIds)).map((category) => <Choice
        key={category.id}
        label={category.name}
        icon={category.icon}
        color={category.color}
        selected={draft.categoryIds.includes(category.id)}
        onPress={() => setDraft({ ...draft, categoryIds: toggleIn(draft.categoryIds, category.id) })}
      />)}
    </Group>

    <View className="flex-row gap-2">
      <Pressable
        accessibilityRole="button"
        onPress={() => setDraft(clearFilters(draft))}
        className="min-h-11 flex-1 items-center justify-center rounded-lg border border-surface-600"
      ><Text className="text-[16px] font-semibold text-surface-200">Clear filters</Text></Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onApply(draft)}
        className="min-h-11 flex-1 items-center justify-center rounded-lg bg-accent-600"
      ><Text className="text-[16px] font-semibold text-white">Show results</Text></Pressable>
    </View>

    <CustomPeriodSheet
      visible={picking}
      value={draft.custom}
      onClose={() => setPicking(false)}
      onApply={(range) => {
        setDraft({ ...draft, period: 'custom', custom: range })
        setPicking(false)
      }}
    />
  </Sheet>
}
