import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { ChevronRight, Pencil, Receipt, Trash2 } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot } from '@ego/core'
import { useLedger } from '../../lib/ledger-context'
import type { LocalFeedTransaction } from '../../lib/repositories/transactions'
import { ConfirmDialog, MoneyIcon, money } from '../../components/money/Common'
import { TOUCH, amountColor, amountSign } from '../../components/money/tokens'
import TransactionEntry from '../../components/money/TransactionEntry'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Text as UiText } from '../../components/ui/text'
import { noteTitle, transactionTitle } from '../../lib/transaction-title'
import { useBlurText } from '../../lib/blur'

function Row({ label, value, first = false, amount = false }: { label: string; value: string; first?: boolean; amount?: boolean }): React.ReactElement {
  const blur = useBlurText()
  return <View style={{ minHeight: TOUCH + 8 }} className={`flex-row items-center justify-between px-5 py-3.5 ${first ? '' : 'border-t border-surface-800'}`}>
    <Text className="text-[15px] text-surface-400">{label}</Text>
    <Text className="ml-4 flex-1 text-right text-[17px] leading-6 text-foreground" style={amount ? blur() : undefined}>{value}</Text>
  </View>
}

export default function TransactionDetail(): React.ReactElement {
  const ledger = useLedger()
  const blur = useBlurText()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()
  const [transaction, setTransaction] = useState<LocalFeedTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null)

  const { transaction: findTransaction, receipt: findReceipt, version } = ledger
  const load = useCallback(async (): Promise<void> => {
    if (!params.id) {
      setLoading(false)
      return
    }
    try {
      const found = await findTransaction(params.id)
      setTransaction(found)
      if (found?.purchaseId) {
        const receipt = await findReceipt(found.purchaseId)
        setReceiptTotal(receipt?.purchase.totalCents ?? null)
      }
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, version, findTransaction, findReceipt])

  useEffect(() => {
    void load()
  }, [load])

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(money)/transactions')
  }

  if (loading) {
    return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#fafafa" /></View>
  }

  if (!transaction) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[18px] font-semibold text-surface-100">This transaction is gone</Text>
      <Text className="mt-2 text-center text-[16px] leading-5 text-surface-400">It was deleted here or on another device.</Text>
      <Pressable accessibilityRole="button" onPress={back} style={{ minHeight: TOUCH }} className="mt-5 justify-center rounded-xl bg-primary px-5">
        <Text className="text-[16px] font-semibold text-primary-foreground">Back to Activity</Text>
      </Pressable>
    </View>
  }

  const sign = amountSign(transaction.kind)
  const heading = transactionTitle(transaction)
  const moreNotes = transaction.notes.trim().length > 0 && transaction.notes.trim() !== noteTitle(transaction.notes)
  const editorSnapshot: MoneySnapshot = {
    accounts: (ledger.reference?.accounts ?? []).map((account) => ({
      ...account,
      balanceCents: ledger.balances.find((balance) => balance.accountId === account.id)?.balanceCents
        ?? account.openingBalanceCents
    })),
    categories: ledger.reference?.categories ?? [],
    transactions: [transaction],
    purchases: [],
    budgets: [],
    syncedAt: new Date().toISOString()
  }

  return <View className="flex-1 bg-surface-950">
    <ScrollView className="flex-1 px-4 pt-4">
      <Card className="items-center px-5 py-7">
        <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: transaction.categoryColor ?? '#737373' }}>
          <MoneyIcon name={transaction.categoryIcon ?? (transaction.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={28} />
        </View>
        <Text className="mt-4 text-center text-[22px] font-bold text-foreground">{heading}</Text>
        <Text
          accessibilityLabel={`${transaction.kind} of ${money(transaction.amountCents)}`}
          className="mt-1 text-[40px] font-bold tracking-tight"
          style={[{ color: amountColor(transaction.kind) }, blur(amountColor(transaction.kind), 12)]}
        >{sign}{money(transaction.amountCents)}</Text>
        {transaction.pending !== 'none' && <Text className={`mt-1.5 text-[14px] ${transaction.pending === 'pending' ? 'text-surface-400' : 'text-amber-300'}`}>
          {transaction.pending === 'pending' ? 'Pending. Waiting for the server.' : 'Needs attention. Review it in Activity.'}
        </Text>}
      </Card>

      <Card className="mt-3 overflow-hidden">
        <Row first label="Date" value={new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
        <Row label={transaction.kind === 'transfer' ? 'From' : 'Account'} value={transaction.accountName} />
        {transaction.kind === 'transfer'
          ? <Row label="To" value={transaction.destinationAccountName ?? 'Archived account'} />
          : <Row label="Category" value={transaction.categoryName ?? 'Archived category'} />}
        {moreNotes && <Row label="Note" value={transaction.notes.trim()} />}
      </Card>

      {transaction.purchaseId && <Card className="mt-3 overflow-hidden">
        <View className="flex-row items-center px-5 pb-2 pt-4">
          <Receipt color="#fafafa" size={17} />
          <Text className="ml-2 text-[17px] font-semibold text-foreground">Receipt</Text>
        </View>
        <Row label="Merchant" value={transaction.merchant ?? heading} />
        <Row label="Receipt total" value={money(receiptTotal ?? transaction.amountCents)} amount />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/(money)/purchases', params: { purchaseId: transaction.purchaseId ?? '' } })}
          style={{ minHeight: TOUCH + 8 }}
          className="flex-row items-center justify-between border-t border-surface-800 px-5 active:bg-surface-900"
        >
          <Text className="text-[17px] font-semibold text-foreground">View items</Text>
          <ChevronRight color="#a3a3a3" size={20} />
        </Pressable>
      </Card>}

      <View className="mt-5 flex-row gap-3">
        <Button size="lg" onPress={() => setEditing(true)} className="flex-1">
          <Pencil color="#0a0a0a" size={18} />
          <UiText>Edit</UiText>
        </Button>
        <Button size="lg" variant="outline" onPress={() => setConfirming(true)} className="flex-1 border-destructive/40">
          <Trash2 color="#fb7185" size={18} />
          <UiText className="text-destructive">Delete</UiText>
        </Button>
      </View>
      <View className="h-10" />
    </ScrollView>

    {editing && <TransactionEntry
      snapshot={editorSnapshot}
      transaction={transaction}
      onDelete={async () => {
        const removed = await ledger.removeTransaction(transaction)
        if (removed) back()
        return removed
      }}
      onClose={() => setEditing(false)}
    />}

    <ConfirmDialog
      visible={confirming}
      title="Delete this transaction?"
      detail="Account balances update immediately. The deletion syncs when the server is reachable."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void (async () => {
        const removed = await ledger.removeTransaction(transaction)
        setConfirming(false)
        if (removed) back()
      })()}
    />
  </View>
}
