import React, { useMemo, useState } from 'react'
import { diarySegments, type DiaryEntity, type DiarySegment } from '@ego/core'
import { cn } from '../../lib/utils'
import { ink } from './theme'

function hrefFor(link: NonNullable<DiarySegment['link']>): string | null {
  switch (link.kind) {
    case 'url': return /^https?:/i.test(link.value) ? link.value : null
    case 'mention': return `https://t.me/${link.value.replace(/^@/, '')}`
    case 'email': return `mailto:${link.value}`
    case 'phone': return `tel:${link.value.replace(/[^\d+]/g, '')}`
    case 'hashtag': return null
  }
}

function styleFor(segment: DiarySegment, revealed: boolean): { className: string; style: React.CSSProperties } {
  const lines: string[] = []
  const style: React.CSSProperties = {}
  if (segment.underline || segment.link?.kind === 'url' || segment.link?.kind === 'email' || segment.link?.kind === 'phone') lines.push('underline')
  if (segment.strikethrough) lines.push('line-through')
  if (lines.length > 0) style.textDecorationLine = lines.join(' ')
  if (segment.quote) style.color = ink.secondary
  if (segment.link?.kind === 'hashtag' || segment.link?.kind === 'mention') style.color = ink.meta
  const hidden = segment.spoiler && !revealed
  if (hidden) {
    style.color = 'transparent'
    style.backgroundColor = ink.faint
  }
  return {
    className: cn(segment.bold && 'font-bold', segment.italic && 'italic',
      segment.code && 'rounded bg-white/[0.08] font-mono text-[0.92em]', hidden && 'cursor-pointer select-none'),
    style
  }
}

/**
 * A message's text with Telegram's formatting. Links open in the browser, and a hashtag searches
 * the diary for itself.
 */
export function RichText({ text, entities, source, onHashtag, trailing }: {
  text: string
  entities: readonly DiaryEntity[]
  source: (mediaId: string) => string
  onHashtag: (tag: string) => void
  /** Reserves room for the time on the last line. */
  trailing?: React.ReactNode
}): React.ReactElement {
  const segments = useMemo(() => diarySegments(text, entities), [entities, text])
  const [revealed, setRevealed] = useState(false)
  return <p className="select-text whitespace-pre-wrap break-words text-[16px] leading-[22px]" style={{ color: ink.text }}>
    {segments.map((segment, index) => {
      if (segment.customEmojiId) {
        return <img key={index} src={source(segment.customEmojiId)} alt={segment.text} draggable={false} className="inline-block h-5 w-5 align-text-bottom" />
      }
      const { className, style } = styleFor(segment, revealed)
      const link = segment.link
      if (link?.kind === 'hashtag') {
        return <button key={index} type="button" onClick={() => onHashtag(link.value)} className={cn('inline hover:underline', className)} style={style}>
          {segment.text}
        </button>
      }
      const href = link ? hrefFor(link) : null
      if (href) {
        return <a key={index} href={href} onClick={(event) => {
          event.preventDefault()
          void window.api.openExternalUrl(href)
        }} className={cn('hover:opacity-80', className)} style={style}>{segment.text}</a>
      }
      if (segment.spoiler && !revealed) {
        return <span key={index} role="button" tabIndex={0} aria-label="Show the hidden text" onClick={() => setRevealed(true)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setRevealed(true) }}
          className={className} style={style}>{segment.text}</span>
      }
      return <span key={index} className={className} style={style}>{segment.text}</span>
    })}
    {trailing}
  </p>
}
