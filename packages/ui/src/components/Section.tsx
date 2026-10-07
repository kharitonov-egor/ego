import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './ui/card'

/** One card of the Settings page: an icon, a title, an optional control on the right, and the body. */
export function Section({ Icon, title, tone = '#fafafa', right, children }: {
  Icon: LucideIcon
  title: string
  tone?: string
  right?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return <Card className="p-5">
    <div className="flex items-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-800"><Icon color={tone} size={19} /></div>
      <h2 className="ml-3 flex-1 text-[18px] font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </Card>
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  return <label htmlFor={htmlFor} className="mb-2 mt-4 block text-[15px] font-medium text-surface-200">{children}</label>
}

export function SectionNote({ children, className = 'mt-3' }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <p className={`${className} text-[15px] leading-6 text-muted-foreground`}>{children}</p>
}
