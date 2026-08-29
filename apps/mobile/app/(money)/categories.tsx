import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Archive, Plus, RotateCcw } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import type { CategoryInput, CategoryKind, MoneyCategory, PeriodPreset } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import {
  Chips, COLORS, ConfirmDialog, Empty, ICON_OPTIONS, Label, MoneyIcon, MoneyScreen, PeriodChips,
  PrimaryButton, Sheet, filteredTransactions, inputClass, money
} from '../../components/money/Common'

function CategoryForm({ category, onClose }: { category?: MoneyCategory; onClose: () => void }): React.ReactElement {
  const moneyState = useMoney()
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? 'Tag')
  const [color, setColor] = useState(category?.color ?? COLORS[3])
  const save = async (): Promise<void> => {
    const input: CategoryInput = { name: name.trim(), kind, icon, color }
    const saved = category ? await moneyState.updateCategory(category.id, input) : await moneyState.createCategory(input)
    if (saved) onClose()
  }
  return <View><Label text="Name"><TextInput autoFocus value={name} onChangeText={setName} placeholder="Food" placeholderTextColor="#707078" className={inputClass} /></Label><Label text="Type"><Chips values={['expense', 'income'] as const} value={kind} onChange={setKind} /></Label><Label text="Icon"><View className="flex-row flex-wrap gap-2">{ICON_OPTIONS.map((item) => <Pressable key={item} onPress={() => setIcon(item)} className={`rounded-xl border p-2.5 ${icon === item ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={item} color={icon === item ? '#91c4ff' : '#b5b5bc'} size={18} /></Pressable>)}</View></Label><Label text="Color"><View className="flex-row flex-wrap gap-3">{COLORS.map((item) => <Pressable key={item} onPress={() => setColor(item)} className={`h-8 w-8 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} />)}</View></Label><PrimaryButton label={category ? 'Save category' : 'Create category'} disabled={!name.trim() || moneyState.busy} onPress={() => void save()} /></View>
}

export default function Categories(): React.ReactElement {
  const state = useMoney()
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [editing, setEditing] = useState<MoneyCategory | 'new' | null>(null)
  const [archived, setArchived] = useState(false)
  const [confirming, setConfirming] = useState<MoneyCategory | null>(null)
  return <MoneyScreen>{(snapshot) => {
    const transactions = filteredTransactions(snapshot, period)
    const totals = new Map<string, number>()
    transactions.filter((item) => item.kind === 'expense' && item.categoryId).forEach((item) => totals.set(item.categoryId!, (totals.get(item.categoryId!) ?? 0) + item.amountCents))
    const categories = snapshot.categories.filter((item) => Boolean(item.archivedAt) === archived)
    const expenses = categories.filter((item) => item.kind === 'expense').sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
    const income = categories.filter((item) => item.kind === 'income')
    const total = transactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
    let offset = 0
    const circumference = 2 * Math.PI * 55
    const segments = expenses.filter((item) => (totals.get(item.id) ?? 0) > 0).map((item) => {
      const length = total ? (totals.get(item.id) ?? 0) / total * 100 : 0
      const segmentLength = length / 100 * circumference
      const segment = <Circle key={item.id} cx="70" cy="70" r="55" fill="none" stroke={item.color} strokeWidth="18" strokeDasharray={`${segmentLength} ${circumference - segmentLength}`} strokeDashoffset={-offset / 100 * circumference} strokeLinecap="butt" />
      offset += length
      return segment
    })
    const archive = (category: MoneyCategory): void => setConfirming(category)
    const confirmArchive = async (): Promise<void> => {
      if (!confirming) return
      const saved = await state.archiveCategory(confirming.id, !confirming.archivedAt)
      if (saved) setConfirming(null)
    }
    const row = (category: MoneyCategory): React.ReactElement => {
      const amount = totals.get(category.id) ?? 0
      return <Pressable accessibilityRole="button" key={category.id} onPress={() => setEditing(category)} className="min-h-[96px] flex-row items-center rounded-2xl border border-surface-800 bg-surface-900/70 p-4"><View className="h-[52px] w-[52px] items-center justify-center rounded-full" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={22} /></View><View className="ml-3 flex-1"><Text className="text-xl font-semibold text-surface-100">{category.name}</Text><Text className="mt-1 text-base text-surface-400">{category.kind === 'expense' ? `${money(amount)} · ${total ? Math.round(amount / total * 100) : 0}%` : 'Income'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={category.archivedAt ? `Restore ${category.name}` : `Archive ${category.name}`} onPress={() => archive(category)} hitSlop={8}>{category.archivedAt ? <RotateCcw color="#b5b5bc" size={21} /> : <Archive color="#b5b5bc" size={21} />}</Pressable></Pressable>
    }
    return <View className="flex-1"><PeriodChips value={period} onChange={setPeriod} /><ScrollView className="flex-1 px-5">{categories.length === 0 ? <Empty title={archived ? 'No archived categories' : 'Create your first category'} detail="Add an expense or income category before recording a transaction." /> : <><View className="items-center rounded-3xl border border-surface-800 bg-surface-900/60 py-5"><View className="h-40 w-40 items-center justify-center"><Svg width={140} height={140} viewBox="0 0 140 140"><Circle cx="70" cy="70" r="55" fill="none" stroke="#2a2a2f" strokeWidth="18" />{segments}</Svg><View className="absolute items-center"><Text className="text-[17px] font-semibold text-surface-300">Expenses</Text><Text className="mt-1 text-4xl font-bold text-rose-400" style={{ fontVariant: ['tabular-nums'] }}>{money(total)}</Text></View></View></View><View className="mt-4 flex-row justify-end"><Pressable onPress={() => setArchived(!archived)} className="rounded-full border border-surface-700 bg-surface-900 px-4 py-3"><Text className="text-[17px] font-semibold text-surface-200">{archived ? 'Show active' : 'Show archived'}</Text></Pressable></View><Text className="mb-2 mt-4 text-xl font-bold text-surface-100">Expenses</Text><View className="gap-2">{expenses.map(row)}</View>{income.length > 0 && <><Text className="mb-2 mt-5 text-xl font-bold text-surface-100">Income</Text><View className="gap-2">{income.map(row)}</View></>}<View className="h-24" /></>}</ScrollView>{!editing && !confirming && <Pressable accessibilityRole="button" accessibilityLabel="Add category" disabled={state.readOnly} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600"><Plus color="#fff" size={29} /></Pressable>}<Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New category' : 'Edit category'} onClose={() => setEditing(null)}>{editing && <CategoryForm key={editing === 'new' ? 'new' : editing.id} category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet><ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore category?' : 'Archive category?'} detail="Past transactions will keep this category." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={state.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} /></View>
  }}</MoneyScreen>
}
