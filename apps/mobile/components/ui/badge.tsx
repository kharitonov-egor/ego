import React from 'react'
import { View, type ViewProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import { TextClassContext } from './text'

const badgeVariants = cva('flex-row items-center self-start rounded-full px-2.5 py-1', {
  variants: {
    variant: {
      default: 'bg-primary',
      secondary: 'bg-secondary',
      outline: 'border border-border',
      positive: 'bg-positive/15'
    }
  },
  defaultVariants: { variant: 'default' }
})

const badgeTextVariants = cva('text-[13px] font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      positive: 'text-positive'
    }
  },
  defaultVariants: { variant: 'default' }
})

export function Badge({ className, variant, ...props }: ViewProps & VariantProps<typeof badgeVariants>): React.ReactElement {
  return <TextClassContext.Provider value={badgeTextVariants({ variant })}>
    <View className={cn(badgeVariants({ variant }), className)} {...props} />
  </TextClassContext.Provider>
}
