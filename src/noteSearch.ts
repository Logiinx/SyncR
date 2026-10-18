import type { Note } from './db'

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

// A piece of text with the matched words marked
export type Snippet = { text: string; match: boolean }[]

export interface SearchResult {
  note: Note
  snippet: Snippet | null // null: only the title matched (the normal preview shows)
}

const BEFORE = 30 // characters shown before the first match
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
    results.push({ note, snippet: snippet(lines.join(' ').replace(/\s+/g, ' '), words) })
  }
  return results
}

// The text around the first match, with every matched word marked
function snippet(text: string, words: string[]): Snippet | null {
  const { folded, from } = fold(text)
  const firsts = words.map((word) => folded.indexOf(word)).filter((i) => i >= 0)
  if (!firsts.length) return null
  let start = Math.max(0, from[Math.min(...firsts)] - BEFORE)
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
