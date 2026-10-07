import { describe, expect, it } from 'vitest'
import type { DiaryAttachment } from '@ego/core'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { buildRows, buildViewerItems, subtitle, tagCounts } from './chat'

function attachment(kind: DiaryAttachment['kind'], mediaId: string | null, previewId: string | null = null): DiaryAttachment {
  return {
    mediaId, kind, mimeType: 'image/jpeg', fileName: null, size: null, width: null, height: null, durationSeconds: null,
    title: null, performer: null, emoji: null, previewId, waveform: null
  }
}

function message(id: string, sentAt: string, text: string, extra: Partial<LocalDiaryMessage> = {}): LocalDiaryMessage {
  return {
    id, sentAt, text, entities: [], attachments: [], replyToId: null, forwarded: false, forwardedFrom: null, pinnedAt: null,
    editedAt: null, source: 'app', createdAt: sentAt, updatedAt: sentAt, revision: 1, delivery: 'sent',
    searchText: text.toLowerCase(), ...extra
  }
}

const local = (day: number, hour: number): string => new Date(2026, 9, day, hour).toISOString()

describe('the diary chat', () => {
  it('reads oldest first with a separator before each day', () => {
    const rows = buildRows([
      message('a', local(1, 9), 'one'),
      message('b', local(1, 18), 'two'),
      message('c', local(2, 8), 'three')
    ], new Date(2026, 9, 2, 12))
    expect(rows.map((row) => row.kind === 'day' ? row.label : row.message.id)).toEqual(['Yesterday', 'a', 'b', 'Today', 'c'])
  })

  it('pages through every photo, video, and GIF, skipping files and media that never arrived', () => {
    const items = buildViewerItems([
      message('a', local(1, 9), 'Album', { attachments: [attachment('photo', 'p1'), attachment('video', 'v1', 'poster')] }),
      message('b', local(1, 10), '', { attachments: [attachment('file', 'f1'), attachment('photo', null)] }),
      message('c', local(1, 11), '', { attachments: [attachment('animation', 'g1'), attachment('video', null, 'only-poster')] })
    ])
    expect(items.map((item) => item.key)).toEqual(['a-0', 'a-1', 'c-0', 'c-1'])
    expect(items[0]?.caption).toBe('Album')
  })

  it('lists hashtags by use, then by name', () => {
    const tags = tagCounts([
      message('a', local(1, 9), 'Run #running #Morning'),
      message('b', local(1, 10), 'Again #running'),
      message('c', local(1, 11), '#cooking soup #morning')
    ])
    expect(tags).toEqual([{ tag: '#morning', count: 2 }, { tag: '#running', count: 2 }, { tag: '#cooking', count: 1 }])
  })

  it('says what is still sending, and what failed first', () => {
    expect(subtitle([message('a', local(1, 9), 'x')])).toBe('1 message')
    expect(subtitle([message('a', local(1, 9), 'x', { delivery: 'sending' }), message('b', local(1, 9), 'y')])).toBe('Sending 1 message')
    expect(subtitle([
      message('a', local(1, 9), 'x', { delivery: 'sending' }),
      message('b', local(1, 9), 'y', { delivery: 'failed' }),
      message('c', local(1, 9), 'z', { delivery: 'failed' })
    ])).toBe('2 messages did not send')
  })
})
