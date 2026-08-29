import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Plus } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import type { CategoryInput, CategoryKind, MoneyCategory } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import {
  Chips, COLORS, ConfirmDialog, ICON_OPTIONS, Label, MoneyIcon, MoneyScreen, PeriodChips,
  PrimaryButton, Sheet, filteredTransactions, inputClass, money
} from '../../components/money/Common'
import { usePeriod } from '../../lib/period-context'

function CategoryForm({ category, defaultKind, onClose }: {
  category?: MoneyCategory
  defaultKind: CategoryKind
  onClose: () => void
}): React.ReactElement {
  const moneyState = useMoney()
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? defaultKind)
  const [icon, setIcon] = useState(category?.icon ?? 'Tag')
  const [color, setColor] = useState(category?.color ?? COLORS[kind === 'income' ? 1 : 3])
  const save = async (): Promise<void> => {
    const input: CategoryInput = { name: name.trim(), kind, icon, color }
    const saved = category ? await moneyState.updateCategory(category.id, input) : await moneyState.createCategory(input)
    if (saved) onClose()
  }
  return <View>
    <Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Food" placeholderTextColor="#707078" className={inputClass} /></Label>
    <Label text="Type"><Chips values={['expense', 'income'] as const} value={kind} onChange={setKind} /></Label>
    <Label text="Icon"><View className="flex-row flex-wrap gap-2">{ICON_OPTIONS.map((item) => <Pressable key={item} onPress={() => setIcon(item)} className={`rounded-lg border p-2 ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#91c4ff' : '#b5b5bc'} size={15} /></Pressable>)}</View></Label>
    <Label text="Color"><View className="flex-row flex-wrap gap-2">{COLORS.map((item) => <Pressable accessibilityLabel={`Use color ${item}`} key={item} onPress={() => setColor(item)} className={`h-7 w-7 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label>
    <PrimaryButton label={category ? 'Save category' : 'Create category'} disabled={!name.trim() || moneyState.busy} onPress={() => void save()} />
  </View>
}

function alpha(color: string, opacity: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${opacity}` : color
}

function CategoryNode({ category, amount, total, onEdit, onArchive }: {
  category: MoneyCategory
  amount: number
  total: number
  onEdit: () => void
  onArchive: () => void
}): React.ReactElement {
  const percent = total > 0 ? Math.round(amount / total * 100) : 0
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${category.name}, ${money(amount)}, ${percent} percent`}
    accessibilityHint={category.archivedAt ? 'Tap to edit. Hold to restore.' : 'Tap to edit. Hold to archive.'}
    onPress={onEdit}
    onLongPress={onArchive}
    delayLongPress={450}
    className="h-[104px] w-1/4 items-center px-0.5 pt-1.5"
  >
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.78} className="h-7 text-center text-[11px] font-semibold leading-[14px] text-surface-300">{category.name}</Text>
    <View className="h-10 w-10 items-center justify-center rounded-full border" style={{ backgroundColor: alpha(category.color, '24'), borderColor: alpha(category.color, '80') }}><MoneyIcon name={category.icon} color={category.color} size={17} /></View>
    <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1.5 text-center text-[10px] font-bold" style={{ color: amount > 0 ? category.color : '#707078', fontVariant: ['tabular-nums'] }}>{money(amount)} · {percent}%</Text>
  </Pressable>
}

function CategoryRow({ categories, totals, total, onEdit, onArchive }: {
  categories: MoneyCategory[]
  totals: Map<string, number>
  total: number
  onEdit: (category: MoneyCategory) => void
  onArchive: (category: MoneyCategory) => void
}): React.ReactElement {
  return <View className="flex-row">{categories.map((category) => <CategoryNode key={category.id} category={category} amount={totals.get(category.id) ?? 0} total={total} onEdit={() => onEdit(category)} onArchive={() => onArchive(category)} />)}{Array.from({ length: Math.max(0, 4 - categories.length) }, (_, index) => <View key={`empty-${index}`} className="w-1/4" />)}</View>
}

