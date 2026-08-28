const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export { WEEKDAYS }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

export function isoToday(): string {
  const now = new Date()
  return isoFromParts(now.getFullYear(), now.getMonth(), now.getDate())
}

export function shiftIso(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return isoFromParts(date.getFullYear(), date.getMonth(), date.getDate())
}

export function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function formatIso(iso: string, style: 'short' | 'long' = 'short'): string {
  return parseIso(iso).toLocaleDateString('en-US', style === 'long'
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export function relativeDayLabel(iso: string): string {
  const today = isoToday()
  if (iso === today) return `Today, ${formatIso(iso)}`
  if (iso === shiftIso(today, -1)) return `Yesterday, ${formatIso(iso)}`
  if (iso === shiftIso(today, 1)) return `Tomorrow, ${formatIso(iso)}`
  return formatIso(iso)
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  const date = new Date(year, index - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(month: string, style: 'long' | 'short' = 'long'): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(year, index - 1, 1).toLocaleDateString('en-US', {
    month: style === 'long' ? 'long' : 'short', year: 'numeric'
  })
}

export function monthGrid(year: number, month: number): (number | null)[][] {
  const leading = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1)
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}
