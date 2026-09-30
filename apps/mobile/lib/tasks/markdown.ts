/**
 * The Markdown a card description is written in, parsed into blocks the card screen draws with
 * plain Text views. It covers what Trello's editor makes: headings, bold, italic, strikethrough,
 * code, links, bullet, numbered and checkbox lists, quotes, code blocks, and rules. Lines break
 * where they break in the source, which is what a phone keyboard expects.
 */

export interface Span {
  text: string
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  link: string | null
}

export type Block =
  | { type: 'heading'; level: number; spans: Span[] }
  | { type: 'paragraph'; spans: Span[] }
  | { type: 'item'; ordered: boolean; number: number; depth: number; checked: boolean | null; spans: Span[]; line: number }
  | { type: 'quote'; spans: Span[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }

type Style = Omit<Span, 'text'>

const PLAIN: Style = { bold: false, italic: false, strike: false, code: false, link: null }

interface Found {
  index: number
  length: number
  spans: (style: Style) => Span[]
}

type Rule = (text: string) => Found | null

const TRAILING_PUNCTUATION = /[.,!?:;)\]}'"]+$/

function wrapped(pattern: RegExp, change: (style: Style) => Style): Rule {
  return (text) => {
    const match = pattern.exec(text)
    if (!match) return null
    return { index: match.index, length: match[0].length, spans: (style) => parseInline(match[1], change(style)) }
  }
}

