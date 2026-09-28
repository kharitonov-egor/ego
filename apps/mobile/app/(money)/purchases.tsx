import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, SectionList, View } from 'react-native'
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
import { useLedger } from '../../lib/ledger-context'
import { useMoney } from '../../lib/money-context'
import type { LocalFeedTransaction, LocalPurchaseHeader } from '../../lib/repositories/transactions'

const PAGE_SIZE = 50

interface PurchaseSection {
  date: string
  data: LocalPurchaseHeader[]
}

function Total({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }): React.ReactElement {
  return <View className="flex-row items-center justify-between py-1">
    <Text className={strong ? 'font-semibold' : 'text-[15px] text-muted-foreground'}>{label}</Text>
    <Text className={strong ? 'text-[17px] font-bold' : 'text-[15px] font-medium'} style={tabular}>{money(cents)}</Text>
  </View>
}

export default function Purchases(): React.ReactElement {
  const state = useMoney()
  const ledger = useLedger()
  const router = useRouter()
  const params = useLocalSearchParams<{ purchaseId?: string }>()
  const [headers, setHeaders] = useState<LocalPurchaseHeader[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [selected, setSelected] = useState<MoneyPurchase | null>(null)
  const [linked, setLinked] = useState<LocalFeedTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const loadingMore = useRef(false)

  const loadPage = useCallback(async (offset: number): Promise<void> => {
    if (loadingMore.current) return
    loadingMore.current = true
    if (offset === 0) setLoading(true)
    try {
      const page = await ledger.purchasePage(PAGE_SIZE, offset)
      setHeaders((current) => offset === 0 ? page.items : [...current, ...page.items])
      setNextOffset(page.nextOffset)
    } finally {
      loadingMore.current = false
      if (offset === 0) setLoading(false)
    }
  }, [ledger.purchasePage])

  useEffect(() => {
    void loadPage(0)
  }, [ledger.version, loadPage])

  useEffect(() => {
    if (!params.purchaseId) return
    void ledger.receipt(params.purchaseId).then(async (receipt) => {
      setSelected(receipt?.purchase ?? null)
      setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
    })
    router.setParams({ purchaseId: undefined })
  }, [ledger.receipt, params.purchaseId, router])

  useEffect(() => {
    if (!selected) return
    void ledger.receipt(selected.id).then(async (receipt) => {
      setSelected(receipt?.purchase ?? null)
      setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
    })
  // The selected receipt should refresh after a local write or pulled change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.version])

  const sections = useMemo(() => {
    const grouped: PurchaseSection[] = []
    for (const purchase of headers) {
      const last = grouped[grouped.length - 1]
      if (last?.date === purchase.purchaseDate) last.data.push(purchase)
      else grouped.push({ date: purchase.purchaseDate, data: [purchase] })
    }
    return grouped
  }, [headers])

  const open = async (id: string): Promise<void> => {
    const receipt = await ledger.receipt(id)
    setSelected(receipt?.purchase ?? null)
    setLinked(receipt ? await ledger.transaction(receipt.purchase.transactionId) : null)
  }

  return <MoneyScreen>{(snapshot) => {
    const current = selected
    const editorSnapshot = linked ? { ...snapshot, transactions: [linked] } : snapshot
    const close = (): void => { setSelected(null); setLinked(null); setEditing(false) }
    const remove = async (): Promise<void> => {
      if (!current) return
      if (await state.deletePurchase(current.id)) { setConfirmingDelete(false); setSelected(null) }
    }

    return <View className="flex-1">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        initialNumToRender={20}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (nextOffset !== null) void loadPage(nextOffset) }}
        ListEmptyComponent={loading
          ? <ActivityIndicator color="#fafafa" className="pt-8" />
          : <Empty title="No itemized purchases" detail="Send a receipt to the money agent to save its expense and item list." />}
        renderSectionHeader={({ section }) => <Text className="bg-background pb-2 pt-5 text-[14px] font-semibold text-muted-foreground">{formatIso(section.date)}</Text>}
        renderItem={({ item, index, section }) => <Card className={`overflow-hidden rounded-none ${index === 0 ? 'rounded-t-2xl' : ''} ${index === section.data.length - 1 ? 'rounded-b-2xl' : ''}`}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.merchant}, ${item.itemCount} items, ${money(item.totalCents)}`}
            onPress={() => void open(item.id)}
            className={`min-h-[72px] flex-row items-center px-4 py-3 active:bg-surface-900 ${index ? 'border-t border-surface-800' : ''}`}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-800"><Receipt color="#fafafa" size={19} /></View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} className="text-[17px] font-semibold">{item.merchant}</Text>
              <Text className="text-[14px] text-muted-foreground">{item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}</Text>
            </View>
            <Text className="text-[17px] font-semibold" style={{ ...tabular, color: color.expense }}>-{money(item.totalCents)}</Text>
          </Pressable>
        </Card>}
        ListFooterComponent={loadingMore.current && headers.length > 0 ? <ActivityIndicator color="#fafafa" className="py-5" /> : null}
      />

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
          ? <PurchaseEditor snapshot={editorSnapshot} purchase={current} draft={draftForPurchase(current)} busy={state.busy} onSave={async (input) => { if (await state.updatePurchase(current.id, input)) setEditing(false) }} />
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
