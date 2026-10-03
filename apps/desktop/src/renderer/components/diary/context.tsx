import { createContext, useContext } from 'react'

export interface ChatContextValue {
  /** What an `<img>`, `<video>`, or `<audio>` loads for a media ID. */
  source: (mediaId: string) => string
  openViewer: (mediaId: string) => void
  onHashtag: (tag: string) => void
}

export const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside the diary chat')
  return context
}
