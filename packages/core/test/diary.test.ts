import { describe, expect, it } from 'vitest'
import {
  detectDiaryLinks, diaryHashtags, diaryMediaIds, diaryPreviewText, diarySearchText, diarySegments,
  isDiaryMessageInput, matchesDiaryQuery, rebaseEntities, type DiaryAttachment, type DiaryMessageInput
} from '../src/diary'
import { planTelegramImport } from '../src/telegram-export'

const attachment = (overrides: Partial<DiaryAttachment> = {}): DiaryAttachment => ({
  mediaId: 'm-1', kind: 'photo', mimeType: 'image/jpeg', fileName: null, size: 1200, width: 800, height: 600,
  durationSeconds: null, title: null, performer: null, emoji: null, previewId: null, waveform: null, ...overrides
})

const input = (overrides: Partial<DiaryMessageInput> = {}): DiaryMessageInput => ({
  sentAt: '2026-09-28T21:00:00.000Z', text: 'Ran 10k #run', entities: [], attachments: [], replyToId: null,
  forwarded: false, forwardedFrom: null, pinnedAt: null, editedAt: null, source: 'app', ...overrides
})

describe('diary message validation', () => {
  it('accepts text, attachments, or both', () => {
    expect(isDiaryMessageInput(input())).toBe(true)
    expect(isDiaryMessageInput(input({ text: '', attachments: [attachment()] }))).toBe(true)
  })

  it('refuses an empty message', () => {
    expect(isDiaryMessageInput(input({ text: '   ' }))).toBe(false)
  })

  it('keeps entities inside the text', () => {
    expect(isDiaryMessageInput(input({ entities: [{ type: 'bold', offset: 0, length: 3 }] }))).toBe(true)
    expect(isDiaryMessageInput(input({ entities: [{ type: 'bold', offset: 10, length: 5 }] }))).toBe(false)
  })

  it('only takes media IDs that are safe as storage keys', () => {
    expect(isDiaryMessageInput(input({ attachments: [attachment({ mediaId: '../secrets' })] }))).toBe(false)
    expect(isDiaryMessageInput(input({ attachments: [attachment({ mediaId: null })] }))).toBe(true)
  })

  it('limits a voice waveform to bars from 0 to 100', () => {
    const voice = (waveform: number[]) => input({ attachments: [attachment({ kind: 'voice', mimeType: 'audio/mp4', waveform })] })
    expect(isDiaryMessageInput(voice([0, 50, 100]))).toBe(true)
    expect(isDiaryMessageInput(voice([101]))).toBe(false)
  })

  it('lists every file a message needs, previews and custom emoji included', () => {
    expect(diaryMediaIds(input({
      attachments: [attachment({ mediaId: 'a', previewId: 'b' }), attachment({ mediaId: null })],
      entities: [{ type: 'customEmoji', offset: 0, length: 2, mediaId: 'c' }]
    }))).toEqual(['a', 'b', 'c'])
  })
})

describe('diary text segments', () => {
  it('finds links and hashtags typed as plain text', () => {
    expect(detectDiaryLinks('see youtu.be/abc, then #бег and #run_2.')).toEqual([
      { type: 'link', offset: 4, length: 12 },
      { type: 'hashtag', offset: 23, length: 4 },
      { type: 'hashtag', offset: 32, length: 6 }
    ])
  })

  it('does not treat a lone number or a URL fragment as a hashtag', () => {
    expect(detectDiaryLinks('#1 on https://x.com/a#top')).toEqual([{ type: 'link', offset: 6, length: 19 }])
  })

  it('nests styles and keeps a text link on its own run', () => {
    const text = 'Смерть\n\nread this'
    const segments = diarySegments(text, [
      { type: 'bold', offset: 0, length: 8 },
      { type: 'textLink', offset: 13, length: 4, url: 'example.com/post' }
    ])
    expect(segments.map((segment) => [segment.text, segment.bold, segment.link?.value ?? null])).toEqual([
      ['Смерть\n\n', true, null],
      ['read ', false, null],
      ['this', false, 'https://example.com/post']
    ])
  })

  it('does not double up a Telegram hashtag entity with detection', () => {
    const segments = diarySegments('#гтд #мем', [{ type: 'hashtag', offset: 0, length: 4 }, { type: 'hashtag', offset: 5, length: 4 }])
    expect(segments.filter((segment) => segment.link).map((segment) => segment.link?.value)).toEqual(['#гтд', '#мем'])
  })

  it('draws a custom emoji as its own run', () => {
    const segments = diarySegments('2️⃣0️⃣ years', [{ type: 'customEmoji', offset: 0, length: 3, mediaId: 'e1' }])
    expect(segments[0]).toMatchObject({ text: '2️⃣', customEmojiId: 'e1' })
  })
})

