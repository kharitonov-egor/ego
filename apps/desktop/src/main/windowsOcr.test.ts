import { describe, expect, it } from 'vitest'
import { lineScore, mergeOcrPasses, parsePasses, type OcrPass } from './windowsOcr'

function pass(language: string, texts: string[]): OcrPass {
  return { language, lines: texts.map((text, index) => ({ text, left: 20, top: 20 + index * 30, right: 500, bottom: 40 + index * 30 })) }
}

describe('mergeOcrPasses', () => {
  it('keeps the English engine for English lines and the Russian engine for Russian ones', () => {
    const english = pass('en-US', [
      'Anna: Did you get the tickets?',
      'Erop: La, Kynm ABa 6\'-1neTa Ha cy660Ty.',
      'Show banners when Ego is in the background',
      'Play a sound for reminders',
      'Bcrpeua nepeHeceHa Ha ueTBepr, 23 OKT96pg, B 14:30.'
    ])
    const russian = pass('ru', [
      'Аппа: Did уои get the tickets?',
      'Егор: Да, купил два билета на субботу.',
      'Show banners when Едо is in the bac@round',
      'Дау а sound for reminders',
      'Встреча перенесена на четверг, 23 октября, в 14:30.'
    ])
    expect(mergeOcrPasses([english, russian]).split('\n')).toEqual([
      'Anna: Did you get the tickets?',
      'Егор: Да, купил два билета на субботу.',
      'Show banners when Ego is in the background',
      'Play a sound for reminders',
      'Встреча перенесена на четверг, 23 октября, в 14:30.'
    ])
  })

  it('keeps a line only one engine found, in reading order', () => {
    const english = pass('en-US', ['First line'])
    const russian: OcrPass = { language: 'ru', lines: [{ text: 'Вторая строка', left: 20, top: 200, right: 300, bottom: 220 }] }
    expect(mergeOcrPasses([russian, english])).toBe('First line\nВторая строка')
  })
})

describe('lineScore', () => {
  it('marks words broken by digits, symbols, or a capital inside', () => {
    expect(lineScore('Fixed a crash when opening large PDF tiles on Windows IO.'))
      .toBeGreaterThan(lineScore('Fixed е сгг* when среп1гд Вгде PDF fNes сг VV1ntows -10.'))
    expect(lineScore('Contact support@example.com or call (813) 555-0142.'))
      .toBeGreaterThan(lineScore('Contect suppckenmple.com от cell +1 (813) 555-0142.'))
  })
})

describe('parsePasses', () => {
  it('accepts the bare object PowerShell writes for a single pass or line', () => {
    expect(parsePasses('{"language":"ru","lines":{"text":"Привет","left":1,"top":2,"right":3,"bottom":4}}')).toEqual([
      { language: 'ru', lines: [{ text: 'Привет', left: 1, top: 2, right: 3, bottom: 4 }] }
    ])
    expect(parsePasses('not json')).toEqual([])
  })
})
