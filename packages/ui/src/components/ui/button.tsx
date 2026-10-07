import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70',
        outline: 'border border-input bg-background text-foreground hover:bg-secondary/60 active:bg-secondary',
        ghost: 'text-foreground hover:bg-secondary/60 active:bg-secondary',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/85'
      },
      size: {
        default: 'min-h-11 px-5 text-[15px]',
        sm: 'min-h-9 rounded-lg px-3.5 text-[14px]',
        lg: 'min-h-12 rounded-2xl px-6 text-[16px]',
        icon: 'h-10 w-10 text-[15px]'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps): React.ReactElement {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

/** The round icon buttons the phone puts in its headers. */
export function IconButton({ label, className, children, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string
}): React.ReactElement {
  return <button
    type="button"
    aria-label={label}
    title={label}
    className={cn('inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-surface-300 transition-colors hover:bg-surface-800 hover:text-foreground disabled:opacity-40', className)}
    {...props}
  >{children}</button>
}
