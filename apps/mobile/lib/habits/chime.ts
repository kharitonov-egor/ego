import { useCallback } from 'react'
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio'
import habitDone from '../../assets/sounds/habit-done.wav'

/**
 * Plays the check-off sound. Without mixWithOthers, Android takes audio focus and pauses whatever
 * music is playing. The mode is set before every play because the diary sets its own when it opens.
 *
 * An ended clip is still set to play, so seeking alone would replay it and skip the silent-mode
 * check that only play() makes. Pausing first leaves that check to play().
 */
export function useChime(): () => void {
  const player = useAudioPlayer(habitDone)
  return useCallback(() => {
    void setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: false })
      .then(() => {
        player.pause()
        return player.seekTo(0)
      })
      .then(() => player.play())
      .catch(() => undefined)
  }, [player])
}
