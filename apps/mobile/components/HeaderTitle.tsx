import React from 'react'
import { Text } from 'react-native'
import { color } from './money/tokens'

/** React Navigation draws its own titles from node_modules, which keep Android's emoji. This one draws Apple's. */
export function HeaderTitle({ title }: { title: string }): React.ReactElement {
  return <Text accessibilityRole="header" numberOfLines={1} style={{ color: color.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
}
