import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, SectionList, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowDownUp, ChevronDown, Circle, CircleDot, CloudOff, Download, FileText, Globe, Lock, type LucideIcon } from 'lucide-react-native'
import type { DocketSummary } from '@ego/api-contracts'
import {
  DOCKET_ORDERS, DOCKET_ORDER_KEY, docketDate, groupByRepository, isDocketOrder, sortDockets, type DocketOrder
} from '@ego/local/dockets'
import { MenuSheet } from '../components/gym/ui'
import { color } from '../components/money/tokens'
import { Button } from '../components/ui/button'
import { Text } from '../components/ui/text'
import { Blurred } from '../lib/blur'
import { openDocketPdf } from '../lib/dockets'
import { useLedger } from '../lib/ledger-context'

interface PdfState {
  busy: boolean
  error: string | null
}

interface Section {
  title: string | null
  data: DocketSummary[]
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Message({ Icon, title, detail, action, onAction }: {
  Icon: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center px-8">
    <Icon color={color.textFaint} size={34} />
    <Text className="mt-3 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><Text>{action}</Text></Button>}
  </View>
}

function DocketRow({ docket, order, showRepository, pdf, onDownload }: {
  docket: DocketSummary
  order: DocketOrder
  showRepository: boolean
  pdf: PdfState | undefined
  onDownload: () => void
}): React.ReactElement {
  const meta = [showRepository ? docket.repository ?? 'No repository' : null, `v${docket.latestVersion}`, day(docketDate(docket, order))]
    .filter(Boolean).join(' · ')
  const Visibility = docket.public ? Globe : Lock
  return <View className="flex-row items-start border-b border-surface-900 py-3.5 pl-4 pr-1">
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Opens the docket in the browser"
      onPress={() => void Linking.openURL(docket.url)}
      className="flex-1 active:opacity-70"
    >
      <Blurred><Text numberOfLines={2} className="text-[17px] font-semibold leading-6">{docket.title}</Text></Blurred>
      {docket.description !== '' && <Blurred>
        <Text numberOfLines={2} className="mt-0.5 text-[15px] leading-5 text-muted-foreground">{docket.description}</Text>
      </Blurred>}
      <View className="mt-1.5 flex-row items-center gap-1.5">
        <Visibility color={color.textMuted} size={13} accessibilityLabel={docket.public ? 'Public' : 'Private'} />
        <Text numberOfLines={1} className="flex-1 text-[13px] text-muted-foreground">{meta}</Text>
      </View>
      {pdf?.error && <Text accessibilityRole="alert" className="mt-1 text-[14px] text-destructive">{pdf.error}</Text>}
    </Pressable>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pdf?.busy ? 'Making the PDF' : 'Download PDF'}
      disabled={pdf?.busy}
      onPress={onDownload}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-800"
    >
      {pdf?.busy ? <ActivityIndicator color="#fafafa" /> : <Download color={color.textSecondary} size={21} />}
    </Pressable>
  </View>
}

export default function DocketsScreen(): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [dockets, setDockets] = useState<DocketSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [order, setOrder] = useState<DocketOrder | null>(null)
  const [sorting, setSorting] = useState(false)
  const [pdfs, setPdfs] = useState<Record<string, PdfState>>({})

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.dockets()
    if (result.ok) {
      setDockets(result.data.dockets)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    if (ledger.enabled) void load()
  }, [ledger.enabled, load])

  useEffect(() => {
    void SecureStore.getItemAsync(DOCKET_ORDER_KEY)
      .then((saved) => setOrder(isDocketOrder(saved) ? saved : 'newest'), () => setOrder('newest'))
  }, [])

  const changeOrder = (next: DocketOrder): void => {
    setOrder(next)
    void SecureStore.setItemAsync(DOCKET_ORDER_KEY, next).catch(() => undefined)
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const download = async (docket: DocketSummary): Promise<void> => {
    setPdfs((current) => ({ ...current, [docket.id]: { busy: true, error: null } }))
    let problem: string | null = null
    try {
      await openDocketPdf(ledger.api, docket)
    } catch (failure) {
      problem = failure instanceof Error ? failure.message : 'The PDF did not download'
    }
    setPdfs((current) => ({ ...current, [docket.id]: { busy: false, error: problem } }))
  }

  const sections = useMemo<Section[]>(() => {
    if (!dockets || !order) return []
    if (order === 'project') {
      return groupByRepository(sortDockets(dockets, 'updated')).map((group) => ({ title: group.repository ?? 'No repository', data: group.dockets }))
    }
    return [{ title: null, data: sortDockets(dockets, order) }]
  }, [dockets, order])

  let body: React.ReactElement
  if (!ledger.enabled) {
    body = <Message Icon={FileText} title="Sign in to see your dockets" detail="Sign in once with Google on the start screen." action="Go to sign in" onAction={() => router.dismissTo('/')} />
  } else if (dockets === null && error) {
    body = <Message Icon={CloudOff} title="Could not load your dockets" detail={error} action="Try again" onAction={() => void load()} />
  } else if (dockets === null || order === null) {
    body = <ActivityIndicator color="#fafafa" style={{ marginTop: 48 }} />
  } else if (dockets.length === 0) {
    body = <Message Icon={FileText} title="No dockets yet" detail="Agents upload them with the docket CLI. Set it up under Docket in Ego on a computer." />
  } else {
    const current = DOCKET_ORDERS.find((option) => option.value === order)?.label ?? ''
    body = <SectionList
      sections={sections}
      keyExtractor={(docket) => docket.id}
      stickySectionHeadersEnabled={false}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      ListHeaderComponent={<View className="px-4 pb-1 pt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-[14px] font-semibold text-muted-foreground">{dockets.length === 1 ? '1 docket' : `${dockets.length} dockets`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${current}`}
            onPress={() => setSorting(true)}
            className="min-h-11 flex-row items-center gap-2 rounded-xl border border-border px-3 active:bg-surface-900"
          >
            <ArrowDownUp color={color.textSecondary} size={16} />
            <Text className="text-[15px] font-medium">{current}</Text>
            <ChevronDown color={color.textSecondary} size={16} />
          </Pressable>
        </View>
        {error && <Text accessibilityRole="alert" className="mt-2 text-[14px] text-destructive">{error}</Text>}
      </View>}
      renderSectionHeader={({ section }) => section.title === null
        ? null
        : <Text accessibilityRole="header" className="px-4 pb-1 pt-5 text-[17px] font-bold">{section.title}</Text>}
      renderItem={({ item }) => <DocketRow
        docket={item}
        order={order}
        showRepository={order !== 'project'}
        pdf={pdfs[item.id]}
        onDownload={() => void download(item)}
      />}
    />
  }

  return <View className="flex-1 bg-background">
    <Stack.Screen options={{ title: 'Docket' }} />
    {body}
    <MenuSheet
      visible={sorting}
      title="Sort dockets"
      onClose={() => setSorting(false)}
      items={DOCKET_ORDERS.map((option) => ({
        label: option.label,
        Icon: option.value === order ? CircleDot : Circle,
        onPress: () => changeOrder(option.value)
      }))}
    />
  </View>
}
