import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Pencil, Receipt, ScanLine, Trash2 } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneyPurchase } from '@ego/core'
import PurchaseEditor, { draftForPurchase } from '../../components/money/PurchaseEditor'
import { ConfirmDialog, Empty, MoneyScreen, Sheet, money } from '../../components/money/Common'
import { color, tabular } from '../../components/money/tokens'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Text } from '../../components/ui/text'
import { formatIso } from '../../lib/dates'
import { useMoney } from '../../lib/money-context'

function Total({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }): React.ReactElement {
  return <View className="flex-row items-center justify-between py-1">
    <Text className={strong ? 'font-semibold' : 'text-[15px] text-muted-foreground'}>{label}</Text>
    <Text className={strong ? 'text-[17px] font-bold' : 'text-[15px] font-medium'} style={tabular}>{money(cents)}</Text>
  </View>
}

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
    const close = (): void => { setSelected(null); setEditing(false) }
    const remove = async (): Promise<void> => {
      if (!current) return
      if (await state.deletePurchase(current.id)) { setConfirmingDelete(false); setSelected(null) }
    }

    return <View className="flex-1">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 20 }}>
        {snapshot.purchases.length === 0
          ? <Empty title="No itemized purchases" detail="Send a receipt to the money agent to save its expense and item list." />
          : Array.from(groups.entries()).map(([date, purchases]) => <View key={date}>
            <Text className="mb-2 text-[14px] font-semibold text-muted-foreground">{formatIso(date)}</Text>
            <Card className="overflow-hidden">{purchases.map((purchase, index) => <Pressable
              key={purchase.id}
              accessibilityRole="button"
              accessibilityLabel={`${purchase.merchant}, ${purchase.items.length} items, ${money(purchase.totalCents)}`}
              onPress={() => setSelected(purchase)}
              className={`min-h-[72px] flex-row items-center px-4 py-3 active:bg-surface-900 ${index ? 'border-t border-surface-800' : ''}`}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-800"><Receipt color="#fafafa" size={19} /></View>
              <View className="ml-3 flex-1">
                <Text numberOfLines={1} className="text-[17px] font-semibold">{purchase.merchant}</Text>
                <Text className="text-[14px] text-muted-foreground">{purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}</Text>
              </View>
              <Text className="text-[17px] font-semibold" style={{ ...tabular, color: color.expense }}>-{money(purchase.totalCents)}</Text>
            </Pressable>)}</Card>
          </View>)}
      </ScrollView>

      <Button
        size="lg"
        accessibilityLabel="Open the money agent"
        disabled={state.readOnly}
        onPress={() => router.push('/transaction-image')}
        className="absolute bottom-5 right-4"
      >
        <ScanLine color="#0a0a0a" size={20} />
        <Text>Scan receipt</Text>
      </Button>

      <Sheet visible={Boolean(current)} title={editing ? 'Edit purchase' : current?.merchant ?? 'Purchase'} onClose={close}>
        {current && (editing
          ? <PurchaseEditor snapshot={snapshot} purchase={current} draft={draftForPurchase(current)} busy={state.busy} onSave={async (input) => { if (await state.updatePurchase(current.id, input)) setEditing(false) }} />
          : <View>
            <Text className="text-[15px] text-muted-foreground">{formatIso(current.purchaseDate)} · {current.currency}</Text>
            <Text className="mt-1 text-[36px] font-bold tracking-tight">{money(current.totalCents)}</Text>

            <Card className="mt-4 overflow-hidden">{current.items.map((item, index) => <View key={item.id} className={`min-h-14 flex-row items-center px-4 py-3 ${index ? 'border-t border-surface-800' : ''}`}>
              <View className="flex-1 pr-3">
                <Text className="text-[16px]">{item.name}</Text>
                {item.quantity !== 1 && <Text className="text-[14px] text-muted-foreground">Quantity {item.quantity}</Text>}
              </View>
              <Text className="text-[16px] font-semibold" style={tabular}>{money(item.lineTotalCents)}</Text>
            </View>)}</Card>

            <View className="mt-4 px-1">
              <Total label="Subtotal" cents={current.subtotalCents} />
              {current.discountCents > 0 && <Total label="Discount" cents={-current.discountCents} />}
              <Total label="Tax" cents={current.taxCents} />
              {current.feesCents > 0 && <Total label="Fees and tip" cents={current.feesCents} />}
              <View className="mt-2 border-t border-surface-800 pt-2"><Total label="Total" cents={current.totalCents} strong /></View>
            </View>

            <View className="mt-5 flex-row gap-3">
              <Button size="lg" disabled={state.readOnly} onPress={() => setEditing(true)} className="flex-1">
                <Pencil color="#0a0a0a" size={18} />
                <Text>Edit</Text>
              </Button>
              <Button variant="outline" size="lg" accessibilityLabel="Delete purchase" disabled={state.readOnly} onPress={() => setConfirmingDelete(true)} className="border-destructive/40">
                <Trash2 color="#fb7185" size={18} />
                <Text className="text-destructive">Delete</Text>
              </Button>
            </View>
          </View>)}
      </Sheet>
      <ConfirmDialog visible={confirmingDelete} title="Delete purchase?" detail="This also deletes the linked expense and updates the account balance." confirmLabel="Delete" destructive busy={state.busy} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} />
    </View>
  }}</MoneyScreen>
}
