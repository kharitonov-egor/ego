import React from 'react'
import { Pressable, View } from 'react-native'
import { cn } from '../../lib/utils'
import { Text } from './text'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({ options, value, onValueChange, className }: {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
}): React.ReactElement {
  return <View accessibilityRole="tablist" className={cn('flex-row rounded-xl border border-border bg-surface-900 p-1', className)}>
    {options.map((option) => {
      const active = option.value === value
      return <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={() => onValueChange(option.value)}
        className={cn('min-h-10 flex-1 items-center justify-center rounded-lg px-1', active ? 'bg-surface-700' : 'active:bg-surface-800')}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          className={cn('text-[14px]', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}
        >{option.label}</Text>
      </Pressable>
    })}
  </View>
}
