import React from 'react'
import { Pressable } from 'react-native'

export function HeaderButton({ label, onPress, children }: {
  label: string
  onPress: () => void
  children: React.ReactNode
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={12}
    style={{ marginLeft: 14 }}
  >{children}</Pressable>
}
