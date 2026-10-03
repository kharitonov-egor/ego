import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '@ego/local/amount-input'
import { AmountKeypad } from './AmountKeypad'

export function AmountSheet({ visible, title, detail, valueCents, color, allowZero = true, onClose, onConfirm }: {
  visible: boolean
  title: string
  detail?: string
  valueCents: number
  color: string
  allowZero?: boolean
  onClose: () => void
  onConfirm: (cents: number) => void
}): React.ReactElement {
  const insets = useSafeAreaInsets()
  const [expression, setExpression] = useState(() => amountToExpression(valueCents))
  useEffect(() => {
    if (visible) setExpression(amountToExpression(valueCents))
  }, [valueCents, visible])
  const cents = evaluateAmount(expression) ?? 0
  const valid = cents > 0 || (allowZero && expression === '')
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View className="flex-1 justify-end bg-black/70">
      <Pressable accessibilityLabel="Close" onPress={onClose} className="absolute inset-0" />
      <View className="rounded-t-[28px] border-t border-surface-800 bg-background" style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
        <View className="items-center pt-2.5"><View className="h-1.5 w-10 rounded-full bg-surface-700" /></View>
        <View className="flex-row items-center justify-between px-5 pt-2">
          <View className="flex-1 pr-3">
            <Text className="text-[22px] font-bold text-foreground">{title}</Text>
            {detail && <Text className="mt-0.5 text-[15px] text-muted-foreground">{detail}</Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full bg-surface-900 active:bg-surface-800"><X color="#d4d4d4" size={20} /></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityHint="Hold to clear the amount" onLongPress={() => setExpression('')} className="items-center py-5">
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} className="px-5 text-[48px] font-bold tracking-tight" style={{ color }}>${formatAmountExpression(expression)}</Text>
        </Pressable>
        <View style={{ height: 300 }}>
          <AmountKeypad
            onKey={(key) => setExpression((current) => pressAmountKey(current, key))}
            onConfirm={() => onConfirm(cents)}
            confirmDisabled={!valid}
          />
        </View>
      </View>
    </View>
  </Modal>
}
