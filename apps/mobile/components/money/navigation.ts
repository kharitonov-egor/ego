import type { ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const moneyTabBarStyle: ViewStyle = {
  backgroundColor: '#1c1d1f',
  borderTopColor: '#2b2c30',
  height: 60,
  paddingTop: 5,
  paddingBottom: 6
}

const MIN_TAB_BAR_GAP = 10

export function useMoneyTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets()
  const gap = Math.max(MIN_TAB_BAR_GAP, insets.bottom)
  return { ...moneyTabBarStyle, height: 60 + gap, paddingBottom: 6 + gap }
}