describe('editing formatted text', () => {
  const entities = [
    { type: 'bold' as const, offset: 0, length: 5 },
    { type: 'textLink' as const, offset: 11, length: 4, url: 'https://example.com' }
  ]

  it('shifts formatting after an insertion and keeps it before', () => {
    expect(rebaseEntities('Death, see link', 'Death, please see link', entities)).toEqual([
      { type: 'bold', offset: 0, length: 5 },
      { type: 'textLink', offset: 18, length: 4, url: 'https://example.com' }
    ])
  })

  it('drops formatting the edit cut into', () => {
    expect(rebaseEntities('Death, see link', 'Life, see link', entities)).toEqual([
      { type: 'textLink', offset: 10, length: 4, url: 'https://example.com' }
    ])
  })

  it('leaves formatting alone when the text did not change', () => {
    expect(rebaseEntities('Death, see link', 'Death, see link', entities)).toEqual(entities)
  })
})

describe('diary search', () => {
  it('matches every word in any order, across file names too', () => {
    const haystack = diarySearchText(input({ text: 'Birds at 3am', attachments: [attachment({ kind: 'audio', mimeType: 'audio/mpeg', fileName: 'Morning.m4a' })] }))
    expect(matchesDiaryQuery(haystack, 'morning birds')).toBe(true)
    expect(matchesDiaryQuery(haystack, 'evening')).toBe(false)
    expect(matchesDiaryQuery(haystack, '   ')).toBe(false)
  })

  it('collects hashtags once each, lowercased', () => {
    expect(diaryHashtags('#Run then #run and #бег')).toEqual(['#run', '#бег'])
  })

  it('describes a message with no text by what it holds', () => {
    expect(diaryPreviewText(input({ text: '', attachments: [attachment(), attachment()] }))).toBe('2 photos')
    expect(diaryPreviewText(input({ text: '', attachments: [attachment({ kind: 'sticker', mimeType: 'image/webp', emoji: '🥰' })] }))).toBe('🥰 Sticker')
  })
})

const exported = {
  name: 'моя жизнь',
  messages: [
    { id: 1, type: 'service', date_unixtime: '1615180369', action: 'create_channel', text_entities: [] },
    { id: 4, type: 'message', date_unixtime: '1615183499', text_entities: [{ type: 'plain', text: 'Always wanted a channel. ' }, { type: 'hashtag', text: '#start' }] },
    { id: 14, type: 'message', date_unixtime: '1615766942', edited_unixtime: '1615800000', file: 'files/song.mp3', file_name: 'song.mp3', file_size: 4596555, media_type: 'audio_file', performer: 'Alyona', title: 'Read books', mime_type: 'audio/mpeg', duration_seconds: 114, text_entities: [{ type: 'bold', text: 'Death\n\n' }, { type: 'text_link', text: 'link', href: 'https://example.com' }] },
    { id: 20, type: 'message', date_unixtime: '1625000000', photo: 'photos/photo_8.jpg', photo_file_size: 100, width: 800, height: 600, text_entities: [{ type: 'plain', text: 'Rebuilding my room' }] },
    { id: 21, type: 'message', date_unixtime: '1625000000', photo: 'photos/photo_9.jpg', photo_file_size: 100, width: 800, height: 600, text_entities: [] },
    { id: 22, type: 'message', date_unixtime: '1625000001', file: 'video_files/clip.mp4', thumbnail: 'video_files/clip.mp4_thumb.jpg', media_type: 'video_file', mime_type: 'video/mp4', width: 1920, height: 1080, duration_seconds: 5, file_name: 'clip.mp4', text_entities: [] },
    { id: 30, type: 'message', date_unixtime: '1626000000', forwarded_from: null, forwarded_from_id: 'user1', text_entities: [{ type: 'plain', text: 'Nobody can take learning away' }] },
    { id: 31, type: 'message', date_unixtime: '1626000100', forwarded_from: 'Telegram Memes', file: '(File exceeds maximum size. Change data exporting settings to download.)', file_name: 'IMG_8480.MP4', thumbnail: '(File exceeds maximum size. Change data exporting settings to download.)', media_type: 'video_file', mime_type: 'video/mp4', text_entities: [] },
    { id: 32, type: 'message', date_unixtime: '1626000200', file: 'stickers/AnimatedSticker.tgs', thumbnail: 'stickers/AnimatedSticker.tgs_thumb.jpg', media_type: 'sticker', sticker_emoji: '😎', mime_type: 'application/x-tgsticker', width: 512, height: 512, text_entities: [] },
    { id: 33, type: 'message', date_unixtime: '1626000300', file: 'files/PXL_1.jpg', file_name: 'PXL_1.jpg', file_size: 6923831, mime_type: 'image/jpeg', width: 6144, height: 8160, text_entities: [] },
    { id: 34, type: 'message', date_unixtime: '1626000400', reply_to_message_id: 21, file: '(File unavailable, please try again later)', file_name: 'Untitled.mp4', media_type: 'video_file', mime_type: 'video/mp4', text_entities: [] },
    { id: 35, type: 'message', date_unixtime: '1626000500', text_entities: [{ type: 'custom_emoji', text: '2️⃣', document_id: 'stickers/sticker (2).webp' }, { type: 'custom_emoji', text: '🤷', document_id: 'video_files/sticker.webm' }] },
    { id: 36, type: 'service', date_unixtime: '1626000600', action: 'pin_message', message_id: 14, text_entities: [] }
  ]
}

