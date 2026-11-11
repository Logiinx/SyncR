// Notes and Board items that sync brought from the other device: new ones get a green tint for a
// moment, deleted ones a red tint before they go (animations.ts plays it; DECISIONS.md "Sync
// changes tinted green / red"). Sync marks them by id just before storing; the sidebar and the
// Board take the mark when the item appears or goes. A mark not taken soon (not on screen) is
// forgotten: nothing glows later.

export type Glow = 'added' | 'removed'

const MARK_MS = 3000 // a mark not taken by then is forgotten
const MOST = 10 // more changes than this in one sync: nothing glows

const marks = new Map<string, { glow: Glow; at: number }>()
let on = false

// At the start of each sync, with how many notes and cards may change in it
export function startGlows(changes: number) {
  marks.clear()
  on = changes <= MOST
}

export function markGlow(id: string, glow: Glow) {
  if (on) marks.set(id, { glow, at: performance.now() })
}

// Not stored after all (changed here while sync ran)
export function unmarkGlow(id: string) {
  marks.delete(id)
}

export function takeGlow(id: string | undefined, glow: Glow) {
  const mark = id === undefined ? undefined : marks.get(id)
  if (!mark || mark.glow !== glow || performance.now() - mark.at > MARK_MS) return false
  marks.delete(id!)
  return true
}
