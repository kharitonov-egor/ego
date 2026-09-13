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
import { useRouter } from 'expo-router'
import { tabular } from '../../components/money/tokens'

function CategoryForm({ category, defaultKind, onClose, onArchive }: {
  category?: MoneyCategory
  defaultKind: CategoryKind
  onClose: () => void
  onArchive: (category: MoneyCategory) => void
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
    <Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Food" placeholderTextColor="#909099" className={inputClass} /></Label>
    <Label text="Type"><Chips values={['expense', 'income'] as const} value={kind} onChange={setKind} /></Label>
    <Label text="Icon"><View className="flex-row flex-wrap gap-2">{ICON_OPTIONS.map((item) => <Pressable accessibilityRole="button" accessibilityLabel={`Use ${item} icon`} accessibilityState={{ selected: icon === item }} key={item} onPress={() => setIcon(item)} className={`h-11 w-11 items-center justify-center rounded-lg border ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#91c4ff' : '#b5b5bc'} size={17} /></Pressable>)}</View></Label>
    <Label text="Color"><View className="flex-row flex-wrap gap-2">{COLORS.map((item) => <Pressable accessibilityRole="button" accessibilityLabel={`Use color ${item}`} accessibilityState={{ selected: color === item }} key={item} onPress={() => setColor(item)} className={`h-11 w-11 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label>
    <PrimaryButton label={category ? 'Save category' : 'Create category'} disabled={!name.trim() || moneyState.busy} onPress={() => void save()} />
    {category && <Pressable
      accessibilityRole="button"
      onPress={() => onArchive(category)}
      style={{ minHeight: 48 }}
      className="mt-3 items-center justify-center rounded-xl border border-surface-600"
    ><Text className="text-[16px] font-semibold text-surface-200">{category.archivedAt ? 'Restore category' : 'Archive category'}</Text></Pressable>}
  </View>
}

function alpha(color: string, opacity: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${opacity}` : color
}

function CategoryNode({ category, amount, total, onOpen, onEdit }: {
  category: MoneyCategory
  amount: number
  total: number
  onOpen: () => void
  onEdit: () => void
}): React.ReactElement {
  const percent = total > 0 ? Math.round(amount / total * 100) : 0
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${category.name}, ${money(amount)}, ${percent} percent`}
    accessibilityHint="Tap to see its transactions. Hold to edit."
    onPress={onOpen}
    onLongPress={onEdit}
    delayLongPress={450}
    className="h-[126px] w-1/4 items-center px-1 pt-1.5"
  >
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.86} className="h-10 text-center text-[14px] font-semibold leading-[18px] text-surface-300">{category.name}</Text>
    <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: amount > 0 ? category.color : alpha(category.color, '33') }}>
      <MoneyIcon name={category.icon} color={amount > 0 ? '#ffffff' : category.color} size={19} />
    </View>
    <Text numberOfLines={1} adjustsFontSizeToFit className="mt-2 text-center text-[14px] font-bold text-surface-100" style={tabular}>{money(amount)}</Text>
    <Text numberOfLines={1} className="text-center text-[14px] text-surface-500" style={tabular}>{percent}%</Text>
  </Pressable>
}

function CategoryRow({ categories, totals, total, onOpen, onEdit }: {
  categories: MoneyCategory[]
  totals: Map<string, number>
  total: number
  onOpen: (category: MoneyCategory) => void
  onEdit: (category: MoneyCategory) => void
}): React.ReactElement {
  return <View className="flex-row">{categories.map((category) => <CategoryNode key={category.id} category={category} amount={totals.get(category.id) ?? 0} total={total} onOpen={() => onOpen(category)} onEdit={() => onEdit(category)} />)}{Array.from({ length: Math.max(0, 4 - categories.length) }, (_, index) => <View key={`empty-${index}`} className="w-1/4" />)}</View>
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
    <Text className="text-[14px] font-semibold capitalize text-surface-300">{mode}</Text>
    <Text className={`mt-0.5 text-[24px] font-bold ${income ? 'text-positive' : 'text-surface-50'}`} style={tabular}>{money(total)}</Text>
    <Text className="mt-1 text-[14px] text-surface-400">{income ? 'Expenses' : 'Income'} {money(oppositeTotal)}</Text>
  </Pressable>
}

