import React from 'react'
import { Pressable, type PressableProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import { TextClassContext } from './text'

const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-xl', {
  variants: {
    variant: {
      default: 'bg-primary active:bg-primary/85',
      secondary: 'bg-secondary active:bg-secondary/70',
      outline: 'border border-input bg-background active:bg-secondary',
      ghost: 'active:bg-secondary',
      destructive: 'bg-destructive active:bg-destructive/85'
    },
    size: {
      default: 'min-h-12 px-5',
      sm: 'min-h-11 rounded-lg px-3.5',
      lg: 'min-h-14 rounded-2xl px-6',
      icon: 'h-12 w-12'
    }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

const buttonTextVariants = cva('font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground'
    },
    size: {
      default: 'text-[16px]',
      sm: 'text-[14px]',
      lg: 'text-[17px]',
      icon: 'text-[16px]'
    }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

export type ButtonProps = PressableProps & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, disabled, ...props }: ButtonProps): React.ReactElement {
  return <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      className={cn(buttonVariants({ variant, size }), disabled && 'opacity-40', className)}
      {...props}
    />
  </TextClassContext.Provider>
}
