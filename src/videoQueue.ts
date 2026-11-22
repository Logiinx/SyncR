import { useSyncExternalStore } from 'react'
import { read, write } from './localState'
import { startedIds } from './videoPositions'

// The Queue (Video tab, this PC only, like the spots reached): the videos to go on with, in the
// user's own order. A video started joins it on its own, at the top (auto); one added by hand goes
// at the bottom. One opened by hand goes back to the top once started. It leaves once watched
// (video.ts) or removed by hand.
export interface QueueEntry {
  id: string
  auto?: boolean // joined by being started, not added by hand
}
const KEY = 'syncr.videoQueue'
const KEPT = 200

// The first time: the videos already started, the last one watched first (Started's order)
let queue = read<QueueEntry[] | null>(KEY, null) ?? firstQueue()
const listeners = new Set<() => void>()

function firstQueue() {
  const first = startedIds().map((id) => ({ id, auto: true }))
  write(KEY, first)
  return first
}

function save(next: QueueEntry[]) {
  queue = next.slice(0, KEPT)
  write(KEY, queue)
  for (const listener of listeners) listener()
}

const has = (id: string) => queue.some((entry) => entry.id === id)

// Stopped partway: joins at the top, unless it's there already (its place stays)
export function queueStarted(id: string) {
  if (!has(id)) save([{ id, auto: true }, ...queue])
}

// Opened in the player and started (once per opening, videoPlayer.ts): goes first, also from a spot
// placed by hand (user, 2026-11-22: the last one opened goes first). It keeps how it joined.
export function queueOpened(id: string) {
  if (queue[0]?.id !== id) move(id, () => 0, { id, auto: true })
}

// Takes it out and puts it back where `at` says among the others; one not in the Queue yet: `fresh`
function move(id: string, at: (rest: QueueEntry[]) => number, fresh: QueueEntry) {
  const entry = queue.find((other) => other.id === id) ?? fresh
  const rest = queue.filter((other) => other.id !== id)
  const index = at(rest)
  save([...rest.slice(0, index), entry, ...rest.slice(index)])
}

export function addToQueue(id: string) {
  if (!has(id)) save([...queue, { id }])
}

export function leaveQueue(ids: string[]) {
  const leaving = new Set(ids)
  if (queue.some((entry) => leaving.has(entry.id))) save(queue.filter((entry) => !leaving.has(entry.id)))
}

// Dragged within the Queue or into it (videoDrag.ts): just before `before`, or just after `after`
// when it went last among the rows shown (the Queue can hold videos not shown right now, e.g. with
// one follow chosen); neither: at the end. One dragged in joins as added by hand.
export function placeInQueue(id: string, before: string | null, after: string | null) {
  move(id, (rest) => {
    const index = (other: string | null) => rest.findIndex((one) => one.id === other)
    return index(before) >= 0 ? index(before) : index(after) >= 0 ? index(after) + 1 : rest.length
  }, { id })
}

// Joined by being started (not added by hand)
export const joinedAlone = (id: string) => !!queue.find((entry) => entry.id === id)?.auto

// A watched episode's place goes to the next one, which counts as joined alone too
export function replaceInQueue(id: string, next: string) {
  if (has(next)) return
  save(queue.map((entry) => (entry.id === id ? { id: next, auto: true } : entry)))
}

export const inQueue = has

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useQueue() {
  return useSyncExternalStore(subscribe, () => queue)
}
