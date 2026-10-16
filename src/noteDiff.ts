import type { JSONContent } from '@tiptap/react'

// Compares two versions of a note (a conflict copy and its original, ConflictCompare.tsx).
// Each version becomes a list of lines (paragraphs, headings, list and checklist items, section
// titles, code lines, table rows). Lines are lined up to find unchanged, removed, added and
// changed ones; inside a changed line, the words are compared too.
// Only real changes count: text, formatting (bold, color…), a ticked checkbox, a list turned
// into plain lines. Whether a section is open isn't saved in the note, so it never shows.

// A word or a space, with its formatting
export interface Token {
  text: string
  marks: JSONContent['marks'] // bold, italic, link…: shown as in the note
  markKey: string // the formatting in a comparable form ('' = none)
}

export interface Line {
  kind: string // 'paragraph', 'heading-2', 'bullet', 'numbered', 'task', 'task-done', 'section', 'code', 'quote', 'row', 'image', 'rule'
  depth: number // nesting (lists, sections), for the indent
  number?: string // numbered list: "3." (shown only, not compared, so inserting an item
  // doesn't make every later item look changed)
  tokens: Token[]
  key: string // kind + depth + words + formatting: equal keys = unchanged line
}

// Part of a changed line: unchanged, removed (only before), added (only after), or the same
// words with other formatting (tokens: as after; before: as before)
export interface Segment {
  type: 'same' | 'removed' | 'added' | 'formatted'
  tokens: Token[]
  before?: Token[]
}

export type Row =
  | { op: 'same'; line: Line }
  | { op: 'removed'; line: Line }
  | { op: 'added'; line: Line }
  | { op: 'changed'; before: Line; after: Line; segments: Segment[] }

export function diffNotes(before: JSONContent | null, after: JSONContent | null): Row[] {
  const a = toLines(before)
  const b = toLines(after)
  const rows: Row[] = []
  // Runs of removed and added lines between two unchanged ones: paired up as changed lines
  let removed: Line[] = []
  let added: Line[] = []
  const flush = () => {
    const pairs = Math.min(removed.length, added.length)
    for (let i = 0; i < pairs; i++) {
      rows.push({ op: 'changed', before: removed[i], after: added[i], segments: diffWords(removed[i].tokens, added[i].tokens) })
    }
    for (const line of removed.slice(pairs)) rows.push({ op: 'removed', line })
    for (const line of added.slice(pairs)) rows.push({ op: 'added', line })
    removed = []
    added = []
  }
  for (const step of lcs(a.map((l) => l.key), b.map((l) => l.key))) {
    if (step.op === 'same') {
      flush()
      rows.push({ op: 'same', line: b[step.j] })
    } else if (step.op === 'removed') removed.push(a[step.i])
    else added.push(b[step.j])
  }
  flush()
  return rows
}

// ---------- Note → lines ----------

function toLines(doc: JSONContent | null): Line[] {
  const lines: Line[] = []
  const add = (kind: string, depth: number, tokens: Token[], number?: string) =>
    lines.push({ kind, depth, tokens, number, key: `${kind}|${depth}|${tokens.map((t) => t.text + '\u0001' + t.markKey).join('\u0002')}` })

  // kind: what the first text line inside this node is (a list item's first paragraph is
  // the bullet; the rest of the item are plain lines under it)
  const walk = (node: JSONContent, depth: number, kind: string, number?: string) => {
    switch (node.type) {
      case 'paragraph':
        return add(kind, depth, tokenize(node.content), number)
      case 'heading':
        return add(`heading-${node.attrs?.level ?? 1}`, depth, tokenize(node.content))
      case 'detailsSummary':
        return add('section', depth, tokenize(node.content))
      case 'codeBlock': {
        const text = (node.content ?? []).map((t) => t.text ?? '').join('')
        for (const line of text.split('\n')) add('code', depth, tokenize([{ type: 'text', text: line }]))
        return
      }
      case 'image':
        return add('image', depth, [{ text: '[image]', marks: undefined, markKey: '' }])
      case 'horizontalRule':
        return add('rule', depth, [])
      case 'tableRow': {
        const cells = (node.content ?? []).map((cell) => tokenize(textNodes(cell)))
        const tokens = cells.flatMap((cell, i) => (i ? [{ text: ' | ', marks: undefined, markKey: '' }, ...cell] : cell))
        return add('row', depth, tokens)
      }
      case 'listItem':
      case 'taskItem': {
        const itemKind = node.type === 'taskItem' ? (node.attrs?.checked ? 'task-done' : 'task') : kind
        ;(node.content ?? []).forEach((child, i) => walk(child, depth, i === 0 ? itemKind : 'paragraph', i === 0 ? number : undefined))
        return
      }
      case 'bulletList':
        return node.content?.forEach((child) => walk(child, depth + 1, 'bullet'))
      case 'orderedList':
        return node.content?.forEach((child, i) => walk(child, depth + 1, 'numbered', `${(node.attrs?.start ?? 1) + i}.`))
      case 'taskList':
        return node.content?.forEach((child) => walk(child, depth + 1, 'task'))
      case 'blockquote':
        return node.content?.forEach((child) => walk(child, depth, 'quote'))
      case 'details':
        // Title at this depth, its content one step in
        return node.content?.forEach((child) => walk(child, child.type === 'detailsContent' ? depth + 1 : depth, kind))
      default:
        // doc, detailsContent, table…: just their children
        return node.content?.forEach((child) => walk(child, depth, 'paragraph'))
    }
  }
  if (doc) walk(doc, 0, 'paragraph')
  return lines
}

