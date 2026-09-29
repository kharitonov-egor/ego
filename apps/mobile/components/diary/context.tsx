import { createContext, useContext } from 'react'
import type { DiaryMediaApi } from '../../lib/api-client'

export interface ChatContextValue {
  api: DiaryMediaApi
  localFiles: ReadonlyMap<string, string>
  openViewer: (mediaId: string) => void
  onHashtag: (tag: string) => void
}

export const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside the diary chat')
  return context
}

/**
 * Messages on screen right now. Kept apart from the chat context so scrolling only re-renders
 * the looping GIFs, not every bubble.
 */
export const VisibleContext = createContext<ReadonlySet<string>>(new Set())
