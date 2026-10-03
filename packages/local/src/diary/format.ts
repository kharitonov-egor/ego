/** The calendar day a message falls on, in the phone's time zone. */
export function dayKeyOf(iso: string): string {
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function dayLabel(dayKey: string, today: string, yesterday: string): string {
  if (dayKey === today) return 'Today'
  if (dayKey === yesterday) return 'Yesterday'
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const sameYear = dayKey.slice(0, 4) === today.slice(0, 4)
  return date.toLocaleDateString('en-US', sameYear ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' })
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function dateTimeLabel(iso: string): string {
  const date = new Date(iso)
  return `${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${timeLabel(iso)}`
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.round(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function sizeLabel(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function extensionLabel(fileName: string | null, mimeType: string): string {
  const dot = fileName?.lastIndexOf('.') ?? -1
  if (fileName && dot > 0 && fileName.length - dot <= 6) return fileName.slice(dot + 1).toUpperCase()
  const subtype = mimeType.split('/')[1] ?? ''
  return subtype.length > 0 && subtype.length <= 5 ? subtype.toUpperCase() : 'FILE'
}

/** Metering arrives in decibels, from about -60 for silence to 0 at the loudest. */
export function levelFromDecibels(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0
  return Math.round(Math.max(0, Math.min(1, (decibels + 60) / 60)) * 100)
}

/** Averages a recording's levels into a fixed number of bars. */
export function waveformBars(levels: readonly number[], count: number): number[] {
  if (levels.length === 0) return Array.from({ length: count }, () => 0)
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * levels.length) / count)
    const end = Math.max(start + 1, Math.floor(((index + 1) * levels.length) / count))
    const slice = levels.slice(start, end)
    return Math.round(slice.reduce((sum, level) => sum + level, 0) / slice.length)
  })
}
