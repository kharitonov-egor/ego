import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, View } from 'react-native'
import { Blocks, Check, Copy, ExternalLink, X } from 'lucide-react-native'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect } from 'expo-router'
import type { ComposioStatus } from '@ego/api-contracts'
import type { EgoApi } from '@ego/local/api-client'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Text } from '../ui/text'

const COMPOSIO_DASHBOARD_URL = 'https://dashboard.composio.dev'

function StatusRow({ ready, label, detail }: { ready: boolean; label: string; detail: string }): React.ReactElement {
  return <View className="mt-2 min-h-12 flex-row items-center">
    <View className={`h-8 w-8 items-center justify-center rounded-full ${ready ? 'bg-positive/15' : 'bg-surface-800'}`}>
      {ready ? <Check color="#34d399" size={17} /> : <X color="#a3a3a3" size={17} />}
    </View>
    <View className="ml-3 flex-1">
      <Text className="text-[16px]">{label}</Text>
      <Text className="text-[14px] text-muted-foreground">{detail}</Text>
    </View>
  </View>
}

function Step({ number, children }: { number: number; children: string }): React.ReactElement {
  return <View className="mt-3 flex-row">
    <Text className="w-6 text-[15px] leading-5 text-muted-foreground">{number}.</Text>
    <Text className="flex-1 text-[15px] leading-5 text-surface-200">{children}</Text>
  </View>
}

function CopyField({ label, value }: { label: string; value: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return <View className="mt-2 flex-row items-center rounded-xl border border-input bg-surface-900 pl-4">
    <Text selectable className="flex-1 py-3 font-mono text-[14px] leading-5 text-surface-200">{value}</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? `${label} copied` : `Copy ${label}`}
      onPress={() => void Clipboard.setStringAsync(value).then(() => setCopied(true))}
      className="h-12 w-12 items-center justify-center rounded-xl active:bg-surface-800"
    >{copied ? <Check color="#fafafa" size={18} /> : <Copy color="#d4d4d4" size={18} />}</Pressable>
  </View>
}

function SetupSteps({ webhookUrl }: { webhookUrl: string }): React.ReactElement {
  return <View className="mt-4 rounded-2xl bg-surface-900 p-4">
    <Text className="text-[17px] font-semibold">Set up Composio</Text>
    <Step number={1}>Make a project API key at dashboard.composio.dev. Then, from apps/api on the computer, run this and paste the key.</Step>
    <Button variant="outline" size="sm" onPress={() => void Linking.openURL(COMPOSIO_DASHBOARD_URL).catch(() => undefined)} className="ml-6 mt-2 self-start">
      <ExternalLink color="#fafafa" size={16} />
      <Text>Open Composio</Text>
    </Button>
    <CopyField label="API key command" value="npx wrangler secret put COMPOSIO_API_KEY" />
    <Step number={2}>In Composio, add a webhook subscription to this URL for the event composio.trigger.message.</Step>
    <CopyField label="webhook URL" value={webhookUrl} />
    <Text className="ml-6 mt-3 text-[15px] leading-5 text-surface-200">Copy its signing secret, then run this and paste the secret.</Text>
    <CopyField label="webhook secret command" value="npx wrangler secret put COMPOSIO_WEBHOOK_SECRET" />
    <Step number={3}>Connect apps by asking the chat, for example "connect my Gmail".</Step>
  </View>
}

export function ComposioSection({ api }: { api: EgoApi }): React.ReactElement {
  const [status, setStatus] = useState<ComposioStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(useCallback(() => {
    let cancelled = false
    void api.composioStatus().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setStatus(result.data)
        setError(null)
      } else setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [api]))

  return <Card className="p-5">
    <View className="flex-row items-center">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-800"><Blocks color="#fafafa" size={19} /></View>
      <Text accessibilityRole="header" className="ml-3 flex-1 text-[18px] font-semibold">Other apps</Text>
    </View>
    <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">Through Composio, the chat can use Gmail, Slack, GitHub, and other apps, and goals can start when something happens in them.</Text>
    {status === null
      ? error
        ? <Text className="mt-3 text-[15px] leading-5 text-destructive">{error}</Text>
        : <ActivityIndicator size="small" color="#fafafa" className="mt-4 self-start" />
      : <>
        <StatusRow
          ready={status.configured}
          label={status.configured ? 'Composio connected' : 'Not set up'}
          detail={status.configured ? 'The chat can reach your apps' : 'The chat cannot reach other apps yet'}
        />
        <StatusRow
          ready={status.webhookReady}
          label={status.webhookReady ? 'App events on' : 'App events off'}
          detail={status.webhookReady ? 'Event goals start when something happens' : 'Event goals cannot start yet'}
        />
        {(!status.configured || !status.webhookReady) && <SetupSteps webhookUrl={status.webhookUrl} />}
      </>}
    <Text className="mt-4 text-[14px] leading-5 text-muted-foreground">The chat reads from your apps on its own. Anything that sends, creates, changes, or deletes goes on a card for you to confirm first.</Text>
  </Card>
}
