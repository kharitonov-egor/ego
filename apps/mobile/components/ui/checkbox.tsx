import React from 'react'
import { Pressable, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { cn } from '../../lib/utils'
import { Text } from './text'

/**
 * The box and its label share one touch target, because a 20px box alone is too small to hit.
 * `color` fills the checked box, so a chart toggle doubles as that series' legend key.
 */
export function Checkbox({ checked, onCheckedChange, label, color, disabled = false, className }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  color?: string
  disabled?: boolean
  className?: string
}): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityLabel={label}
    accessibilityState={{ checked, disabled }}
    disabled={disabled}
    onPress={() => onCheckedChange(!checked)}
    hitSlop={4}
    className={cn('min-h-11 flex-row items-center gap-2.5 pr-1', className)}
  >
    <View
      className={cn('h-5 w-5 items-center justify-center rounded-md border', checked ? 'border-transparent' : 'border-surface-500')}
      style={checked ? { backgroundColor: color ?? '#fafafa' } : undefined}
    >
      {checked && <Check color="#0a0a0a" size={14} strokeWidth={3} />}
    </View>
    <Text className={cn('text-[14px] font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>{label}</Text>
  </Pressable>
}
