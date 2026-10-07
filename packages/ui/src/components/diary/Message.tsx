import React, { memo } from 'react'
import { AlertCircle, Check, Clock, CornerUpRight, Pin, Reply } from 'lucide-react'
import { diaryPreviewText, type DiaryAttachment } from '@ego/core'
import { dateTimeLabel, timeLabel } from '@ego/local/diary/format'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { BlurSpan, Blurred, useBlur } from '../../lib/blur'
import { VISUAL_KINDS } from '../../lib/diary/chat'
import { cn } from '../../lib/utils'
import { AudioRow, FileRow, VoiceRow } from './Attachments'
import { useChat } from './context'
import { MediaGrid } from './MediaGrid'
import { RichText } from './RichText'
import { Sticker, VideoNote } from './Standalone'
import { BUBBLE_WIDTH, TEXT_MAX_WIDTH, ink } from './theme'

function Meta({ message, onMedia, className }: { message: LocalDiaryMessage; onMedia: boolean; className?: string }): React.ReactElement {
  const color = onMedia ? ink.text : ink.meta
  const Icon = message.delivery === 'sending' ? Clock : message.delivery === 'failed' ? AlertCircle : Check
  return <span
    className={cn('pointer-events-none flex select-none items-center gap-[3px] whitespace-nowrap', onMedia && 'rounded-[10px] px-1.5 py-0.5', className)}
    style={onMedia ? { backgroundColor: ink.scrim } : undefined}
  >
    {message.pinnedAt && <Pin color={color} size={10} />}
    <span style={{ color, fontSize: 12, lineHeight: '16px' }}>{message.editedAt ? `edited ${timeLabel(message.sentAt)}` : timeLabel(message.sentAt)}</span>
    <Icon color={message.delivery === 'failed' ? ink.failed : color} size={12} aria-label={message.delivery === 'sending' ? 'Sending' : message.delivery === 'failed' ? 'Did not send' : 'Sent'} />
  </span>
}

function ReplyQuote({ target, onJump }: { target: LocalDiaryMessage | null; onJump: (id: string) => void }): React.ReactElement {
  const { source } = useChat()
  const { blurred } = useBlur()
  const thumbnail = target?.attachments.find((item) => VISUAL_KINDS.has(item.kind) || item.kind === 'sticker')
  const thumbId = thumbnail?.previewId ?? (thumbnail?.kind === 'photo' || thumbnail?.kind === 'sticker' ? thumbnail.mediaId : null)
  return <button
    type="button"
    aria-label="Go to the message this replies to"
    disabled={!target}
    onClick={() => target && onJump(target.id)}
    className="mx-1.5 mt-1.5 flex overflow-hidden rounded-lg text-left transition-colors hover:bg-white/10"
    style={{ backgroundColor: 'rgba(255, 255, 255, 0.07)', width: 'calc(100% - 12px)' }}
  >
    <span className="w-[3px] shrink-0" style={{ backgroundColor: ink.text }} />
    {thumbId && <span className="m-1 h-9 w-9 shrink-0 overflow-hidden rounded">
      <img src={source(thumbId)} alt="" draggable={false} className={cn('h-9 w-9 object-cover', blurred && 'ego-blurred-media')} />
    </span>}
    <span className="flex min-w-0 flex-1 flex-col px-2 py-1">
      <span className="truncate text-[13px] font-semibold">{target ? dateTimeLabel(target.sentAt) : 'Reply'}</span>
      <Blurred active={Boolean(target)}><span className="truncate text-[13px] text-surface-300">{target ? diaryPreviewText(target) : 'Deleted message'}</span></Blurred>
    </span>
  </button>
}

function Forwarded({ from }: { from: string | null }): React.ReactElement {
  return <div className="flex items-center gap-[5px] px-2.5 pt-[7px]">
    <CornerUpRight color={ink.meta} size={13} className="shrink-0" />
    <span className="min-w-0 flex-1 truncate" style={{ color: ink.meta, fontSize: 13 }}>
      {from ? <>Forwarded from <span style={{ color: ink.secondary, fontWeight: 600 }}><BlurSpan>{from}</BlurSpan></span></> : 'Forwarded message'}
    </span>
  </div>
}