// All text nodes inside a node (a table cell can hold several paragraphs)
function textNodes(node: JSONContent): JSONContent[] {
  if (node.type === 'text' || node.type === 'hardBreak') return [node]
  return (node.content ?? []).flatMap(textNodes)
}

// Words and spaces, each with the formatting of its text
function tokenize(content: JSONContent[] | undefined): Token[] {
  const tokens: Token[] = []
  for (const node of content ?? []) {
    if (node.type === 'hardBreak') {
      tokens.push({ text: '\n', marks: undefined, markKey: '' })
      continue
    }
    if (!node.text) continue
    const markKey = (node.marks ?? [])
      .map((m) => m.type + (m.attrs ? JSON.stringify(m.attrs) : ''))
      .sort()
      .join(',')
    // Spaces, words, and each punctuation sign on its own (so "milk" and "milk," share "milk")
    for (const piece of node.text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) ?? []) {
      tokens.push({ text: piece, marks: node.marks, markKey })
    }
  }
  return tokens
}

// ---------- Comparing words ----------

function diffWords(a: Token[], b: Token[]): Segment[] {
  const segments: Segment[] = []
  const push = (type: Segment['type'], token: Token, before?: Token) => {
    const last = segments[segments.length - 1]
    if (last?.type === type) {
      last.tokens.push(token)
      if (before) last.before?.push(before)
    } else segments.push({ type, tokens: [token], before: before && [before] })
  }
  // Removed and added words between two unchanged ones. Same words on both sides (only the
  // formatting changed, e.g. made bold): "formatted", shown once with the new formatting.
  let removed: Token[] = []
  let added: Token[] = []
  const flush = () => {
    const sameWords = removed.length === added.length && removed.every((t, i) => t.text === added[i].text)
    if (removed.length && sameWords) added.forEach((t, i) => push('formatted', t, removed[i]))
    else {
      removed.forEach((t) => push('removed', t))
      added.forEach((t) => push('added', t))
    }
    removed = []
    added = []
  }
  for (const step of lcs(a.map((t) => t.text + '\u0001' + t.markKey), b.map((t) => t.text + '\u0001' + t.markKey))) {
    if (step.op === 'same') {
      flush()
      push('same', b[step.j])
    } else if (step.op === 'removed') removed.push(a[step.i])
    else added.push(b[step.j])
  }
  flush()
  return segments
}

// ---------- Longest common subsequence ----------

type Step = { op: 'same'; i: number; j: number } | { op: 'removed'; i: number } | { op: 'added'; j: number }

// The steps from list a to list b keeping as much in common as possible (removals before
// additions at each spot). Common start and end are skipped first, so a small edit in a
// long note stays fast.
function lcs(a: string[], b: string[]): Step[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  // table[i][j] = length of the common part of a[start+i..] and b[start+j..]
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const steps: Step[] = []
  for (let k = 0; k < start; k++) steps.push({ op: 'same', i: k, j: k })
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      steps.push({ op: 'same', i: start + i++, j: start + j++ })
    } else if (j >= m || (i < n && table[i + 1][j] >= table[i][j + 1])) {
      steps.push({ op: 'removed', i: start + i++ })
    } else {
      steps.push({ op: 'added', j: start + j++ })
    }
  }
  for (let k = 0; k < a.length - endA; k++) steps.push({ op: 'same', i: endA + k, j: endB + k })
  return steps
}
