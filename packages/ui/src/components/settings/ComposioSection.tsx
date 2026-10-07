import React, { useEffect, useState } from 'react'
import { Blocks, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { ComposioStatus } from '@ego/api-contracts'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'
import { Code, CopyField } from '../copy'
import { ExternalLink } from '../ExternalLink'
import { Section, SectionNote } from '../Section'

const DASHBOARD_URL = 'https://dashboard.composio.dev'

function StatusRow({ on, label, detail }: { on: boolean; label: string; detail: string }): React.ReactElement {
  return <div className="flex min-h-14 items-center border-t border-surface-800 py-2 first:border-t-0">
    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', on ? 'bg-positive/15' : 'bg-surface-800')}>
      {on ? <Check color="#34d399" size={17} /> : <X color="#a3a3a3" size={17} />}
    </div>
    <div className="ml-3 min-w-0 flex-1">
      <p className="text-[16px]">{label}</p>
      <p className="text-[14px] text-muted-foreground">{detail}</p>
    </div>
  </div>
}

function SetupSteps({ webhookUrl }: { webhookUrl: string }): React.ReactElement {
  return <ol className="mt-3 list-decimal space-y-3 pl-5 text-[14px] leading-6 text-surface-300">
    <li>
      Make a project API key at <ExternalLink href={DASHBOARD_URL} className="font-semibold text-surface-100 underline underline-offset-4 hover:text-foreground">dashboard.composio.dev</ExternalLink>.
      Then from <Code>apps/api</Code>, run this and paste the key when asked.
      <CopyField text="npx wrangler secret put COMPOSIO_API_KEY" className="mt-2" />
    </li>
    <li>
      In Composio, add a webhook subscription for the event <Code>composio.trigger.message</Code> that points to this URL.
      <CopyField text={webhookUrl} className="mt-2" />
      <p className="mt-3">Copy its signing secret, then run this and paste the secret when asked.</p>
      <CopyField text="npx wrangler secret put COMPOSIO_WEBHOOK_SECRET" className="mt-2" />
    </li>
    <li>Connect apps by asking the chat, for example "connect my Gmail". It replies with a link.</li>
  </ol>
}

/** Composio: the chat's way into Gmail, Drive, Slack, and other apps, and the events that start goals. */
export function ComposioSection(): React.ReactElement {
  const ledger = useLedger()
  const [status, setStatus] = useState<ComposioStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    let active = true
    void ledger.api.composioStatus().then((result) => {
      if (!active) return
      if (result.ok) {
        setStatus(result.data)
        setError(null)
      } else {
        setError(result.error.message)
      }
    })
    return () => { active = false }
  }, [ledger.api])

  return <Section Icon={Blocks} title="Other apps">
    <SectionNote>Through Composio, the chat can reach Gmail, Drive, Slack, web search, and more. Goals can also start when something happens in one of those apps.</SectionNote>
    {!status && !error && <p className="mt-3 text-[15px] text-muted-foreground">Loading...</p>}
    {error && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{error}</p>}

    {status && <>
      <div className="mt-3">
        <StatusRow
          on={status.configured}
          label={status.configured ? 'Composio connected' : 'Not set up'}
          detail={status.configured ? 'The chat can use the apps you connect' : 'The Worker needs COMPOSIO_API_KEY'}
        />
        <StatusRow
          on={status.webhookReady}
          label={status.webhookReady ? 'App events on' : 'App events off'}
          detail={status.webhookReady ? 'Goals can start from app events' : 'The Worker needs COMPOSIO_WEBHOOK_SECRET'}
        />
      </div>
      {status.configured && status.webhookReady
        ? <>
          <button
            type="button"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((shown) => !shown)}
            className="mt-3 flex items-center gap-1.5 text-[15px] font-semibold text-surface-200 hover:text-foreground"
          >
            {showSteps ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            How to set it up
          </button>
          {showSteps && <SetupSteps webhookUrl={status.webhookUrl} />}
        </>
        : <>
          <p className="mt-4 text-[15px] font-semibold">Set it up</p>
          <SetupSteps webhookUrl={status.webhookUrl} />
        </>}
    </>}

    <SectionNote className="mt-4">The chat reads from your apps directly. Anything that sends, creates, changes, or deletes shows up as a card first.</SectionNote>
  </Section>
}
