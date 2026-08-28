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
      <View className="rounded-t-3xl border-t border-surface-700 bg-surface-950 pb-8">
        <View className="flex-row items-center justify-between px-5 py-4">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-surface-100">{title}</Text>
            {detail && <Text className="mt-0.5 text-xs text-surface-500">{detail}</Text>}
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X color="#8a93ab" size={20} /></Pressable>
        </View>
        <Pressable onLongPress={() => setExpression('')} className="items-center py-5">
          <Text numberOfLines={1} className="text-4xl font-light" style={{ color }}>$ {formatAmountExpression(expression)}</Text>
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
