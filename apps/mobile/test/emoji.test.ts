import { describe, expect, it } from 'vitest'
import { emojiImage, emojiParts } from '../lib/emoji/parts'

const name = (emoji: string): string | undefined => emojiImage(emoji).split('/').pop()?.replace('.png', '')

describe('emoji parts', () => {
  it('leaves text without emoji alone', () => {
    expect(emojiParts('Gym 3x, then © notes')).toEqual([{ text: 'Gym 3x, then © notes', image: null }])
  })

  it('splits emoji out of the text around them', () => {
    expect(emojiParts('Vcs: toast 😭😭!').map((part) => [part.text, part.image !== null])).toEqual([
      ['Vcs: toast ', false],
      ['😭', true],
      ['😭', true],
      ['!', false]
    ])
  })

  it('keeps an old symbol as text unless it asks for emoji', () => {
    expect(emojiParts('❤').map((part) => part.image)).toEqual([null])
    expect(emojiParts('❤️').map((part) => part.image !== null)).toEqual([true])
  })

  it('draws a newer pictograph as emoji without a selector', () => {
    expect(emojiParts('\u{1F336}').map((part) => part.image?.split('/').pop())).toEqual(['1f336-fe0f.png'])
  })

  it('leaves a pictograph that is not an emoji as text', () => {
    expect(emojiParts('\u{1F0A1}').map((part) => part.image)).toEqual([null])
    expect(emojiParts('\u{1FA00}').map((part) => part.image)).toEqual([null])
  })

  it('keeps a sequence together', () => {
    expect(emojiParts('👨‍👩‍👧 🇺🇸 👍🏽').filter((part) => part.image).map((part) => part.text)).toEqual(['👨‍👩‍👧', '🇺🇸', '👍🏽'])
  })
})

describe('emoji images', () => {
  it('uses the fully qualified sequence', () => {
    expect(name('😀')).toBe('1f600')
    expect(name('✈️')).toBe('2708-fe0f')
    expect(name('👍🏽')).toBe('1f44d-1f3fd')
    expect(name('🇺🇸')).toBe('1f1fa-1f1f8')
    expect(name('🏳️‍🌈')).toBe('1f3f3-fe0f-200d-1f308')
    expect(name('🕵🏻‍♂️')).toBe('1f575-1f3fb-200d-2642-fe0f')
    expect(name('🏴󠁧󠁢󠁥󠁮󠁧󠁿')).toBe('1f3f4-e0067-e0062-e0065-e006e-e0067-e007f')
  })

  it('names an emoji newer than the Unicode tables in Hermes', () => {
    expect(name('\u{1FAE9}')).toBe('1fae9')
  })

  it('adds the selectors a keyboard left out', () => {
    expect(name('\u{1F575}\u200D\u2642')).toBe('1f575-fe0f-200d-2642-fe0f')
    expect(name('1\u20E3')).toBe('0031-fe0f-20e3')
    expect(name('1\uFE0F\u20E3')).toBe('0031-fe0f-20e3')
  })
})
