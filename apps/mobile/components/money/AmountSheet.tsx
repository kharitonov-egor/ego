import React, { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '../../lib/amount-input'
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
  const [expression, setExpression] = useState(() => amountToExpression(valueCents))
  useEffect(() => {
    if (visible) setExpression(amountToExpression(valueCents))
  }, [valueCents, visible])
  const cents = evaluateAmount(expression) ?? 0
  const valid = cents > 0 || (allowZero && expression === '')
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View className="flex-1 justify-end bg-black/70">
      <View className="rounded-t-2xl border-t border-surface-700 bg-surface-950 pb-6">
        <View className="flex-row items-center justify-between px-4 py-3">
          <View className="flex-1 pr-3">
            <Text className="text-[15px] font-bold text-surface-100">{title}</Text>
            {detail && <Text className="mt-0.5 text-[11px] text-surface-400">{detail}</Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}><X color="#b5b5bc" size={20} /></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityHint="Hold to clear the amount" onLongPress={() => setExpression('')} className="items-center py-3">
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} className="px-4 text-[38px] font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>$ {formatAmountExpression(expression)}</Text>
        </Pressable>
        <AmountKeypad
          onKey={(key) => setExpression((current) => pressAmountKey(current, key))}
          onConfirm={() => onConfirm(cents)}
          confirmDisabled={!valid}
          confirmColor={color}
        />
      </View>
    </View>
  </Modal>
}
