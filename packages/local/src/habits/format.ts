import { splitDuration } from './stats'

export function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function unit(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`
}

/** "30 d 02 h 11 m", shortened while the run is under a day or a minute. */
export function runLabel(milliseconds: number): string {
  const { days, hours, minutes, seconds } = splitDuration(milliseconds)
  if (days > 0) return `${days} d ${twoDigits(hours)} h ${twoDigits(minutes)} m`
  if (hours > 0) return `${hours} h ${twoDigits(minutes)} m`
  if (minutes > 0) return `${minutes} m ${twoDigits(seconds)} s`
  return `${seconds} s`
}

export function runSpoken(milliseconds: number): string {
  const { days, hours, minutes } = splitDuration(milliseconds)
  if (days > 0) return `${unit(days, 'day')}, ${unit(hours, 'hour')}, ${unit(minutes, 'minute')}`
  if (hours > 0) return `${unit(hours, 'hour')}, ${unit(minutes, 'minute')}`
  return unit(minutes, 'minute')
}

/** "Sep 25, 11:02 PM", with the year only when it is not this one. */
export function momentLabel(milliseconds: number): string {
  const moment = new Date(milliseconds)
  const sameYear = moment.getFullYear() === new Date().getFullYear()
  const day = moment.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${day}, ${moment.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}
