import { diaryHashtags, type DiaryAttachment } from '@ego/core'
import { dayKeyOf, dayLabel } from '@ego/local/diary/format'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'

export const VISUAL_KINDS: ReadonlySet<DiaryAttachment['kind']> = new Set(['photo', 'video', 'animation'])

export type Row =
  | { kind: 'message'; key: string; message: LocalDiaryMessage }
  | { kind: 'day'; key: string; label: string }

/** Oldest first with a separator before each day, the order the chat reads top to bottom. */
export function buildRows(messages: readonly LocalDiaryMessage[], now = new Date()): Row[] {
  const before = new Date(now)
  before.setDate(before.getDate() - 1)
  const today = dayKeyOf(now.toISOString())
  const yesterday = dayKeyOf(before.toISOString())
  const rows: Row[] = []
  let lastDay = ''
  for (const message of messages) {
    const day = dayKeyOf(message.sentAt)
    if (day !== lastDay) {
      rows.push({ kind: 'day', key: `d-${day}`, label: dayLabel(day, today, yesterday) })
      lastDay = day
    }
    rows.push({ kind: 'message', key: `m-${message.id}`, message })
  }
  return rows
}

export interface ViewerItem {
  key: string
  messageId: string
  attachment: DiaryAttachment
  sentAt: string
  caption: string
}

export function buildViewerItems(messages: readonly LocalDiaryMessage[]): ViewerItem[] {
  const items: ViewerItem[] = []
  for (const message of messages) {
    message.attachments.forEach((attachment, index) => {
      if (!VISUAL_KINDS.has(attachment.kind) || (!attachment.mediaId && !attachment.previewId)) return
      items.push({ key: `${message.id}-${index}`, messageId: message.id, attachment, sentAt: message.sentAt, caption: message.text })
    })
  }
  return items
}

export function tagCounts(messages: readonly LocalDiaryMessage[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const tag of diaryHashtags(message.text, message.entities)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, 60)
}

export function subtitle(messages: readonly LocalDiaryMessage[]): string {
  const failed = messages.filter((message) => message.delivery === 'failed').length
  if (failed > 0) return failed === 1 ? '1 message did not send' : `${failed} messages did not send`
  const sending = messages.filter((message) => message.delivery === 'sending').length
  if (sending > 0) return sending === 1 ? 'Sending 1 message' : `Sending ${sending} messages`
  return messages.length === 1 ? '1 message' : `${messages.length} messages`
}
