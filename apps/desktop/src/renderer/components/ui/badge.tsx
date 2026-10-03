import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex items-center self-start rounded-full px-2.5 py-1 text-[13px] font-semibold', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
      outline: 'border border-border text-foreground',
      positive: 'bg-positive/15 text-positive'
    }
  },
  defaultVariants: { variant: 'default' }
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
