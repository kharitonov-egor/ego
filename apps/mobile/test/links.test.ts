import { describe, expect, it } from 'vitest'
import { linkParts } from '../lib/links'

describe('links in chat replies', () => {
  it('keeps text without links as one part', () => {
    expect(linkParts('No links here.')).toEqual([{ kind: 'text', text: 'No links here.' }])
    expect(linkParts('')).toEqual([])
  })

  it('finds markdown links', () => {
    expect(linkParts('Gmail is not connected. [Connect Gmail](https://connect.composio.dev/link/lk_123) and ask again.')).toEqual([
      { kind: 'text', text: 'Gmail is not connected. ' },
      { kind: 'link', text: 'Connect Gmail', url: 'https://connect.composio.dev/link/lk_123' },
      { kind: 'text', text: ' and ask again.' }
    ])
  })

  it('finds bare URLs and leaves the sentence punctuation out', () => {
    expect(linkParts('Open https://example.com/a?b=1. Then come back')).toEqual([
      { kind: 'text', text: 'Open ' },
      { kind: 'link', text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
      { kind: 'text', text: '. Then come back' }
    ])
    expect(linkParts('(see https://example.com/x)')).toEqual([
      { kind: 'text', text: '(see ' },
      { kind: 'link', text: 'https://example.com/x', url: 'https://example.com/x' },
      { kind: 'text', text: ')' }
    ])
  })

  it('keeps parentheses that belong to the URL', () => {
    const url = 'https://en.wikipedia.org/wiki/Mercury_(planet)'
    expect(linkParts(`Read ${url}`)).toEqual([{ kind: 'text', text: 'Read ' }, { kind: 'link', text: url, url }])
    expect(linkParts(`[Mercury](${url})`)).toEqual([{ kind: 'link', text: 'Mercury', url }])
  })

  it('handles several links on several lines', () => {
    expect(linkParts('One: https://a.dev\nTwo: [b](http://b.dev/path)')).toEqual([
      { kind: 'text', text: 'One: ' },
      { kind: 'link', text: 'https://a.dev', url: 'https://a.dev' },
      { kind: 'text', text: '\nTwo: ' },
      { kind: 'link', text: 'b', url: 'http://b.dev/path' }
    ])
  })

  it('leaves other schemes and broken markdown as text', () => {
    expect(linkParts('[call](tel:123) or [x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[call](tel:123) or [x](javascript:alert(1))' }
    ])
    expect(linkParts('[half](https://a.dev')).toEqual([
      { kind: 'text', text: '[half](' },
      { kind: 'link', text: 'https://a.dev', url: 'https://a.dev' }
    ])
    expect(linkParts('just https:// here')).toEqual([{ kind: 'text', text: 'just https:// here' }])
  })
})
