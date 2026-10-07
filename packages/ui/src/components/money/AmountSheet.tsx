import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { amountToExpression } from '@ego/local/amount-input'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { AmountInput } from './AmountInput'
import { typedAmountCents } from './amount'

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
  const [text, setText] = useState(() => amountToExpression(valueCents))
  useEffect(() => {
    if (visible) setText(amountToExpression(valueCents))
  }, [valueCents, visible])
  const cents = typedAmountCents(text) ?? 0
  const valid = cents > 0 || (allowZero && text.trim() === '')
  const confirm = (): void => {
    if (valid) onConfirm(cents)
  }
  return <Sheet
    visible={visible}
    title={title}
    onClose={onClose}
    dismissOnBackdrop
    footer={<Button size="lg" disabled={!valid} onClick={confirm} className="w-full">
      <Check size={20} strokeWidth={2.75} />
      Save
    </Button>}
  >
    {detail && <p className="-mt-2 text-[15px] text-muted-foreground">{detail}</p>}
    <div className="py-5">
      <AmountInput value={text} onChange={setText} onSubmit={confirm} color={color} size={48} label={title} />
    </div>
  </Sheet>
}
