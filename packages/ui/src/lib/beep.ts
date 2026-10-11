let audio: AudioContext | null = null

/** Two short tones, where the phone vibrates twice. */
export function beep(): void {
  if (typeof AudioContext === 'undefined') return
  audio ??= new AudioContext()
  const context = audio
  void context.resume().catch(() => undefined)
  for (const offset of [0, 0.3]) {
    const at = context.currentTime + offset
    const tone = context.createOscillator()
    const gain = context.createGain()
    tone.type = 'sine'
    tone.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
    tone.connect(gain).connect(context.destination)
    tone.start(at)
    tone.stop(at + 0.22)
  }
}
