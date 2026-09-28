import React from 'react'
import { View, type TextProps, type ViewProps } from 'react-native'
import { cn } from '../../lib/utils'
import { Text, TextClassContext } from './text'

export function Card({ className, ...props }: ViewProps): React.ReactElement {
  return <TextClassContext.Provider value="text-card-foreground">
    <View className={cn('rounded-3xl border border-border bg-card', className)} {...props} />
  </TextClassContext.Provider>
}

export function CardHeader({ className, ...props }: ViewProps): React.ReactElement {
  return <View className={cn('gap-1 px-5 pt-5', className)} {...props} />
}

export function CardTitle({ className, ...props }: TextProps): React.ReactElement {
  return <Text accessibilityRole="header" className={cn('text-[18px] font-semibold', className)} {...props} />
}

export function CardDescription({ className, ...props }: TextProps): React.ReactElement {
  return <Text className={cn('text-[14px] text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: ViewProps): React.ReactElement {
  return <View className={cn('p-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: ViewProps): React.ReactElement {
  return <View className={cn('flex-row items-center px-5 pb-5', className)} {...props} />
}
