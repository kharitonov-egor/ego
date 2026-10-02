export const AMOUNT_OPERATORS = ['+', '-', '×', '÷'] as const

export type AmountOperator = (typeof AMOUNT_OPERATORS)[number]

const MAX_WHOLE_DIGITS = 9
const MAX_FRACTION_DIGITS = 2

function isOperator(char: string): char is AmountOperator {
  return (AMOUNT_OPERATORS as readonly string[]).includes(char)
}

function trailingNumber(expression: string): string {
  let index = expression.length
  while (index > 0 && !isOperator(expression[index - 1])) index -= 1
  return expression.slice(index)
}

function tokenize(expression: string): (number | AmountOperator)[] | null {
  const tokens: (number | AmountOperator)[] = []
  let current = ''
  for (const char of expression) {
    if (!isOperator(char)) { current += char; continue }
    if (!current) return null
    tokens.push(Number(current), char)
    current = ''
  }
  if (!current) return null
  tokens.push(Number(current))
  return tokens.every((token) => typeof token === 'string' || Number.isFinite(token)) ? tokens : null
}

export function evaluateAmount(expression: string): number | null {
  const tokens = tokenize(expression)
  if (!tokens) return null
  const folded: (number | AmountOperator)[] = []
  for (const token of tokens) {
    const operator = folded[folded.length - 1]
    const left = folded[folded.length - 2]
    if (typeof token === 'number' && typeof left === 'number' && (operator === '×' || operator === '÷')) {
      if (operator === '÷' && token === 0) return null
      folded.splice(folded.length - 2, 2, operator === '×' ? left * token : left / token)
      continue
    }
    folded.push(token)
  }
  let total = folded[0]
  if (typeof total !== 'number') return null
  for (let index = 1; index < folded.length; index += 2) {
    const value = folded[index + 1]
    if (typeof value !== 'number') return null
    total = folded[index] === '-' ? total - value : total + value
  }
  const cents = Math.round(Number((total * 100).toFixed(6)))
  return Number.isFinite(cents) ? cents : null
}

export function pressAmountKey(expression: string, key: string): string {
  if (key === 'clear') return ''
  if (key === 'back') return expression.slice(0, -1)
  if (key === '=') {
    const cents = evaluateAmount(expression)
    if (cents === null) return expression
    return cents <= 0 ? '' : String(cents / 100)
  }
  if (isOperator(key)) {
    const trimmed = expression.replace(/[+\-×÷.]+$/, '')
    return trimmed ? trimmed + key : ''
  }
  const current = trailingNumber(expression)
  const [whole, fraction] = current.split('.')
  if (key === '.') {
    if (fraction !== undefined) return expression
    return current ? `${expression}.` : `${expression}0.`
  }
  if (fraction !== undefined) return fraction.length >= MAX_FRACTION_DIGITS ? expression : expression + key
  if (whole.length >= MAX_WHOLE_DIGITS) return expression
  if (whole === '0') return expression.slice(0, -1) + key
  return expression + key
}

export function formatAmountExpression(expression: string): string {
  if (!expression) return '0'
  return expression
    .replace(/\d+(\.\d*)?/g, (match) => {
      const [whole, fraction] = match.split('.')
      const grouped = Number(whole).toLocaleString('en-US')
      return fraction === undefined ? grouped : `${grouped}.${fraction}`
    })
    .replace(/[+\-×÷]/g, (operator) => ` ${operator} `)
}

export function amountToExpression(cents: number): string {
  return cents ? String(cents / 100) : ''
}
