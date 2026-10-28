const IMAGES = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/'

const EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Emoji_Modifier}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu
const MAYBE_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u20E3]/u
const PRESENTATION = /\p{Emoji_Presentation}/u
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const MODIFIER = /\p{Emoji_Modifier}/u
const ANY_EMOJI = /\p{Emoji}/u
const UNASSIGNED = /\p{Cn}/u

export interface TextPart {
  text: string
  /** Apple's picture of the emoji, or null for plain text. */
  image: string | null
}

/** Hermes ships Unicode 15.1 tables, so emoji added since look unassigned to it. From U+1F7E0 up, every emoji is emoji by default. */
function emojiByDefault(char: string): boolean {
  return PRESENTATION.test(char) || ((char.codePointAt(0) ?? 0) >= 0x1F7E0 && UNASSIGNED.test(char))
}

/** The CDN names each picture after the fully qualified sequence, so FE0F goes back wherever Unicode puts it. */
export function emojiImage(emoji: string): string {
  const points = [...emoji].filter((char) => char !== '\uFE0F')
  const names = points.flatMap((char, index) => {
    const next = points[index + 1] ?? ''
    const name = (char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')
    const textByDefault = (PICTOGRAPHIC.test(char) || next === '\u20E3') && !emojiByDefault(char)
    return textByDefault && !MODIFIER.test(next) ? [name, 'fe0f'] : [name]
  })
  return `${IMAGES}${names.join('-')}.png`
}

/** Android draws a lone © or ❤ as text unless a selector asks for emoji, but draws any emoji outside the BMP as emoji. */
function staysText(emoji: string): boolean {
  if ([...emoji].length > 1 || emojiByDefault(emoji)) return false
  return emoji.length === 1 || !ANY_EMOJI.test(emoji)
}

/** Splits text into plain runs and emoji. */
export function emojiParts(text: string): TextPart[] {
  if (!MAYBE_EMOJI.test(text)) return [{ text, image: null }]
  const parts: TextPart[] = []
  let start = 0
  for (const match of text.matchAll(EMOJI)) {
    const emoji = match[0]
    if (staysText(emoji)) continue
    if (match.index > start) parts.push({ text: text.slice(start, match.index), image: null })
    parts.push({ text: emoji, image: emojiImage(emoji) })
    start = match.index + emoji.length
  }
  if (start < text.length) parts.push({ text: text.slice(start), image: null })
  return parts
}
