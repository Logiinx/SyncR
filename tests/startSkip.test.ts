import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The waiting screen at a video's start (src-tauri/player/startSkip.js): a plain page script,
// loaded here the way a page would, and given made-up pictures.

const code = readFileSync(new URL('../src-tauri/player/startSkip.js', import.meta.url), 'utf8')
const skip = new Function(`${code}\nreturn { SKIP, findWaiting, refineStart, learnLooks, skipWorthIt }`)()

const W = 32
const H = 18
type Picture = Uint8ClampedArray
// A made-up picture: color(x, y) → [r, g, b]
const make = (color: (x: number, y: number) => number[]): Picture => {
  const picture = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) picture.set([...color(x, y), 255], (y * W + x) * 4)
  return picture
}
// Two waiting cards (a stripe on the left, or on the right), the same layout in another color,
// and true content (a different layout, which changes a bit each time)
const cardA = make((x) => (x < 10 ? [240, 40, 200] : [30, 30, 90]))
const cardB = make((x) => (x > 22 ? [240, 220, 40] : [20, 90, 30]))
const cardABlue = make((x) => (x < 10 ? [40, 120, 240] : [90, 30, 30]))
const content = (seed: number) => make((x, y) => [((x * 7 + y * 13 + seed * 31) % 97) + 80, ((x * y + seed) % 61) + 60, (y * 11) % 120])
const faceCam = (seed: number) => make((x, y) => [120 + ((x + y + seed) % 3), 100, 90 + (y > 9 ? 40 : 0)])
const at = (step: number, pictures: Picture[]) => pictures.map((picture, index) => ({ at: index * step, picture }))

test('cards swapping, then the true start', () => {
  const found = skip.findWaiting(at(60, [cardA, cardB, cardA, cardB, cardA, content(1), content(2), content(3), content(4)]), [])
  expect(found).toMatchObject({ from: 240, to: 300, learned: false })
  expect(found.run).toHaveLength(5)
})

test('a card whose colors change is still the waiting screen', () => {
  expect(skip.findWaiting(at(60, [cardA, cardABlue, cardA, cardABlue, content(1), content(2), content(3)]), [])?.to).toBe(240)
})

test('an odd picture inside the waiting screen is part of it', () => {
  expect(skip.findWaiting(at(60, [cardA, cardA, content(9), cardA, cardA, content(1), content(2), content(3)]), [])?.to).toBe(300)
})

test('the change must last: two pictures and 90 s at least', () => {
  // 10 s apart (YouTube): content back to the card within 90 s is no true start
  const back = [cardA, cardA, cardA, content(1), content(2), content(3), content(4), cardA, content(5), content(6), content(7), content(8), content(9), content(10), content(11), content(12), content(13), content(14), content(15)]
  expect(skip.findWaiting(at(10, back), [])?.to).toBe(80)
  // The video's pictures end right after the change: not sure
  expect(skip.findWaiting(at(60, [cardA, cardA, content(1), content(2)]), [])).toBeNull()
})

test('still the same after 30 min, or a single picture: no waiting screen', () => {
  expect(skip.findWaiting(at(300, [...Array(8).fill(faceCam(0)), content(1), content(2), content(3)]), [])).toBeNull()
  expect(skip.findWaiting(at(600, [cardA, content(1), content(2), content(3)]), [])).toBeNull()
})

test('a learned look: matched, even a single picture, and nothing else is', () => {
  const looks = skip.learnLooks([], [cardA, cardB])
  expect(skip.findWaiting(at(600, [cardA, content(1), content(2), content(3)]), looks)).toMatchObject({ from: 0, to: 600, learned: true })
  // A face cam, then a game: found as before, but never as the learned look
  expect(skip.findWaiting(at(60, [faceCam(0), faceCam(1), faceCam(2), content(1), content(2), content(3)]), looks)?.learned).toBe(false)
})

test('looks: the most different first, none twice, the oldest go', () => {
  const looks = skip.learnLooks([], [cardA, cardA, cardB, cardA])
  expect(looks).toHaveLength(2)
  expect(skip.learnLooks(looks, [cardA, cardB])).toEqual(looks)
  let many: string[] = []
  for (let i = 0; i < 12; i++) many = skip.learnLooks(many, [content(i * 5)])
  expect(many).toHaveLength(skip.SKIP.looksKept)
  // Broken text (an older or damaged setting) is dropped, not used
  expect(skip.learnLooks(['nope', 42], [cardA])).toHaveLength(1)
})

test('refining: the first moment past the waiting screen, within 10 s', async () => {
  const found = skip.findWaiting(at(600, [cardA, cardA, content(1), content(2), content(3)]), [])
  const trueStart = 777
  const start = await skip.refineStart(found, [], async (seconds: number) => (seconds < trueStart ? cardA : content(seconds)))
  expect(start).toBeGreaterThanOrEqual(trueStart)
  expect(start - trueStart).toBeLessThanOrEqual(skip.SKIP.precision)
  // No picture to be had: Twitch's own first true picture
  expect(await skip.refineStart(found, [], async () => null)).toBe(1200)
  // Two cards swapping: the second one, shown while refining, is still the waiting screen
  const swapping = skip.findWaiting(at(200, [cardA, cardB, cardA, cardB, content(1), content(2), content(3)]), [])
  const card = (seconds: number) => (Math.floor(seconds / 50) % 2 ? cardB : cardA)
  const after = await skip.refineStart(swapping, [], async (seconds: number) => (seconds < trueStart ? card(seconds) : content(seconds)))
  expect(after - trueStart).toBeGreaterThanOrEqual(0)
  expect(after - trueStart).toBeLessThanOrEqual(skip.SKIP.precision)
})

test('a button only for a waiting screen worth it, and not once past it', () => {
  expect(skip.skipWorthIt(30, 0)).toBe(false)
  expect(skip.skipWorthIt(300, 0)).toBe(true)
  expect(skip.skipWorthIt(300, 298)).toBe(false)
  expect(skip.skipWorthIt(2400, 0)).toBe(false)
})
