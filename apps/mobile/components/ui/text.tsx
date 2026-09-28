import React, { createContext, useContext } from 'react'
import { Text as NativeText, type TextProps } from 'react-native'
import { cn } from '../../lib/utils'

/** Lets a Button or Card set the ink for every Text inside it, the way CSS inheritance would. */
export const TextClassContext = createContext<string | undefined>(undefined)

export function Text({ className, ...props }: TextProps): React.ReactElement {
  const inherited = useContext(TextClassContext)
  return <NativeText className={cn('text-[16px] text-foreground', inherited, className)} {...props} />
}
