import React, { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

/** Copies `text` and says so for two seconds. */
export function CopyButton({ text, label = 'Copy', size = 'sm' }: {
  text: string
  label?: string
  size?: 'sm' | 'default'
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return <Button
    variant="outline"
    size={size}
    onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
  >
    {copied ? <Check size={15} /> : <Copy size={15} />}
    {copied ? 'Copied' : label}
  </Button>
}

export function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded-md border border-surface-700 bg-surface-900 px-1.5 py-0.5 font-mono text-[0.9em] text-surface-100">{children}</code>
}

/** A key, address, or command in monospace with a copy button beside it. */
export function CopyField({ text, className }: { text: string; className?: string }): React.ReactElement {
  return <div className={cn('mt-3 flex items-start gap-3', className)}>
    <pre className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black px-3 py-2.5 font-mono text-[14px] leading-6 text-foreground">{text}</pre>
    <CopyButton text={text} size="default" />
  </div>
}
