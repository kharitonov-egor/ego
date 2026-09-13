import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { ArrowRight, Pencil, Receipt, Trash2 } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot } from '@ego/core'
import { useLedger } from '../../lib/ledger-context'
import type { LocalFeedTransaction } from '../../lib/repositories/transactions'
import { ConfirmDialog, MoneyIcon, money } from '../../components/money/Common'
import TransactionEntry from '../../components/money/TransactionEntry'

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return <View className="min-h-11 flex-row items-center justify-between border-t border-surface-800 px-3 py-2.5">
    <Text className="text-[14px] text-surface-400">{label}</Text>
    <Text className="ml-3 flex-1 text-right text-[16px] text-surface-100">{value}</Text>
  </View>
}

export default function TransactionDetail(): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()
  const [transaction, setTransaction] = useState<LocalFeedTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!params.id) return
    const found = await ledger.transaction(params.id)
    setTransaction(found)
    setLoading(false)
    if (found?.purchaseId) {
      const receipt = await ledger.receipt(found.purchaseId)
      setReceiptTotal(receipt?.purchase.totalCents ?? null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, ledger.version])

  useEffect(() => {
    void load()
  }, [load])

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/(money)/transactions')
  }

  if (loading) {
    return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#91c4ff" /></View>
  }

  if (!transaction) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <Text className="text-center text-[18px] font-semibold text-surface-100">This transaction is gone</Text>
      <Text className="mt-2 text-center text-[16px] leading-5 text-surface-400">It was deleted here or on another device.</Text>
      <Pressable accessibilityRole="button" onPress={back} className="mt-4 min-h-11 justify-center rounded-lg bg-accent-600 px-4">
        <Text className="text-[16px] font-semibold text-white">Back to Activity</Text>
      </Pressable>
    </View>
  }

  const sign = transaction.kind === 'income' ? '+' : transaction.kind === 'expense' ? '-' : ''
  const amountColor = transaction.kind === 'income'
    ? 'text-emerald-400'
    : transaction.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'
  const heading = transaction.merchant
    ?? (transaction.kind === 'transfer' ? transaction.destinationAccountName ?? 'Transfer' : transaction.categoryName ?? 'Archived category')
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
    <ScrollView className="flex-1 px-3 pt-3">
      <View className="items-center rounded-xl border border-surface-800 bg-surface-900/70 px-3 py-5">
        <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: transaction.categoryColor ?? '#707078' }}>
          <MoneyIcon name={transaction.categoryIcon ?? (transaction.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={19} />
        </View>
        <Text
          accessibilityLabel={`${transaction.kind} of ${money(transaction.amountCents)}`}
          className={`mt-3 text-[32px] font-bold ${amountColor}`}
          style={{ fontVariant: ['tabular-nums'] }}
        >{sign}{money(transaction.amountCents)}</Text>
        <Text className="mt-1 text-center text-[20px] font-semibold text-surface-100">{heading}</Text>
        {transaction.pending !== 'none' && <Text className={`mt-1.5 text-[14px] ${transaction.pending === 'pending' ? 'text-surface-400' : 'text-amber-300'}`}>
          {transaction.pending === 'pending' ? 'Pending. Waiting for the server.' : 'Needs attention. Review it in Activity.'}
        </Text>}
      </View>

      <View className="mt-3 overflow-hidden rounded-xl border border-surface-800 bg-surface-900/70">
        <Row label="Date" value={new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
        <Row label={transaction.kind === 'transfer' ? 'From' : 'Account'} value={transaction.accountName} />
        {transaction.kind === 'transfer'
          ? <Row label="To" value={transaction.destinationAccountName ?? 'Archived account'} />
          : <Row label="Category" value={transaction.categoryName ?? 'Archived category'} />}
        {transaction.notes.length > 0 && <Row label="Notes" value={transaction.notes} />}
      </View>

      {transaction.purchaseId && <View className="mt-3 overflow-hidden rounded-xl border border-surface-800 bg-surface-900/70">
        <View className="flex-row items-center px-3 pb-1 pt-3">
          <Receipt color="#91c4ff" size={15} />
          <Text className="ml-1.5 text-[16px] font-semibold text-surface-100">Receipt</Text>
        </View>
        <Row label="Merchant" value={transaction.merchant ?? heading} />
        <Row label="Receipt total" value={money(receiptTotal ?? transaction.amountCents)} />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/(money)/purchases', params: { purchaseId: transaction.purchaseId ?? '' } })}
          className="min-h-11 flex-row items-center justify-between border-t border-surface-800 px-3 py-2.5"
        >
          <Text className="text-[16px] font-semibold text-accent-400">View items</Text>
          <ArrowRight color="#91c4ff" size={16} />
        </Pressable>
      </View>}

      <View className="mt-4 flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing(true)}
          className="min-h-11 flex-1 flex-row items-center justify-center rounded-lg bg-accent-600"
        >
          <Pencil color="#fff" size={16} />
          <Text className="ml-1.5 text-[16px] font-semibold text-white">Edit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirming(true)}
          className="min-h-11 flex-1 flex-row items-center justify-center rounded-lg border border-rose-500/40"
        >
          <Trash2 color="#fb7185" size={16} />
          <Text className="ml-1.5 text-[16px] font-semibold text-rose-300">Delete</Text>
        </Pressable>
      </View>
      <View className="h-10" />
    </ScrollView>

    {editing && <TransactionEntry
      snapshot={editorSnapshot}
      transaction={transaction}
      onSave={(input) => ledger.saveTransaction(input, transaction)}
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
