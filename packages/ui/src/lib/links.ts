export type TextPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

/** A markdown link `[text](url)`, allowing one level of parentheses in the url, or a bare url. */
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)|https?:\/\/[^\s<>"]+/gi
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '\'', '"', '*', '_', '~', '`', ']'])

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

/** A sentence's closing punctuation, or a parenthesis the url never opened, is not part of it. */
function trimUrl(url: string): string {
  let end = url.length
  while (end > 0) {
    const kept = url.slice(0, end)
    const last = kept.charAt(end - 1)
    if (TRAILING.has(last) || (last === ')' && count(kept, '(') < count(kept, ')'))) end -= 1
    else break
  }
  return url.slice(0, end)
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== ''
  } catch {
    return false
  }
}

/** Splits text into plain runs and web links, so links render as elements and nothing becomes HTML. */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  const pushText = (value: string): void => {
    if (value === '') return
    const last = parts[parts.length - 1]
    if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + value }
    else parts.push({ type: 'text', text: value })
  }
  let cursor = 0
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0
    const [whole, label, target] = match
    const href = target ?? trimUrl(whole)
    if (!isWebUrl(href)) continue
    pushText(text.slice(cursor, start))
    parts.push({ type: 'link', text: label ?? href, href })
    cursor = start + (target === undefined ? href.length : whole.length)
  }
  pushText(text.slice(cursor))
  return parts
}
