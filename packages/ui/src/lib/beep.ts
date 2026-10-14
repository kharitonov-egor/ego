let shared: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  shared ??= new AudioContext()
  void shared.resume().catch(() => undefined)
  return shared
}

function tone(audio: AudioContext, frequency: number, at: number, peak: number, length: number, attack: number): void {
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start(at)
  oscillator.stop(at + length + 0.02)
}

/** Two short tones, where the phone vibrates twice. */
export function beep(): void {
  const audio = audioContext()
  if (!audio) return
  for (const offset of [0, 0.3]) tone(audio, 880, audio.currentTime + offset, 0.25, 0.2, 0.02)
}

/** G5 then C6. Each note gets a short partial two octaves up, which sounds like a mallet striking. */
const CHIME = [
  { frequency: 783.99, offset: 0, length: 0.35 },
  { frequency: 1046.5, offset: 0.08, length: 0.8 }
] as const

/**
 * For a habit checked off. The phone plays the same sound at twice this level, for its small
 * speaker, from apps/mobile/assets/sounds/habit-done.wav. A change here means rendering that file again.
 */
export function chime(): void {
  try {
    const audio = audioContext()
    if (!audio) return
    const start = audio.currentTime
    for (const { frequency, offset, length } of CHIME) {
      tone(audio, frequency, start + offset, 0.2, length, 0.005)
      tone(audio, frequency * 4, start + offset, 0.04, 0.08, 0.005)
    }
  } catch {
    // A sound that fails must not fail the check-off.
  }
}
