// Notes and Board items that sync brought from the other device: new ones get a green tint for a
// moment, deleted ones a red tint before they go, edited notes a blue one (animations.ts plays
// it; inside the open note: syncEdits.ts; DECISIONS.md "Sync changes tinted green / red"). Sync
// marks them by id just before storing; the sidebar, the Board and the open note take the mark
// when the item appears, goes or changes. A mark not taken soon (not on screen) is forgotten:
// nothing glows later.

export type Glow = 'added' | 'removed' | 'edited'

const MARK_MS = 3000 // a mark not taken by then is forgotten
const MOST = 10 // more changes than this in one sync: nothing glows

// taken: who already showed it (an edited note: its sidebar row and the open note, each once)
const marks = new Map<string, { glow: Glow; at: number; taken: Set<string> }>()
let on = false

// At the start of each sync, with how many notes and cards may change in it
export function startGlows(changes: number) {
  marks.clear()
  on = changes <= MOST
}

export function markGlow(id: string, glow: Glow) {
  if (on) marks.set(id, { glow, at: performance.now(), taken: new Set() })
}

// Not stored after all (changed here while sync ran)
export function unmarkGlow(id: string) {
  marks.delete(id)
}

// by: who shows it ('list': the sidebar or the Board; 'note': the open note)
export function takeGlow(id: string | undefined, glow: Glow, by = 'list') {
  const mark = id === undefined ? undefined : marks.get(id)
  if (!mark || mark.glow !== glow || mark.taken.has(by) || performance.now() - mark.at > MARK_MS) return false
  mark.taken.add(by)
  return true
}
