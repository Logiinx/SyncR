import { loadBackground } from './desktop'

// Short sounds for pop-ups (reminders; emails later), made with Web Audio (no sound files
// needed). Chosen per kind in Settings; "None" is silent. Also silent when the browser
// doesn't allow sound yet (browsers block it until the page was clicked once).

export type SoundId = 'chime' | 'soft' | 'ping' | 'double' | 'none'

// In the order Settings lists them
export const SOUNDS: { id: SoundId; name: string }[] = [
  { id: 'chime', name: 'Chime' },
  { id: 'soft', name: 'Soft' },
  { id: 'ping', name: 'Ping' },
  { id: 'double', name: 'Double ping' },
  { id: 'none', name: 'None' },
]

let audio: AudioContext | null = null

// The sounds chosen for reminders and for new emails
export const playReminderSound = () => playSound(loadBackground().reminderSoundId)
export const playEmailSound = () => playSound(loadBackground().emailSoundId)

export async function playSound(id: SoundId) {
  if (id === 'none') return
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
    const start = audio.currentTime + 0.02
    if (id === 'chime') {
      note(audio, 880, start, 0.9) // A5
      note(audio, 1318.5, start + 0.16, 0.9) // E6
    } else if (id === 'soft') {
      note(audio, 523.25, start, 1.4, 0.14) // C5, long and quiet
    } else if (id === 'ping') {
      note(audio, 1568, start, 0.35) // G6, short
    } else {
      note(audio, 1568, start, 0.3)
      note(audio, 1568, start + 0.14, 0.3)
    }
  } catch {
    // No sound possible: the pop-up / card still shows
  }
}

// One bell-like note: quick rise, then a fade lasting `length` seconds
function note(audio: AudioContext, frequency: number, start: number, length: number, volume = 0.18) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + length + 0.1)
}
