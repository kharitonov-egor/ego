import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { AccountRecord, CategoryRecord } from '@ego/api-contracts'
import type { TransactionKind } from '@ego/core'
import { clearFilters, toggleIn, type ActivityView } from '../../lib/activity-view'
import { MoneyIcon, Sheet } from './Common'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers'
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
    className={`min-h-12 flex-row items-center rounded-full border px-4 ${selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    {icon && <View className="mr-2 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#737373' }}>
      <MoneyIcon name={icon} size={13} />
    </View>}
    <Text className={`text-[15px] ${selected ? 'font-semibold text-primary-foreground' : 'text-surface-200'}`}>{label}</Text>
  </Pressable>
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-6">
    <Text className="mb-2.5 text-[15px] font-medium text-surface-200">{title}</Text>
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

    <View className="flex-row gap-3 pb-2">
      <Button variant="outline" size="lg" onPress={() => setDraft(clearFilters(draft))} className="flex-1"><UiText>Clear filters</UiText></Button>
      <Button size="lg" onPress={() => onApply(draft)} className="flex-1"><UiText>Show results</UiText></Button>
    </View>

  </Sheet>
}
