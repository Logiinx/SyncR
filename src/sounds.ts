import { loadBackground } from './desktop'

// Short sounds for pop-ups (reminders; emails later), made with Web Audio (no sound files
// needed). Chosen per kind in Settings; "None" is silent. Also silent when the browser
// doesn't allow sound yet (browsers block it until the page was clicked once).

export type SoundId = 'chime' | 'soft' | 'ping' | 'double' | 'drop' | 'glass' | 'wood' | 'rise' | 'bubble' | 'none'

// In the order Settings lists them
export const SOUNDS: { id: SoundId; name: string }[] = [
  { id: 'chime', name: 'Chime' },
  { id: 'soft', name: 'Soft' },
  { id: 'ping', name: 'Ping' },
  { id: 'double', name: 'Double ping' },
  { id: 'drop', name: 'Drop' },
  { id: 'glass', name: 'Glass' },
  { id: 'wood', name: 'Wood' },
  { id: 'rise', name: 'Rise' },
  { id: 'bubble', name: 'Bubble' },
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
    switch (id) {
      case 'chime':
        note(audio, 880, start, 0.9) // A5
        note(audio, 1318.5, start + 0.16, 0.9) // E6
        break
      case 'soft':
        note(audio, 523.25, start, 1.4, { volume: 0.14 }) // C5, long and quiet
        break
      case 'ping':
        note(audio, 1568, start, 0.35) // G6, short
        break
      case 'drop': // a water drop: a short note sliding down
        note(audio, 1400, start, 0.28, { volume: 0.14, slideTo: 700 })
        break
      case 'glass': // a small glass bell: the note plus its bell overtone
        note(audio, 1046.5, start, 1.2, { volume: 0.11 }) // C6
        note(audio, 2888, start, 0.5, { volume: 0.03 })
        break
      case 'wood': // a soft marimba knock: low, very short
        note(audio, 587.33, start, 0.32, { volume: 0.16 }) // D5
        note(audio, 2349, start, 0.06, { volume: 0.03 })
        break
      case 'rise': // three quiet notes going up
        note(audio, 783.99, start, 0.5, { volume: 0.1 }) // G5
        note(audio, 987.77, start + 0.09, 0.5, { volume: 0.1 }) // B5
        note(audio, 1174.66, start + 0.18, 0.7, { volume: 0.1 }) // D6
        break
      case 'bubble': // a soft "blup": a short note sliding up
        note(audio, 380, start, 0.16, { volume: 0.16, slideTo: 900 })
        break
      default: // double
        note(audio, 1568, start, 0.3)
        note(audio, 1568, start + 0.14, 0.3)
    }
  } catch {
    // No sound possible: the pop-up / card still shows
  }
}

// One bell-like note: quick rise, then a fade lasting `length` seconds. `slideTo` glides the
// pitch to that frequency during the note.
function note(audio: AudioContext, frequency: number, start: number, length: number,
  { volume = 0.18, slideTo }: { volume?: number; slideTo?: number } = {}) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, start)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + length * 0.6)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + length + 0.1)
}
