import React, { useCallback, useEffect, useRef, useState } from 'react'
import { testPushMessage } from '../../lib/agent'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'
import type { PushState } from '../../platform/types'
import { Code, CopyField } from '../copy'
import { SectionNote } from '../Section'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'

const SWITCH_LABEL = 'Show notifications here'

function permissionNote(state: PushState): string {
  if (!state.supported) return 'This browser cannot get push notifications.'
  if (state.permission === 'denied') return "The browser blocks notifications from this site. Allow them in the browser's site settings, then reload the page."
  if (state.permission === 'granted') return 'The browser allows notifications from Ego.'
  return 'The browser asks for permission when you turn this on.'
}

function MissingKeys(): React.ReactElement {
  return <div className="mt-3">
    <p className="text-[15px] leading-5 text-attention">The Worker has no Web Push keys yet.</p>
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-[14px] leading-6 text-surface-300">
      <li>
        From the repository root, make a key pair.
        <CopyField text="node scripts/web-push-keys.mjs" className="mt-2" />
      </li>
      <li>
        From <Code>apps/api</Code>, run these and paste the public key and then the private key when asked.
        <CopyField text="npx wrangler secret put WEB_PUSH_PUBLIC_KEY" className="mt-2" />
        <CopyField text="npx wrangler secret put WEB_PUSH_PRIVATE_KEY" className="mt-2" />
      </li>
      <li>Turn this on again.</li>
    </ol>
  </div>
}

/** Web Push for the agent's messages, in the browser this page runs in. */
export function BrowserNotifications({ webOff }: { webOff: boolean }): React.ReactElement {
  const { api } = useLedger()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingKeys, setMissingKeys] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<{ text: string; good: boolean } | null>(null)
  /** Fetched ahead, so a click reaches the permission prompt while the browser still treats it as a click. */
  const workerKey = useRef<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => setState(await window.api.pushState()), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    void api.webPushKey().then((result) => {
      if (active && result.ok) workerKey.current = result.data.publicKey
    })
    return () => { active = false }
  }, [api])

  const turnOn = async (): Promise<void> => {
    let publicKey = workerKey.current
    if (!publicKey) {
      const result = await api.webPushKey()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      publicKey = result.data.publicKey
      workerKey.current = publicKey
    }
    setMissingKeys(!publicKey)
    if (!publicKey) return
    const subscribed = await window.api.pushSubscribe(publicKey)
    if (!subscribed.ok) {
      if ((await window.api.pushState()).permission !== 'denied') setError(subscribed.message)
      return
    }
    const saved = await api.saveWebPushSubscription(subscribed.subscription)
    if (!saved.ok) {
      setError(saved.error.message)
      await window.api.pushUnsubscribe()
    }
  }

  const turnOff = async (): Promise<void> => {
    const endpoint = await window.api.pushUnsubscribe()
    if (!endpoint) return
    const removed = await api.deleteWebPushSubscription(endpoint)
    if (!removed.ok) setError(removed.error.message)
  }

  const toggle = async (on: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setTested(null)
    try {
      await (on ? turnOn() : turnOff())
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    setTested(null)
    const result = await api.testWebPush()
    setTesting(false)
    setTested(result.ok ? testPushMessage(result.data) : { text: result.error.message, good: false })
  }

  const subscribed = Boolean(state?.endpoint)
  const blocked = state?.permission === 'denied'
  return <>
    <div className="flex min-h-12 items-center justify-between gap-3 border-t border-surface-800 py-2">
      <span className="text-[16px]">{SWITCH_LABEL}</span>
      <Switch
        label={SWITCH_LABEL}
        checked={subscribed}
        disabled={busy || !state?.supported || (blocked && !subscribed)}
        onCheckedChange={(on) => void toggle(on)}
      />
    </div>
    {state
      ? <p className={cn('text-[14px] leading-5', blocked ? 'text-attention' : 'text-muted-foreground')}>{permissionNote(state)}</p>
      : <p className="text-[15px] text-muted-foreground">Loading...</p>}
    {missingKeys && <MissingKeys />}
    {error && <p role="alert" className="mt-2 text-[15px] leading-5 text-destructive">{error}</p>}
    {webOff && <SectionNote className="mt-2">Web is off above, so the agent will not notify this browser. A test still goes through.</SectionNote>}
    {subscribed && <>
      <Button variant="outline" size="lg" disabled={testing} onClick={() => void test()} className="mt-3 w-full">
        {testing ? 'Sending...' : 'Send a test'}
      </Button>
      {tested && <p role="status" className={cn('mt-2 text-[15px] leading-5', tested.good ? 'text-positive' : 'text-destructive')}>{tested.text}</p>}
    </>}
  </>
}
