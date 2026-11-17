import { useSyncExternalStore } from 'react'
import { read, write } from './localState'
import { startedIds } from './videoPositions'

// The Queue (Video tab, this PC only, like the spots reached): the videos to go on with, in the
// user's own order. A video stopped partway joins it on its own, at the top (auto); one added by
// hand goes at the bottom. It leaves once watched (video.ts) or removed by hand.
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

export function addToQueue(id: string) {
  if (!has(id)) save([...queue, { id }])
}

export function leaveQueue(ids: string[]) {
  const leaving = new Set(ids)
  if (queue.some((entry) => leaving.has(entry.id))) save(queue.filter((entry) => !leaving.has(entry.id)))
}

export const inQueue = has

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useQueue() {
  return useSyncExternalStore(subscribe, () => queue)
}
