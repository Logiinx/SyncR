import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Note } from './db'
import { flashText } from './noteLinks'

// Search across all notes (sidebar). Ignores case and accents ("ete" finds "été"); with several
// words, a note matches when it contains all of them, anywhere. Uses the plain-text copy each
// note keeps (note.text), so nothing has to be indexed.

// Lower case without accents, plus for each folded character the index it came from in the
// original text (one character can fold into several, e.g. "İ"), to cut and mark snippets
function fold(text: string) {
  let folded = ''
  const from: number[] = []
  for (let i = 0; i < text.length; i++) {
    const part = text[i].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    folded += part
    for (let j = 0; j < part.length; j++) from.push(i)
  }
  return { folded, from }
}

export function searchWords(query: string) {
  return fold(query).folded.split(/\s+/).filter(Boolean)
}

const SPOT_MAX = 80 // characters

// Where the words are in one line (or block) of folded text: how many of them it has, and the
// span from the first one to the last (only the first one if they're far apart)
function spotIn(folded: string, words: string[]) {
  let count = 0
  let at = Infinity
  let end = -1
  let firstEnd = -1 // end of the earliest word
  for (const word of words) {
    const i = folded.indexOf(word)
    if (i < 0) continue
    count++
    if (i < at) {
      at = i
      firstEnd = i + word.length
    }
    end = Math.max(end, i + word.length)
  }
  if (end - at > SPOT_MAX) end = firstEnd
  return { count, at, end }
}

// A piece of text with the matched words marked
export type Snippet = { text: string; match: boolean }[]

export interface SearchResult {
  note: Note
  snippet: Snippet | null // null: only the title matched (the normal preview shows)
}

const BEFORE = 30 // characters shown before the match
const LENGTH = 200

export function searchNotes(notes: Note[], query: string): SearchResult[] {
  const words = searchWords(query)
  if (!words.length) return []
  const results: SearchResult[] = []
  for (const note of notes) {
    const folded = fold(note.text).folded
    const title = note.title ? fold(note.title).folded : ''
    if (!words.every((word) => folded.includes(word) || title.includes(word))) continue
    // The snippet comes from the text under the title, like the normal preview (Sidebar.tsx)
    const lines = note.text.split('\n').filter((line) => line.trim() !== '')
    if (!note.title) lines.shift()
    results.push({ note, snippet: snippet(lines.map((line) => line.replace(/\s+/g, ' ').trim()), words) })
  }
  return results
}

// The text around the best match (the first line with the most of the words, like the jump
// in the note, see findInDoc), with every matched word marked
function snippet(lines: string[], words: string[]): Snippet | null {
  let best: { line: number; at: number; count: number } | null = null
  for (let n = 0; n < lines.length && best?.count !== words.length; n++) {
    const { folded, from } = fold(lines[n])
    const spot = spotIn(folded, words)
    if (spot.count > (best?.count ?? 0)) best = { line: n, at: from[spot.at], count: spot.count }
  }
  if (!best) return null
  const text = lines.join(' ')
  const offset = lines.slice(0, best.line).reduce((sum, line) => sum + line.length + 1, 0)
  let start = Math.max(0, offset + best.at - BEFORE)
  // Start at a word, not in the middle of one
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  const piece = text.slice(start, start + LENGTH)

  // Which characters of the piece are part of a match
  const marked = new Array<boolean>(piece.length).fill(false)
  const p = fold(piece)
  for (const word of words) {
    for (let i = p.folded.indexOf(word); i >= 0; i = p.folded.indexOf(word, i + word.length)) {
      for (let j = p.from[i]; j <= p.from[i + word.length - 1]; j++) marked[j] = true
    }
  }
  const parts: Snippet = []
  for (let i = 0; i < piece.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.match === marked[i]) last.text += piece[i]
    else parts.push({ text: piece[i], match: marked[i] })
  }
  if (start > 0) parts.unshift({ text: '…', match: false })
  return parts
}

// ---------- Opening a result: jump to the match ----------

// App.tsx opens the note; its editor then jumps (NoteEditor.tsx, like a followed note link)
let pending: { noteId: string; query: string } | null = null

export function setPendingSearch(noteId: string, query: string) {
  pending = { noteId, query }
  window.dispatchEvent(new Event('syncr-jump')) // the note may already be open
}

export function takePendingSearch(noteId: string): string | null {
  if (pending?.noteId !== noteId) return null
  const { query } = pending
  pending = null
  return query
}

// Scrolls to the best match in the note (opening closed sections) and highlights it briefly.
// Nothing happens if only the custom title matched.
export function jumpToSearch(editor: Editor, query: string) {
  const match = findInDoc(editor.state.doc, searchWords(query))
  if (match) flashText(editor, match.from, match.to)
}

// The first block with the most of the words (all of them if one has them all), in document
// order. The highlight goes from the first word to the last, unless they're far apart.
function findInDoc(doc: PMNode, words: string[]): { from: number; to: number } | null {
  let best: { count: number; from: number; to: number } | null = null
  doc.descendants((block, blockPos) => {
    if (best?.count === words.length) return false
    if (!block.isTextblock) return true
    // The block's text, with the document position of each character
    let text = ''
    const positions: number[] = []
    block.forEach((child, offset) => {
      const pos = blockPos + 1 + offset
      const piece = child.isText ? child.text! : ' ' // an image or a line break
      for (let i = 0; i < piece.length; i++) positions.push(pos + i)
      text += piece
    })
    const { folded, from } = fold(text)
    const spot = spotIn(folded, words)
    if (spot.count > (best?.count ?? 0)) {
      best = { count: spot.count, from: positions[from[spot.at]], to: positions[from[spot.end - 1]] + 1 }
    }
    return false
  })
  return best
}
