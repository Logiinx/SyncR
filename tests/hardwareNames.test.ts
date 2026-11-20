import { expect, test, vi } from 'vitest'

// The hardware module's names (hardware.ts): Windows' and NVIDIA's long names, shortened for the
// settings window and the widget.

vi.mock('../src/localState', () => ({ read: (_key: string, fallback: unknown) => fallback, write: () => {} }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, decimal: String, percentText: (n: number) => `${n}%` })) // the real one needs a page
vi.mock('../src/animations', () => ({ animationsOn: () => true })) // needs a page too

const { groupName, shortCpuName, shortGpuName } = await import('../src/hardware')

test('CPU names', () => {
  expect(shortCpuName('AMD Ryzen 7 5700X3D 8-Core Processor')).toBe('Ryzen 7 5700X3D')
  expect(shortCpuName('AMD Ryzen 9 7950X 16-Core Processor          ')).toBe('Ryzen 9 7950X')
  expect(shortCpuName('Intel(R) Core(TM) i7-12700K')).toBe('Core i7-12700K')
  expect(shortCpuName('Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz')).toBe('Core i7-8700')
  expect(shortCpuName('Intel(R) Core(TM) Ultra 7 265K')).toBe('Core Ultra 7 265K')
})

test('GPU names', () => {
  expect(shortGpuName('NVIDIA GeForce RTX 5070 Ti')).toBe('RTX 5070 Ti')
  expect(shortGpuName('NVIDIA RTX A4000')).toBe('RTX A4000')
})

test('Group names', () => {
  const r = { cpuName: 'AMD Ryzen 7 5700X3D 8-Core Processor', gpuName: 'NVIDIA GeForce RTX 5070 Ti' }
  expect([groupName('cpu', r), groupName('gpu', r), groupName('memory', r)]).toEqual(['Ryzen 7 5700X3D', 'RTX 5070 Ti', 'Memory'])
  expect([groupName('cpu'), groupName('gpu', null), groupName('memory')]).toEqual(['CPU', 'GPU', 'Memory'])
  expect(groupName('cpu', { cpuName: null, gpuName: null })).toBe('CPU') // not read yet
})
