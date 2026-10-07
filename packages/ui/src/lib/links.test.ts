import { describe, expect, it } from 'vitest'
import { linkParts } from './links'

describe('links in chat replies', () => {
  it('leaves text without links alone', () => {
    expect(linkParts('')).toEqual([])
    expect(linkParts('No links here.\nJust two lines.')).toEqual([{ type: 'text', text: 'No links here.\nJust two lines.' }])
  })

  it('finds a bare url and leaves the sentence punctuation outside it', () => {
    expect(linkParts('Open https://connect.composio.dev/link/lk_123. Then come back.')).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'link', text: 'https://connect.composio.dev/link/lk_123', href: 'https://connect.composio.dev/link/lk_123' },
      { type: 'text', text: '. Then come back.' }
    ])
    expect(linkParts('Is it http://example.com/a?b=1, or not?')[1]).toEqual({ type: 'link', text: 'http://example.com/a?b=1', href: 'http://example.com/a?b=1' })
  })

  it('shows a markdown link by its text', () => {
    expect(linkParts('[Connect Gmail](https://connect.composio.dev/link/abc) to go on')).toEqual([
      { type: 'link', text: 'Connect Gmail', href: 'https://connect.composio.dev/link/abc' },
      { type: 'text', text: ' to go on' }
    ])
  })

  it('keeps parentheses that belong to the url', () => {
    expect(linkParts('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { type: 'text', text: '(see ' },
      { type: 'link', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { type: 'text', text: ')' }
    ])
    expect(linkParts('[Foo](https://en.wikipedia.org/wiki/Foo_(bar)).')).toEqual([
      { type: 'link', text: 'Foo', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { type: 'text', text: '.' }
    ])
  })

  it('finds several links and keeps the formatting marks around them as text', () => {
    expect(linkParts('**https://a.com** and [B](https://b.com/x)')).toEqual([
      { type: 'text', text: '**' },
      { type: 'link', text: 'https://a.com', href: 'https://a.com' },
      { type: 'text', text: '** and ' },
      { type: 'link', text: 'B', href: 'https://b.com/x' }
    ])
  })

  it('links only web addresses and never reads text as HTML', () => {
    expect(linkParts('[click](javascript:alert(1))')).toEqual([{ type: 'text', text: '[click](javascript:alert(1))' }])
    expect(linkParts('ftp://files.example.com and https://')).toEqual([{ type: 'text', text: 'ftp://files.example.com and https://' }])
    expect(linkParts('<b>hi</b> <a href="https://x.com">x</a>')).toEqual([
      { type: 'text', text: '<b>hi</b> <a href="' },
      { type: 'link', text: 'https://x.com', href: 'https://x.com' },
      { type: 'text', text: '">x</a>' }
    ])
  })
})
