import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Pencil, ScanLine, Trash2 } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneyPurchase } from '@ego/core'
import PurchaseEditor, { draftForPurchase } from '../../components/money/PurchaseEditor'
import { ConfirmDialog, Empty, MoneyScreen, Sheet, money } from '../../components/money/Common'
import { formatIso } from '../../lib/dates'
import { useMoney } from '../../lib/money-context'

export default function Purchases(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const params = useLocalSearchParams<{ purchaseId?: string }>()
  const [selected, setSelected] = useState<MoneyPurchase | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!params.purchaseId || !state.snapshot) return
    const purchase = state.snapshot.purchases.find((item) => item.id === params.purchaseId)
    if (purchase) setSelected(purchase)
    router.setParams({ purchaseId: undefined })
  }, [params.purchaseId, router, state.snapshot])

  return <MoneyScreen>{(snapshot) => {
    const groups = new Map<string, MoneyPurchase[]>()
    snapshot.purchases.forEach((item) => groups.set(item.purchaseDate, [...(groups.get(item.purchaseDate) ?? []), item]))
    const current = selected ? snapshot.purchases.find((item) => item.id === selected.id) ?? null : null
    const remove = async (): Promise<void> => {
      if (!current) return
      if (await state.deletePurchase(current.id)) { setConfirmingDelete(false); setSelected(null) }
    }
    return <View className="flex-1"><ScrollView className="flex-1 px-5 pt-4">{snapshot.purchases.length === 0 ? <Empty title="No itemized purchases" detail="Analyze an itemized receipt to save its expense and item list." /> : <View className="gap-5">{Array.from(groups.entries()).map(([date, purchases]) => <View key={date}><Text className="mb-2 text-xs uppercase tracking-wider text-surface-500">{formatIso(date)}</Text><View className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/70">{purchases.map((purchase, index) => <Pressable key={purchase.id} onPress={() => setSelected(purchase)} className={`flex-row items-center px-4 py-3.5 ${index ? 'border-t border-surface-800' : ''}`}><View className="h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15"><ScanLine color="#60a5fa" size={18} /></View><View className="ml-3 flex-1"><Text className="text-sm text-surface-100">{purchase.merchant}</Text><Text className="mt-0.5 text-xs text-surface-500">{purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}</Text></View><Text className="text-sm text-rose-400">{money(purchase.totalCents)}</Text></Pressable>)}</View></View>)}</View>}<View className="h-24" /></ScrollView><Pressable disabled={state.readOnly} onPress={() => router.push('/transaction-image')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600"><ScanLine color="#fff" size={25} /></Pressable>
      <Sheet visible={Boolean(current)} title={editing ? 'Edit purchase' : current?.merchant ?? 'Purchase'} onClose={() => { setSelected(null); setEditing(false) }}>{current && (editing ? <PurchaseEditor snapshot={snapshot} purchase={current} draft={draftForPurchase(current)} busy={state.busy} onSave={async (input) => { if (await state.updatePurchase(current.id, input)) setEditing(false) }} /> : <View><View className="flex-row items-end justify-between"><View><Text className="text-xs text-surface-500">{formatIso(current.purchaseDate)}</Text><Text className="mt-1 text-2xl text-surface-100">{money(current.totalCents)}</Text></View><Text className="text-xs text-surface-500">{current.currency}</Text></View><View className="mt-5 overflow-hidden rounded-xl border border-surface-800">{current.items.map((item, index) => <View key={item.id} className={`flex-row items-center px-3 py-3 ${index ? 'border-t border-surface-800' : ''}`}><Text className="flex-1 text-sm text-surface-200">{item.name}</Text><Text className="text-sm text-surface-300">{money(item.lineTotalCents)}</Text></View>)}</View><View className="mt-5 gap-2 border-t border-surface-800 pt-4">{[['Subtotal', current.subtotalCents], ['Discount', -current.discountCents], ['Tax', current.taxCents], ['Fees', current.feesCents]].map(([label, value]) => <View key={label as string} className="flex-row justify-between"><Text className="text-xs text-surface-500">{label as string}</Text><Text className="text-xs text-surface-300">{money(value as number, true)}</Text></View>)}</View><View className="mt-6 flex-row gap-2"><Pressable disabled={state.readOnly} onPress={() => setEditing(true)} className="flex-1 flex-row items-center justify-center rounded-xl bg-accent-600 py-3"><Pencil color="#fff" size={15} /><Text className="ml-2 text-sm font-semibold text-white">Edit</Text></Pressable><Pressable disabled={state.readOnly} onPress={() => setConfirmingDelete(true)} className="rounded-xl border border-rose-500/30 px-4 py-3"><Trash2 color="#fb7185" size={16} /></Pressable></View></View>)}</Sheet>
      <ConfirmDialog visible={confirmingDelete} title="Delete purchase?" detail="This also deletes the linked expense and updates the account balance." confirmLabel="Delete" destructive busy={state.busy} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} />
    </View>
  }}</MoneyScreen>
}
