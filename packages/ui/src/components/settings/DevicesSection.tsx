import React, { useCallback, useEffect, useState } from 'react'
import { Globe, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import type { DeviceSummary } from '@ego/api-contracts'
import { useLedger } from '../../lib/ledger'
import { Section, SectionNote } from '../Section'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/dialog'

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function usedLabel(device: DeviceSummary): string {
  if (!device.lastSeenAt) return `Signed in ${DAY.format(new Date(device.createdAt))}`
  const days = Math.floor((Date.now() - Date.parse(device.lastSeenAt)) / 86_400_000)
  if (days <= 0) return 'Used today'
  if (days === 1) return 'Used yesterday'
  return `Used ${DAY.format(new Date(device.lastSeenAt))}`
}

/** Every phone, computer, and browser the Worker still accepts, so a lost one can be cut off from here. */
export function DevicesSection(): React.ReactElement {
  const ledger = useLedger()
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<DeviceSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.devices()
    if (result.ok) {
      setDevices(result.data.devices)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    void load()
  }, [load, ledger.account?.deviceId])

  const revoke = async (): Promise<void> => {
    if (!revoking) return
    setBusy(true)
    const result = await ledger.api.revokeDevice(revoking.id)
    setBusy(false)
    setRevoking(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') setError(result.error.message)
    await load()
  }

  return <Section Icon={ShieldCheck} title="Signed-in devices">
    <SectionNote>Each one holds its own key to the server. Sign one out here and it stops syncing at once.</SectionNote>
    <div className="mt-3">{(devices ?? []).map((device) => {
      const Icon = device.browser ? Globe : MonitorSmartphone
      return <div key={device.id} className="flex min-h-16 items-center border-t border-surface-800 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-800"><Icon color="#d4d4d4" size={17} /></span>
        <div className="ml-3 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px]">{device.name}</span>
            {device.current && <Badge variant="positive">This one</Badge>}
          </div>
          <p className="text-[14px] text-muted-foreground">
            {usedLabel(device)}
            {device.expiresAt && ` · signs out ${DAY.format(new Date(device.expiresAt))} if unused`}
          </p>
        </div>
        {!device.current && <Button variant="outline" onClick={() => setRevoking(device)}>Sign out</Button>}
      </div>
    })}</div>
    {devices === null && !error && <p className="mt-2 text-[15px] text-muted-foreground">Loading...</p>}
    {error && <p role="alert" className="mt-2 text-[15px] leading-5 text-destructive">{error}</p>}
    <ConfirmDialog
      visible={revoking !== null}
      title={`Sign out ${revoking?.name ?? 'this device'}?`}
      detail="The server stops accepting it right away. Changes it has not synced yet stay on it until it signs in again."
      confirmLabel="Sign out"
      destructive
      busy={busy}
      onCancel={() => setRevoking(null)}
      onConfirm={() => void revoke()}
    />
  </Section>
}
