import { describe, expect, it } from 'vitest'
import { amountToExpression, evaluateAmount, formatAmountExpression, pressAmountKey } from '../lib/amount-input'

function type(keys: string): string {
  return keys.split(' ').reduce((expression, key) => pressAmountKey(expression, key), '')
}

describe('keypad input', () => {
  it('builds a decimal amount', () => {
    expect(type('1 2 . 5 0')).toBe('12.50')
  })

  it('stops at two decimals', () => {
    expect(type('1 . 2 3 4')).toBe('1.23')
  })

  it('starts a decimal with a leading zero', () => {
    expect(type('. 9 9')).toBe('0.99')
  })

  it('drops the placeholder zero once a digit arrives', () => {
    expect(type('0 5')).toBe('5')
  })

  it('caps the whole part at nine digits', () => {
    expect(type('1 2 3 4 5 6 7 8 9 9')).toBe('123456789')
  })

  it('replaces a trailing operator instead of stacking them', () => {
    expect(type('5 + -')).toBe('5-')
  })

  it('ignores an operator as the first key', () => {
    expect(type('+')).toBe('')
  })

  it('deletes the last character', () => {
    expect(type('1 2 back')).toBe('1')
  })

  it('clears everything', () => {
    expect(type('1 2 clear')).toBe('')
  })

  it('folds the expression on equals', () => {
    expect(type('2 + 3 =')).toBe('5')
  })

  it('clears when the result is not positive', () => {
    expect(type('3 - 5 =')).toBe('')
  })
})

describe('evaluation', () => {
  it.each([
    ['12.50', 1250],
    ['2+3', 500],
    ['10-2.5', 750],
    ['3×1.5', 450],
    ['10÷4', 250],
    ['2+3×4', 1400],
    ['1.005', 101]
  ])('evaluates %s', (expression, cents) => {
    expect(evaluateAmount(expression)).toBe(cents)
  })

  it.each(['', '5+', '÷2', '5÷0'])('rejects %s', (expression) => {
    expect(evaluateAmount(expression)).toBeNull()
  })
})

describe('display', () => {
  it('shows a zero for an empty expression', () => {
    expect(formatAmountExpression('')).toBe('0')
  })

  it('groups thousands and keeps the typed fraction', () => {
    expect(formatAmountExpression('1234567.5')).toBe('1,234,567.5')
  })

  it('keeps a trailing separator visible', () => {
    expect(formatAmountExpression('12.')).toBe('12.')
  })

  it('spaces the operators out', () => {
    expect(formatAmountExpression('2+3')).toBe('2 + 3')
  })
})

describe('editing an existing amount', () => {
  it('seeds the expression from cents', () => {
    expect(amountToExpression(3300000)).toBe('33000')
    expect(amountToExpression(1999)).toBe('19.99')
    expect(amountToExpression(0)).toBe('')
  })
})