export default function Categories(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
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
    const openCategory = (category: MoneyCategory): void =>
      router.push({ pathname: '/(money)/transactions', params: { categoryId: category.id } })
    const confirmArchive = async (): Promise<void> => {
      if (!confirming) return
      const saved = await state.archiveCategory(confirming.id, !confirming.archivedAt)
      if (saved) setConfirming(null)
    }
    const restRows = Array.from({ length: Math.ceil(rest.length / 4) }, (_, index) => rest.slice(index * 4, index * 4 + 4))
    return <View className="flex-1">
      <PeriodChips />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 72 }}>
        <View className="flex-row items-center justify-between px-4 pb-2 pt-1"><View><Text className={`text-[20px] font-semibold ${mode === 'expense' ? 'text-surface-100' : 'text-positive'}`}>{mode === 'expense' ? 'Expense categories' : 'Income categories'}</Text><Text className="mt-0.5 text-[14px] text-surface-400">Tap for transactions · Hold to edit</Text></View><Pressable onPress={() => setArchived((value) => !value)} style={{ minHeight: 44 }} className="justify-center rounded-full border border-surface-700 bg-surface-900 px-4"><Text className="text-[14px] font-semibold text-surface-300">{archived ? 'Show active' : 'Archived'}</Text></Pressable></View>
        <CategoryRow categories={top} totals={totals} total={total} onOpen={openCategory} onEdit={setEditing} />
        <View className="relative h-[264px]">
          {sides[0] && <View pointerEvents="box-none" className="absolute left-0 top-2 z-10 w-full"><CategoryNode category={sides[0]} amount={totals.get(sides[0].id) ?? 0} total={total} onOpen={() => openCategory(sides[0])} onEdit={() => setEditing(sides[0])} /></View>}
          {sides[1] && <View pointerEvents="box-none" className="absolute right-0 top-2 z-10 w-full items-end"><CategoryNode category={sides[1]} amount={totals.get(sides[1].id) ?? 0} total={total} onOpen={() => openCategory(sides[1])} onEdit={() => setEditing(sides[1])} /></View>}
          {sides[2] && <View pointerEvents="box-none" className="absolute bottom-0 left-0 z-10 w-full"><CategoryNode category={sides[2]} amount={totals.get(sides[2].id) ?? 0} total={total} onOpen={() => openCategory(sides[2])} onEdit={() => setEditing(sides[2])} /></View>}
          {sides[3] && <View pointerEvents="box-none" className="absolute bottom-0 right-0 z-10 w-full items-end"><CategoryNode category={sides[3]} amount={totals.get(sides[3].id) ?? 0} total={total} onOpen={() => openCategory(sides[3])} onEdit={() => setEditing(sides[3])} /></View>}
          <View className="absolute left-0 right-0 top-[44px] items-center"><CategoryDonut mode={mode} categories={categories} totals={totals} total={total} oppositeTotal={oppositeTotal} onToggle={() => { setMode((value) => value === 'expense' ? 'income' : 'expense'); setArchived(false) }} /></View>
        </View>
        {restRows.map((row, index) => <CategoryRow key={index} categories={row} totals={totals} total={total} onOpen={openCategory} onEdit={setEditing} />)}
        {categories.length === 0 && <Text className="px-8 pb-6 text-center text-[14px] leading-5 text-surface-400">No {archived ? 'archived' : 'active'} {mode} categories. Tap + to create one.</Text>}
      </ScrollView>
      {!editing && !confirming && <Pressable accessibilityRole="button" accessibilityLabel="Add category" disabled={state.readOnly} onPress={() => setEditing('new')} style={{ minHeight: 48 }} className="absolute bottom-5 right-4 flex-row items-center rounded-2xl bg-accent-600 px-5"><Plus color="#fff" size={19} /><Text className="ml-1.5 text-[16px] font-semibold text-white">Category</Text></Pressable>}
      <Sheet visible={Boolean(editing)} title={editing === 'new' ? `New ${mode} category` : 'Edit category'} onClose={() => setEditing(null)}>{editing && <CategoryForm key={editing === 'new' ? `new-${mode}` : editing.id} category={editing === 'new' ? undefined : editing} defaultKind={mode} onClose={() => setEditing(null)} onArchive={(category) => { setEditing(null); archive(category) }} />}</Sheet>
      <ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore category?' : 'Archive category?'} detail="Past transactions will keep this category." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={state.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} />
    </View>
  }}</MoneyScreen>
}
