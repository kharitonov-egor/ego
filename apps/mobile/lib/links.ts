export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)|https?:\/\/[^\s<>"]+/g
const TRAILING = /[.,;:!?'"*_~]$/

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

/** Drops the punctuation that ends a sentence, and a closing bracket the URL never opened. */
function trimUrl(url: string): string {
  let end = url
  for (;;) {
    if (TRAILING.test(end)) end = end.slice(0, -1)
    else if (end.endsWith(')') && count(end, ')') > count(end, '(')) end = end.slice(0, -1)
    else if (end.endsWith(']') && count(end, ']') > count(end, '[')) end = end.slice(0, -1)
    else return end
  }
}

/** Splits text into plain runs and http(s) links, from bare URLs and markdown `[text](url)`. */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  const pushText = (value: string): void => {
    if (!value) return
    const last = parts[parts.length - 1]
    if (last?.kind === 'text') last.text += value
    else parts.push({ kind: 'text', text: value })
  }
  let cursor = 0
  for (const match of text.matchAll(LINK)) {
    const start = match.index
    const [whole, label, target] = match
    if (target !== undefined && label !== undefined) {
      pushText(text.slice(cursor, start))
      parts.push({ kind: 'link', text: label.trim() || target, url: target })
      cursor = start + whole.length
      continue
    }
    const url = trimUrl(whole)
    if (!/^https?:\/\/[^/?#\s]+/.test(url)) continue
    pushText(text.slice(cursor, start))
    parts.push({ kind: 'link', text: url, url })
    cursor = start + url.length
  }
  pushText(text.slice(cursor))
  return parts
}
