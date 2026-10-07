import React from 'react'
import { AppWindow } from 'lucide-react'
import { Button } from '@ego/ui/components/ui/button'

const TEXT = {
  open: { title: 'Ego is open in another tab', detail: 'One tab at a time keeps the copy of your data on this computer. Switch to that tab, or use Ego here and the other tab steps aside.' },
  moved: { title: 'Ego moved to another tab', detail: 'Changes made here already saved. Use Ego here again to bring it back to this tab.' },
  connected: { title: 'Connected', detail: 'Your other Ego tab has it now. You can close this one.' }
}

export function Elsewhere({ reason, onUseHere }: { reason: keyof typeof TEXT; onUseHere: () => void }): React.ReactElement {
  const text = TEXT[reason]
  return <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
    <div className="w-full max-w-md rounded-3xl border border-surface-800 bg-card p-8 text-center">
      <AppWindow className="mx-auto" color="#a3a3a3" size={28} />
      <h1 className="mt-4 text-[22px] font-bold">{text.title}</h1>
      <p className="mt-2 text-[16px] leading-6 text-muted-foreground">{text.detail}</p>
      <Button size="lg" onClick={onUseHere} className="mt-6 w-full">Use Ego here</Button>
    </div>
  </div>
}
