import { expect, test, vi } from 'vitest'
import fc from 'fast-check'

// The Hardware peaks (hardware.ts): the highest temperature and power since SyncR started, only for
// the readings ticked for the widget (the others aren't read all the time).

vi.mock('../src/localState', () => ({ read: (_key: string, fallback: unknown) => fallback, write: () => {} }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, decimal: String, percentText: (n: number) => `${n}%` })) // the real one needs a page
vi.mock('../src/animations', () => ({ animationsOn: () => true })) // needs a page too

const { nextPeaks } = await import('../src/hardware')
const none = { cpuTemp: null, gpuTemp: null, gpuMemTemp: null, gpuPower: null }

test('keeps the highest of each ticked reading', () => {
  let peaks = nextPeaks({}, { ...none, gpuTemp: 60, gpuPower: 200 }, ['gpuTemp', 'gpuPower'])
  peaks = nextPeaks(peaks, { ...none, gpuTemp: 55, gpuPower: 280 }, ['gpuTemp', 'gpuPower'])
  expect(peaks).toEqual({ gpuTemp: 60, gpuPower: 280 })
})

test('leaves out readings not ticked, and missing ones', () => {
  expect(nextPeaks({}, { ...none, cpuTemp: 70, gpuTemp: 60 }, ['gpuTemp'])).toEqual({ gpuTemp: 60 })
  expect(nextPeaks({ cpuTemp: 70 }, none, ['cpuTemp'])).toEqual({ cpuTemp: 70 })
})

test('gives back the same object when nothing went up (no redraw)', () => {
  const peaks = { gpuTemp: 60 }
  expect(nextPeaks(peaks, { ...none, gpuTemp: 60 }, ['gpuTemp'])).toBe(peaks)
})

test('the peak is the highest of any series of readings', () => {
  fc.assert(
    fc.property(fc.array(fc.double({ min: -50, max: 200, noNaN: true }), { minLength: 1 }), (temps) => {
      const peaks = temps.reduce((all, gpuTemp) => nextPeaks(all, { ...none, gpuTemp }, ['gpuTemp']), {})
      expect(peaks).toEqual({ gpuTemp: Math.max(...temps) })
    }),
  )
})