function CategoryDonut({ mode, categories, totals, total, oppositeTotal, onToggle }: {
  mode: CategoryKind
  categories: MoneyCategory[]
  totals: Map<string, number>
  total: number
  oppositeTotal: number
  onToggle: () => void
}): React.ReactElement {
  const radius = 68
  const circumference = 2 * Math.PI * radius
  const active = categories.filter((category) => (totals.get(category.id) ?? 0) > 0)
  const gap = active.length > 1 ? 4 : 0
  let offset = 0
  const segments = active.map((category) => {
    const length = total > 0 ? (totals.get(category.id) ?? 0) / total * circumference : 0
    const visible = Math.max(0, length - gap)
    const segment = <Circle
      key={category.id}
      cx="86"
      cy="86"
      r={radius}
      fill="none"
      stroke={category.color}
      strokeWidth="11"
      strokeDasharray={`${visible} ${circumference - visible}`}
      strokeDashoffset={-offset}
      strokeLinecap="round"
      rotation="-90"
      origin="86, 86"
    />
    offset += length
    return segment
  })
  const income = mode === 'income'
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Showing ${mode}. Tap to show ${income ? 'expenses' : 'income'}.`}
    onPress={onToggle}
    className="h-[172px] w-[172px] items-center justify-center rounded-full"
  >
    <Svg width={172} height={172} viewBox="0 0 172 172" className="absolute"><Circle cx="86" cy="86" r={radius} fill="none" stroke="#34343a" strokeWidth="11" />{segments}</Svg>
    <Text className="text-[12px] font-semibold capitalize text-surface-300">{mode}</Text>
    <Text className={`mt-0.5 text-[20px] font-bold ${income ? 'text-emerald-400' : 'text-rose-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(total)}</Text>
    <Text className="mt-1 text-[10px] text-surface-500">{income ? 'Expenses' : 'Income'} {money(oppositeTotal)}</Text>
  </Pressable>
}

export default function Categories(): React.ReactElement {
  const state = useMoney()
  const { range } = usePeriod()
  const [mode, setMode] = useState<CategoryKind>('expense')
  const [editing, setEditing] = useState<MoneyCategory | 'new' | null>(null)
  const [archived, setArchived] = useState(false)
  const [confirming, setConfirming] = useState<MoneyCategory | null>(null)
  return <MoneyScreen>{(snapshot) => {
    const transactions = filteredTransactions(snapshot, range)
    const totals = new Map<string, number>()
    transactions.filter((item) => item.kind !== 'transfer' && item.categoryId).forEach((item) => totals.set(item.categoryId!, (totals.get(item.categoryId!) ?? 0) + item.amountCents))
    const totalFor = (kind: CategoryKind): number => transactions.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amountCents, 0)
    const total = totalFor(mode)
    const oppositeTotal = totalFor(mode === 'expense' ? 'income' : 'expense')
    const categories = snapshot.categories.filter((item) => item.kind === mode && Boolean(item.archivedAt) === archived)
    const top = categories.slice(0, 4)
    const sides = categories.slice(4, 8)
    const rest = categories.slice(8)
    const archive = (category: MoneyCategory): void => setConfirming(category)
    const confirmArchive = async (): Promise<void> => {
      if (!confirming) return
      const saved = await state.archiveCategory(confirming.id, !confirming.archivedAt)
      if (saved) setConfirming(null)
    }
    const restRows = Array.from({ length: Math.ceil(rest.length / 4) }, (_, index) => rest.slice(index * 4, index * 4 + 4))
    return <View className="flex-1">
      <PeriodChips />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 72 }}>
        <View className="flex-row items-center justify-between px-3 pb-1.5"><View><Text className={`text-[13px] font-bold ${mode === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>{mode === 'expense' ? 'Expense categories' : 'Income categories'}</Text><Text className="mt-0.5 text-[10px] text-surface-500">Tap to edit · Hold to {archived ? 'restore' : 'archive'}</Text></View><Pressable onPress={() => setArchived((value) => !value)} className="rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5"><Text className="text-[11px] font-semibold text-surface-300">{archived ? 'Show active' : 'Archived'}</Text></Pressable></View>
        <CategoryRow categories={top} totals={totals} total={total} onEdit={setEditing} onArchive={archive} />
        <View className="relative h-[264px]">
          {sides[0] && <View pointerEvents="box-none" className="absolute left-0 top-2 z-10 w-full"><CategoryNode category={sides[0]} amount={totals.get(sides[0].id) ?? 0} total={total} onEdit={() => setEditing(sides[0])} onArchive={() => archive(sides[0])} /></View>}
          {sides[1] && <View pointerEvents="box-none" className="absolute right-0 top-2 z-10 w-full items-end"><CategoryNode category={sides[1]} amount={totals.get(sides[1].id) ?? 0} total={total} onEdit={() => setEditing(sides[1])} onArchive={() => archive(sides[1])} /></View>}
          {sides[2] && <View pointerEvents="box-none" className="absolute bottom-0 left-0 z-10 w-full"><CategoryNode category={sides[2]} amount={totals.get(sides[2].id) ?? 0} total={total} onEdit={() => setEditing(sides[2])} onArchive={() => archive(sides[2])} /></View>}
          {sides[3] && <View pointerEvents="box-none" className="absolute bottom-0 right-0 z-10 w-full items-end"><CategoryNode category={sides[3]} amount={totals.get(sides[3].id) ?? 0} total={total} onEdit={() => setEditing(sides[3])} onArchive={() => archive(sides[3])} /></View>}
          <View className="absolute left-0 right-0 top-[44px] items-center"><CategoryDonut mode={mode} categories={categories} totals={totals} total={total} oppositeTotal={oppositeTotal} onToggle={() => { setMode((value) => value === 'expense' ? 'income' : 'expense'); setArchived(false) }} /></View>
        </View>
        {restRows.map((row, index) => <CategoryRow key={index} categories={row} totals={totals} total={total} onEdit={setEditing} onArchive={archive} />)}
        {categories.length === 0 && <Text className="px-8 pb-6 text-center text-[12px] leading-5 text-surface-400">No {archived ? 'archived' : 'active'} {mode} categories. Tap + to create one.</Text>}
      </ScrollView>
      {!editing && !confirming && <Pressable accessibilityRole="button" accessibilityLabel="Add category" disabled={state.readOnly} onPress={() => setEditing('new')} className="absolute bottom-4 right-3 h-11 w-11 items-center justify-center rounded-xl bg-accent-600"><Plus color="#fff" size={21} /></Pressable>}
      <Sheet visible={Boolean(editing)} title={editing === 'new' ? `New ${mode} category` : 'Edit category'} onClose={() => setEditing(null)}>{editing && <CategoryForm key={editing === 'new' ? `new-${mode}` : editing.id} category={editing === 'new' ? undefined : editing} defaultKind={mode} onClose={() => setEditing(null)} />}</Sheet>
      <ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore category?' : 'Archive category?'} detail="Past transactions will keep this category." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={state.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} />
    </View>
  }}</MoneyScreen>
}
