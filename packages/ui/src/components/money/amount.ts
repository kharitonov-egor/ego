import { evaluateAmount } from '@ego/local/amount-input'

const TYPED = /[^\d.+\-*/×÷xX,$\s]/g

/** Drops what an amount can never hold, so a stray letter does not land in the field. */
export function cleanAmountText(text: string): string {
  return text.replace(TYPED, '')
}

/** A typed amount in the phone keypad's terms: `*` and `x` multiply, `/` divides, and `$`, commas, and spaces go. */
export function amountExpression(text: string): string {
  return text.replace(/[\s,$]/g, '').replace(/[*xX]/g, '×').replace(/\//g, '÷')
}

export function typedAmountCents(text: string): number | null {
  return evaluateAmount(amountExpression(text))
}

/** True once the text is a sum rather than a plain number, so the field can show what it adds up to. */
export function isCalculation(text: string): boolean {
  return /\d\s*[+\-×÷]/.test(amountExpression(text))
}
