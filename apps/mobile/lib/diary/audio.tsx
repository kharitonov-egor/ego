import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createAudioPlayer, setAudioModeAsync, useAudioPlayerStatus } from 'expo-audio'
import type { MediaSource } from './media'

interface DiaryAudioValue {
  /** The media ID loaded in the player, playing or paused. */
  currentId: string | null
  playing: boolean
  position: number
  duration: number
  toggle: (mediaId: string, source: MediaSource) => void
  seek: (mediaId: string, fraction: number) => void
  stop: () => void
}

const DiaryAudioContext = createContext<DiaryAudioValue | null>(null)

/** One player for every voice note and song in the chat, so starting one stops the last. */
export function DiaryAudioProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const player = useMemo(() => createAudioPlayer(null, { updateInterval: 200 }), [])
  const status = useAudioPlayerStatus(player)
  const [currentId, setCurrentId] = useState<string | null>(null)

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined)
    return () => player.remove()
  }, [player])

  useEffect(() => {
    if (!status.didJustFinish) return
    player.pause()
    void player.seekTo(0).catch(() => undefined)
  }, [player, status.didJustFinish])

  const toggle = useCallback((mediaId: string, source: MediaSource) => {
    if (currentId === mediaId) {
      if (status.playing) player.pause()
      else player.play()
      return
    }
    player.replace({ uri: source.uri, headers: source.headers })
    setCurrentId(mediaId)
    player.play()
  }, [currentId, player, status.playing])

  const seek = useCallback((mediaId: string, fraction: number) => {
    if (mediaId !== currentId || status.duration <= 0) return
    void player.seekTo(Math.max(0, Math.min(1, fraction)) * status.duration).catch(() => undefined)
  }, [currentId, player, status.duration])

  const stop = useCallback(() => {
    player.pause()
    setCurrentId(null)
  }, [player])

  const value = useMemo<DiaryAudioValue>(() => ({
    currentId,
    playing: status.playing,
    position: status.currentTime,
    duration: status.duration,
    toggle,
    seek,
    stop
  }), [currentId, seek, status.currentTime, status.duration, status.playing, stop, toggle])

  return <DiaryAudioContext.Provider value={value}>{children}</DiaryAudioContext.Provider>
}

export function useDiaryAudio(): DiaryAudioValue {
  const context = useContext(DiaryAudioContext)
  if (!context) throw new Error('useDiaryAudio must be used inside DiaryAudioProvider')
  return context
}
