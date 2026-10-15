import { loadBackground } from './desktop'

// A short, soft two-note chime for reminders, made with Web Audio (no sound file needed).
// Silent when turned off in Settings, or when the browser doesn't allow sound yet (browsers
// block it until the page was clicked once).

let audio: AudioContext | null = null

export async function playChime() {
  if (!loadBackground().reminderSound) return
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
    const start = audio.currentTime + 0.02
    note(audio, 880, start) // A5
    note(audio, 1318.5, start + 0.16) // E6
  } catch {
    // No sound possible: the pop-up / card still shows
  }
}

// One bell-like note: quick rise, slow fade
function note(audio: AudioContext, frequency: number, start: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(0.18, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + 1)
}
