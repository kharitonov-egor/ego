import React, { useMemo, useState } from 'react'
import { Image, Linking, Text, type TextStyle } from 'react-native'
import { diarySegments, type DiaryEntity, type DiarySegment } from '@ego/core'
import type { DiaryMediaApi } from '../../lib/api-client'
import { mediaSource } from '../../lib/diary/media'
import { outsideApp } from '../../lib/private-lock'
import { ink } from './theme'

function hrefFor(link: NonNullable<DiarySegment['link']>): string | null {
  switch (link.kind) {
    case 'url': return link.value
    case 'mention': return `https://t.me/${link.value.replace(/^@/, '')}`
    case 'email': return `mailto:${link.value}`
    case 'phone': return `tel:${link.value.replace(/[^\d+]/g, '')}`
    case 'hashtag': return null
  }
}

function styleFor(segment: DiarySegment, revealed: boolean): TextStyle {
  const style: TextStyle = {}
  const lines: string[] = []
  if (segment.bold) style.fontWeight = '700'
  if (segment.italic) style.fontStyle = 'italic'
  if (segment.underline || segment.link?.kind === 'url' || segment.link?.kind === 'email' || segment.link?.kind === 'phone') lines.push('underline')
  if (segment.strikethrough) lines.push('line-through')
  if (lines.length > 0) style.textDecorationLine = lines.join(' ') as TextStyle['textDecorationLine']
  if (segment.code) {
    style.fontFamily = 'monospace'
    style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
  }
  if (segment.quote) style.color = ink.secondary
  if (segment.link?.kind === 'hashtag' || segment.link?.kind === 'mention') style.color = ink.meta
  if (segment.spoiler && !revealed) {
    style.color = 'transparent'
    style.backgroundColor = ink.faint
  }
  return style
}

/**
 * A message's text with Telegram's formatting. Links open outside the app without locking the
 * diary behind the user, and a hashtag searches the diary for itself.
 */
export function RichText({ text, entities, api, localFiles, onHashtag, style, trailing }: {
  text: string
  entities: readonly DiaryEntity[]
  api: DiaryMediaApi
  localFiles: ReadonlyMap<string, string>
  onHashtag: (tag: string) => void
  style?: TextStyle
  /** Blank spacing that reserves room for the time on the last line. */
  trailing?: string
}): React.ReactElement {
  const segments = useMemo(() => diarySegments(text, entities), [entities, text])
  const [revealed, setRevealed] = useState(false)
  return <Text selectable={false} style={[{ color: ink.text, fontSize: 16, lineHeight: 22 }, style]}>
    {segments.map((segment, index) => {
      if (segment.customEmojiId) {
        const source = mediaSource(api, localFiles, segment.customEmojiId)
        return <Image key={index} source={{ uri: source.uri, headers: source.headers }} style={{ width: 20, height: 20 }} accessibilityLabel={segment.text} />
      }
      const link = segment.link
      const onPress = link
        ? () => {
          if (link.kind === 'hashtag') {
            onHashtag(link.value)
            return
          }
          const href = hrefFor(link)
          if (href) void outsideApp(() => Linking.openURL(href)).catch(() => undefined)
        }
        : segment.spoiler && !revealed ? () => setRevealed(true) : undefined
      return <Text key={index} style={styleFor(segment, revealed)} onPress={onPress} suppressHighlighting>{segment.text}</Text>
    })}
    {trailing ? <Text style={{ color: 'transparent', fontSize: 12 }}>{trailing}</Text> : null}
  </Text>
}
