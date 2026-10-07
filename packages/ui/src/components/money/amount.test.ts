import { describe, expect, it } from 'vitest'
import { amountExpression, cleanAmountText, isCalculation, typedAmountCents } from './amount'

describe('typed amounts', () => {
  it('reads a plain amount', () => {
    expect(typedAmountCents('12.50')).toBe(1250)
    expect(typedAmountCents('$1,234.56')).toBe(123456)
  })

  it('accepts the keypad symbols and their keyboard spellings', () => {
    expect(amountExpression('12 * 3')).toBe('12×3')
    expect(amountExpression('2x3')).toBe('2×3')
    expect(amountExpression('10/4')).toBe('10÷4')
    expect(typedAmountCents('12*3')).toBe(3600)
    expect(typedAmountCents('12×3')).toBe(3600)
    expect(typedAmountCents('10 + 2.5')).toBe(1250)
    expect(typedAmountCents('10/4')).toBe(250)
    expect(typedAmountCents('20 - 4 × 2')).toBe(1200)
  })

  it('rejects an unfinished sum or nothing at all', () => {
    expect(typedAmountCents('')).toBeNull()
    expect(typedAmountCents('5+')).toBeNull()
    expect(typedAmountCents('-5')).toBeNull()
    expect(typedAmountCents('5/0')).toBeNull()
  })

  it('drops letters that cannot be part of an amount', () => {
    expect(cleanAmountText('12a.5b0')).toBe('12.50')
    expect(cleanAmountText('3x4')).toBe('3x4')
  })

  it('tells a sum from a plain number', () => {
    expect(isCalculation('12.50')).toBe(false)
    expect(isCalculation('12+3')).toBe(true)
    expect(isCalculation('12 * 3')).toBe(true)
  })
})