const RULES: Rule[] = [
  (text) => {
    const match = /`([^`\n]+)`/.exec(text)
    return match ? { index: match.index, length: match[0].length, spans: (style) => [{ ...style, code: true, text: match[1] }] } : null
  },
  (text) => {
    const match = /\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text)
    return match ? { index: match.index, length: match[0].length, spans: (style) => parseInline(match[1], { ...style, link: match[2] }) } : null
  },
  wrapped(/\*\*([^\n]+?)\*\*/, (style) => ({ ...style, bold: true })),
  wrapped(/__([^\n]+?)__/, (style) => ({ ...style, bold: true })),
  wrapped(/~~([^\n]+?)~~/, (style) => ({ ...style, strike: true })),
  wrapped(/\*(?![\s*])([^\n*]+?)\*/, (style) => ({ ...style, italic: true })),
  wrapped(/(?<![A-Za-z0-9_])_(?![\s_])([^\n_]+?)_(?![A-Za-z0-9_])/, (style) => ({ ...style, italic: true })),
  (text) => {
    const match = /\bhttps?:\/\/[^\s<>]+/.exec(text)
    if (!match) return null
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    return { index: match.index, length: url.length, spans: (style) => [{ ...style, text: url, link: style.link ?? url }] }
  }
]

function merge(spans: Span[]): Span[] {
  const merged: Span[] = []
  for (const span of spans) {
    if (!span.text) continue
    const last = merged[merged.length - 1]
    if (last && last.bold === span.bold && last.italic === span.italic && last.strike === span.strike &&
      last.code === span.code && last.link === span.link) {
      last.text += span.text
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

export function parseInline(text: string, style: Style = PLAIN): Span[] {
  const spans: Span[] = []
  let rest = text
  while (rest.length > 0) {
    let best: Found | null = null
    for (const rule of RULES) {
      const found = rule(rest)
      if (found && (!best || found.index < best.index)) best = found
    }
    if (!best) {
      spans.push({ ...style, text: rest })
      break
    }
    if (best.index > 0) spans.push({ ...style, text: rest.slice(0, best.index) })
    spans.push(...best.spans(style))
    rest = rest.slice(best.index + best.length)
  }
  return merge(spans)
}

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE_LINE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/

function depthOf(indent: string): number {
  return Math.min(3, Math.floor(indent.replace(/\t/g, '  ').length / 2))
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let quote: string[] = []
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  const flushQuote = (): void => {
    if (quote.length > 0) blocks.push({ type: 'quote', spans: parseInline(quote.join('\n')) })
    quote = []
  }
  const flush = (): void => {
    flushParagraph()
    flushQuote()
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (FENCE.test(line)) {
      flush()
      const code: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const quoted = QUOTE.exec(line)
    if (quoted) {
      flushParagraph()
      quote.push(quoted[1])
      continue
    }
    const heading = HEADING.exec(line)
    const task = TASK.exec(line)
    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2]) })
    } else if (RULE_LINE.test(line)) {
      flush()
      blocks.push({ type: 'rule' })
    } else if (task) {
      flush()
      blocks.push({
        type: 'item', ordered: false, number: 0, depth: depthOf(task[1]), checked: task[2] !== ' ',
        spans: parseInline(task[3]), line: index
      })
    } else if (bullet) {
      flush()
      blocks.push({ type: 'item', ordered: false, number: 0, depth: depthOf(bullet[1]), checked: null, spans: parseInline(bullet[2]), line: index })
    } else if (ordered) {
      flush()
      blocks.push({
        type: 'item', ordered: true, number: Number(ordered[2]), depth: depthOf(ordered[1]), checked: null,
        spans: parseInline(ordered[3]), line: index
      })
    } else {
      flushQuote()
      paragraph.push(line)
    }
  }
  flush()
  return blocks
}

/** Ticks or unticks the checkbox on one source line, so a tap on the rendered box edits the Markdown. */
export function toggleTaskLine(source: string, line: number): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const match = TASK.exec(lines[line] ?? '')
  if (!match) return source
  lines[line] = lines[line].replace(/\[([ xX])\]/, match[2] === ' ' ? '[x]' : '[ ]')
  return lines.join('\n')
}

export interface Selection {
  start: number
  end: number
}

export interface Edit {
  text: string
  selection: Selection
}

/** Puts a marker on both sides of the selection, or takes it off when it is already there. */
export function wrapSelection(text: string, selection: Selection, marker: string): Edit {
  const { start, end } = selection
  const before = text.slice(0, start)
  const inside = text.slice(start, end)
  const after = text.slice(end)
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: `${before.slice(0, -marker.length)}${inside}${after.slice(marker.length)}`,
      selection: { start: start - marker.length, end: end - marker.length }
    }
  }
  return {
    text: `${before}${marker}${inside}${marker}${after}`,
    selection: { start: start + marker.length, end: end + marker.length }
  }
}

/** Starts every selected line with a prefix like "- " or "1. ", or removes it when all have it. */
export function prefixLines(text: string, selection: Selection, prefix: (index: number) => string): Edit {
  const lineStart = text.lastIndexOf('\n', selection.start - 1) + 1
  const nextBreak = text.indexOf('\n', selection.end)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak
  const lines = text.slice(lineStart, lineEnd).split('\n')
  const prefixes = lines.map((_, index) => prefix(index))
  const all = lines.every((line, index) => line.startsWith(prefixes[index]))
  const block = lines.map((line, index) => all ? line.slice(prefixes[index].length) : `${prefixes[index]}${line}`).join('\n')
  const delta = block.length - (lineEnd - lineStart)
  const first = all ? -prefixes[0].length : prefixes[0].length
  return {
    text: `${text.slice(0, lineStart)}${block}${text.slice(lineEnd)}`,
    selection: { start: Math.max(lineStart, selection.start + first), end: Math.max(lineStart, selection.end + delta) }
  }
}

/** Wraps the selection as a link, or inserts one with the cursor where the address goes. */
export function insertLink(text: string, selection: Selection): Edit {
  const label = text.slice(selection.start, selection.end) || 'link'
  const inserted = `[${label}](https://)`
  const cursor = selection.start + label.length + 3 + 'https://'.length
  return {
    text: `${text.slice(0, selection.start)}${inserted}${text.slice(selection.end)}`,
    selection: { start: cursor, end: cursor }
  }
}