function OtherAttachment({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  switch (attachment.kind) {
    case 'audio': return <AudioRow attachment={attachment} />
    case 'voice': return <VoiceRow attachment={attachment} />
    case 'sticker': return <Sticker attachment={attachment} />
    case 'videoNote': return <VideoNote attachment={attachment} />
    default: return <FileRow attachment={attachment} />
  }
}

export interface MessageProps {
  message: LocalDiaryMessage
  /** Undefined when this is not a reply; null when the message it answered is gone. */
  replyTarget: LocalDiaryMessage | null | undefined
  highlighted: boolean
  /** The right-click menu, opened where the pointer is. */
  onMenu: (message: LocalDiaryMessage, at: { x: number; y: number }) => void
  onReply: (message: LocalDiaryMessage) => void
  onJump: (id: string) => void
  onRetry: (message: LocalDiaryMessage) => void
}

function MessageView({ message, replyTarget, highlighted, onMenu, onReply, onJump, onRetry }: MessageProps): React.ReactElement {
  const { source, onHashtag } = useChat()
  const visual = message.attachments.filter((item) => VISUAL_KINDS.has(item.kind))
  const others = message.attachments.filter((item) => !VISUAL_KINDS.has(item.kind))
  const hasText = message.text.trim().length > 0
  const lone = message.attachments.length === 1 && !hasText && !message.forwarded && replyTarget === undefined
    ? message.attachments[0]
    : null
  const standalone = lone && (lone.kind === 'sticker' || lone.kind === 'videoNote') ? lone : null
  const sized = message.attachments.length > 0
  const menu = (event: React.MouseEvent): void => {
    event.preventDefault()
    onMenu(message, { x: event.clientX, y: event.clientY })
  }

  const body = standalone
    ? <div onContextMenu={menu} className="flex flex-col items-end transition-opacity" style={{ opacity: highlighted ? 0.6 : 1 }}>
      {standalone.kind === 'sticker' ? <Sticker attachment={standalone} /> : <VideoNote attachment={standalone} />}
      <Meta message={message} onMedia className="mt-1" />
    </div>
    : <div
      onContextMenu={menu}
      className="relative overflow-hidden rounded-[18px] border transition-colors duration-300"
      style={{
        width: sized ? BUBBLE_WIDTH : undefined,
        maxWidth: sized ? undefined : TEXT_MAX_WIDTH,
        backgroundColor: highlighted ? ink.flash : ink.bubble,
        borderColor: ink.bubbleEdge
      }}
    >
      {message.forwarded && <Forwarded from={message.forwardedFrom} />}
      {replyTarget !== undefined && <ReplyQuote target={replyTarget} onJump={onJump} />}
      {visual.length > 0 && <div className="relative" style={{ marginTop: message.forwarded || replyTarget !== undefined ? 6 : 0 }}>
        <MediaGrid attachments={visual} width={BUBBLE_WIDTH - 2} />
        {!hasText && others.length === 0 && <Meta message={message} onMedia className="absolute bottom-2 right-2" />}
      </div>}
      {others.length > 0 && <div className="flex flex-col gap-1.5 px-2.5 pt-2">
        {others.map((attachment, index) => <OtherAttachment key={`${attachment.mediaId ?? 'missing'}-${index}`} attachment={attachment} />)}
      </div>}
      {hasText && <div className="px-[11px] pb-[7px] pt-1.5">
        <RichText
          text={message.text}
          entities={message.entities}
          source={source}
          onHashtag={onHashtag}
          trailing={<Meta message={message} onMedia={false} className="invisible ml-2 inline-flex align-baseline" />}
        />
      </div>}
      {(hasText || others.length > 0) && <Meta message={message} onMedia={false} className="absolute bottom-1.5 right-2.5" />}
      {!hasText && others.length > 0 && <div className="h-[22px]" />}
    </div>

  return <div data-message-id={message.id} className="group flex items-end justify-end gap-1.5 px-2.5 py-[3px]">
    <button
      type="button"
      aria-label="Reply"
      title="Reply"
      onClick={() => onReply(message)}
      style={{ backgroundColor: ink.tile }}
      className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-80"
    ><Reply color={ink.text} size={17} /></button>
    {message.delivery === 'failed' && <button
      type="button"
      aria-label="This message did not send. Try again"
      title="Try sending again"
      onClick={() => onRetry(message)}
      className="mb-1.5 shrink-0"
    ><AlertCircle color={ink.failed} size={20} /></button>}
    {body}
  </div>
}

export const Message = memo(MessageView)

export function DaySeparator({ label }: { label: string }): React.ReactElement {
  return <div className="flex justify-center py-2.5">
    <span className="rounded-xl px-2.5 py-[3px] text-[13px] font-semibold" style={{ backgroundColor: ink.tile, color: ink.secondary }}>{label}</span>
  </div>
}
