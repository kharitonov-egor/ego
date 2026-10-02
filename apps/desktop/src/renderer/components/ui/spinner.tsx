import React from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Spinner({ size = 20, color = '#fafafa', className }: { size?: number; color?: string; className?: string }): React.ReactElement {
  return <LoaderCircle aria-label="Loading" role="status" color={color} size={size} className={cn('animate-spin', className)} />
}