describe('Telegram import plan', () => {
  const plan = planTelegramImport(exported)
  const byId = new Map(plan.messages.map((message) => [message.id, message]))

  it('keeps the channel name and skips service entries', () => {
    expect(plan.title).toBe('моя жизнь')
    expect(plan.messages.map((message) => message.id)).toEqual(['tg-4', 'tg-14', 'tg-20', 'tg-30', 'tg-31', 'tg-32', 'tg-33', 'tg-34', 'tg-35'])
  })

  it('rebuilds the text with entity offsets from the export', () => {
    const song = byId.get('tg-14')?.input
    expect(song?.text).toBe('Death\n\nlink')
    expect(song?.entities).toEqual([
      { type: 'bold', offset: 0, length: 7 },
      { type: 'textLink', offset: 7, length: 4, url: 'https://example.com' }
    ])
    expect(song?.attachments[0]).toMatchObject({ kind: 'audio', title: 'Read books', performer: 'Alyona', durationSeconds: 114 })
    expect(song?.editedAt).toBe('2021-03-15T09:20:00.000Z')
  })

  it('pins the message a pin entry points at', () => {
    expect(byId.get('tg-14')?.input.pinnedAt).toBe('2021-07-11T10:50:00.000Z')
  })

  it('merges an album into one message with the caption and every file', () => {
    const album = byId.get('tg-20')
    expect(album?.telegramIds).toEqual([20, 21, 22])
    expect(album?.input.text).toBe('Rebuilding my room')
    expect(album?.input.attachments.map((item) => [item.kind, item.mediaId])).toEqual([
      ['photo', 'tg-20-file'], ['photo', 'tg-21-file'], ['video', 'tg-22-file']
    ])
    expect(album?.uploads.find((upload) => upload.mediaId === 'tg-22-preview')).toMatchObject({
      transform: 'poster', candidates: ['video_files/clip.mp4'], fallbacks: ['video_files/clip.mp4_thumb.jpg', 'video_files/clip_thumb.jpg']
    })
  })

  it('points a reply at the album that absorbed its target', () => {
    expect(byId.get('tg-34')?.input.replyToId).toBe('tg-20')
  })

  it('marks forwards, including senders Telegram hid', () => {
    expect(byId.get('tg-30')?.input).toMatchObject({ forwarded: true, forwardedFrom: null })
    expect(byId.get('tg-31')?.input).toMatchObject({ forwarded: true, forwardedFrom: 'Telegram Memes' })
    expect(byId.get('tg-4')?.input.forwarded).toBe(false)
  })

  it('looks for a file the export left out under its own name', () => {
    expect(byId.get('tg-31')?.uploads[0]).toMatchObject({ role: 'file', candidates: ['video_files/IMG_8480.MP4'] })
    expect(byId.get('tg-34')?.uploads[0].candidates).toEqual(['video_files/Untitled.mp4'])
  })

  it('unpacks an animated sticker and shows an image sent as a file as a photo', () => {
    expect(byId.get('tg-32')?.input.attachments[0]).toMatchObject({ kind: 'sticker', mimeType: 'application/json', emoji: '😎' })
    expect(byId.get('tg-32')?.uploads[0].transform).toBe('gunzip')
    const photo = byId.get('tg-33')
    expect(photo?.input.attachments[0]).toMatchObject({ kind: 'photo', fileName: 'PXL_1.jpg', previewId: 'tg-33-preview' })
    expect(photo?.uploads[1]).toMatchObject({ transform: 'preview', candidates: ['files/PXL_1.jpg'] })
  })

  it('uploads image custom emoji and leaves video ones as their character', () => {
    const emoji = byId.get('tg-35')
    expect(emoji?.input.entities).toEqual([
      { type: 'customEmoji', offset: 0, length: 3, mediaId: 'tg-35-emoji-0' },
      { type: 'customEmoji', offset: 3, length: 2 }
    ])
    expect(emoji?.uploads).toEqual([expect.objectContaining({ mediaId: 'tg-35-emoji-0', role: 'emoji' })])
  })

  it('produces input the server accepts', () => {
    for (const message of plan.messages) expect(isDiaryMessageInput(message.input)).toBe(true)
  })
})
