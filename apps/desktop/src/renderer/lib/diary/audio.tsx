import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface DiaryAudioValue {
  /** The media ID loaded in the player, playing or paused. */
  currentId: string | null
  playing: boolean
  position: number
  /** Zero until the file says how long it is. A recording from this computer may never say. */
  duration: number
  toggle: (mediaId: string, source: string) => void
  /** `fallback` is the length the message recorded, for a file that does not report its own. */
  seek: (mediaId: string, fraction: number, fallback?: number) => void
  stop: () => void
}

const DiaryAudioContext = createContext<DiaryAudioValue | null>(null)

/** One player for every voice note and song in the chat, so starting one stops the last. */
export function DiaryAudioProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const player = useMemo(() => new Audio(), [])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const update = (): void => {
      setPosition(player.currentTime)
      setDuration(Number.isFinite(player.duration) ? player.duration : 0)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => {
      player.currentTime = 0
      setPlaying(false)
      update()
    }
    player.addEventListener('timeupdate', update)
    player.addEventListener('durationchange', update)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    player.addEventListener('ended', onEnded)
    return () => {
      player.removeEventListener('timeupdate', update)
      player.removeEventListener('durationchange', update)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('ended', onEnded)
      player.pause()
      player.removeAttribute('src')
      player.load()
    }
  }, [player])

  const toggle = useCallback((mediaId: string, source: string) => {
    if (currentId === mediaId) {
      if (player.paused) void player.play().catch(() => undefined)
      else player.pause()
      return
    }
    player.src = source
    setCurrentId(mediaId)
    setPosition(0)
    setDuration(0)
    void player.play().catch(() => undefined)
  }, [currentId, player])

  const seek = useCallback((mediaId: string, fraction: number, fallback = 0) => {
    const length = duration > 0 ? duration : fallback
    if (mediaId !== currentId || length <= 0) return
    player.currentTime = Math.max(0, Math.min(1, fraction)) * length
  }, [currentId, duration, player])

  const stop = useCallback(() => {
    player.pause()
    setCurrentId(null)
  }, [player])

  const value = useMemo<DiaryAudioValue>(() => ({
    currentId, playing, position, duration, toggle, seek, stop
  }), [currentId, duration, playing, position, seek, stop, toggle])

  return <DiaryAudioContext.Provider value={value}>{children}</DiaryAudioContext.Provider>
}

export function useDiaryAudio(): DiaryAudioValue {
  const context = useContext(DiaryAudioContext)
  if (!context) throw new Error('useDiaryAudio must be used inside DiaryAudioProvider')
  return context
}
