export type CanvasDue = { kind: 'time'; at: string } | { kind: 'day'; date: string }

export interface CanvasItem {
  /** The event UID, stable across fetches, so a done mark can point at it. */
  id: string
  title: string
  course: string | null
  due: CanvasDue
  url: string | null
  description: string
}

interface Property {
  name: string
  params: Record<string, string>
  value: string
}

const MAX_DESCRIPTION_LENGTH = 4000
const COURSE_SUFFIX = /\s*\[([^\]]+)\]\s*$/
const SECTION_CODE = /^([A-Z]{2,4}\s?\d{3,4}[A-Z]?)\.\S+$/
const OVERRIDE_SUFFIX = /\s*\(\d+ students?\)$/
const CALENDAR_LINK = /^(https:\/\/[^/?#]+)\/calendar\?[^#]*\binclude_contexts=course_(\d+)[^#]*#assignment_(\d+)$/

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseProperty(line: string): Property | null {
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') quoted = !quoted
    else if (character === ':' && !quoted) {
      const [name, ...rawParams] = line.slice(0, index).split(';')
      const params: Record<string, string> = {}
      for (const raw of rawParams) {
        const equals = raw.indexOf('=')
        if (equals > 0) params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1).replace(/^"|"$/g, '')
      }
      return { name: name.toUpperCase(), params, value: line.slice(index + 1) }
    }
  }
  return null
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, character: string) => character === 'n' || character === 'N' ? '\n' : character)
}

function tidyDescription(value: string): string {
  const text = unescapeText(value)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}...` : text
}

/**
 * Canvas writes deadlines in UTC and all-day items as bare dates. A local or TZID time would need a
 * time zone database to place exactly, so it keeps only its written date.
 */
function parseDue(property: Property): CanvasDue | null {
  const value = property.value.trim()
  const parts = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value)
  if (!parts) return null
  const [, year, month, day, hour, minute, second, utc] = parts
  const date = `${year}-${month}-${day}`
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null
  if (property.params.VALUE === 'DATE' || hour === undefined || utc !== 'Z') return { kind: 'day', date }
  const at = new Date(`${date}T${hour}:${minute}:${second}Z`)
  return Number.isNaN(at.getTime()) ? null : { kind: 'time', at: at.toISOString() }
}

/** "COT4400.001F26" reads as "COT4400"; a name in some other shape stays whole. */
export function canvasCourseCode(raw: string): string {
  const trimmed = raw.trim()
  return SECTION_CODE.exec(trimmed)?.[1] ?? trimmed
}

/** The feed links to a calendar page; the assignment page is one tap closer to submitting. */
export function canvasAssignmentUrl(url: string): string {
  const match = CALENDAR_LINK.exec(url)
  return match ? `${match[1]}/courses/${match[2]}/assignments/${match[3]}` : url
}

function splitSummary(summary: string): { title: string; course: string | null } {
  const match = COURSE_SUFFIX.exec(summary)
  const title = (match ? summary.slice(0, match.index) : summary).replace(OVERRIDE_SUFFIX, '').trim()
  return { title: title || 'Untitled', course: match ? canvasCourseCode(match[1]) : null }
}

function toItem(properties: Property[]): CanvasItem | null {
  const first = (name: string): Property | undefined => properties.find((property) => property.name === name)
  const id = first('UID')?.value.trim()
  const start = first('DTSTART')
  if (!id || !start) return null
  if (first('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return null
  const due = parseDue(start)
  if (!due) return null
  const { title, course } = splitSummary(unescapeText(first('SUMMARY')?.value ?? ''))
  const url = first('URL')?.value.trim()
  return {
    id,
    title,
    course,
    due,
    url: url && /^https:\/\//.test(url) ? canvasAssignmentUrl(url) : null,
    description: tidyDescription(first('DESCRIPTION')?.value ?? '')
  }
}

export function isCalendarText(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text)
}

/**
 * Reads a Canvas calendar feed. A later event with the same UID replaces an earlier one. Properties
 * of a nested component such as VALARM stay out of the event they sit in.
 */
export function parseCanvasCalendar(text: string): CanvasItem[] {
  const items = new Map<string, CanvasItem>()
  let event: Property[] | null = null
  let nested = 0
  for (const line of unfold(text)) {
    const marker = line.trim().toUpperCase()
    if (marker === 'BEGIN:VEVENT') {
      event = []
      nested = 0
      continue
    }
    if (marker === 'END:VEVENT') {
      const item = event ? toItem(event) : null
      if (item) items.set(item.id, item)
      event = null
      continue
    }
    if (!event) continue
    if (marker.startsWith('BEGIN:')) nested += 1
    else if (marker.startsWith('END:')) nested = Math.max(0, nested - 1)
    else if (nested === 0) {
      const property = parseProperty(line)
      if (property) event.push(property)
    }
  }
  return [...items.values()]
}
