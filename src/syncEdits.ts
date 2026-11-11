// An open note that sync updated with an edit from the other device: the added and changed
// words get a green background for a moment, removed ones show in red (DECISIONS.md "Sync
// changes tinted green / red").
// The two versions are compared like note history does (noteDiff.ts); each changed line is
// found in the note by its path. A decoration, never saved in the note.

import { Extension, type Editor, type JSONContent } from '@tiptap/react'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { diffNotes, type Line, type Row, type Token } from './noteDiff'
import { animationsOn } from './animations'

const SHOWN_MS = 3000 // 0.2 s in, 2 s, 0.8 s out (index.css "sync-edit")
const MOST_LINES = 10 // more changed lines than this: nothing glows in the note
const CLASS = 'sync-edit' // i18n-ok
const GONE = 'sync-gone' // i18n-ok: removed words
const GONE_LINE = 'sync-gone-line' // i18n-ok: a removed line

const key = new PluginKey<DecorationSet>('syncEdits')

export const SyncEdits = Extension.create({
  name: 'syncEdits',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const set: DecorationSet | null | undefined = tr.getMeta(key)
            if (set === undefined) return old.map(tr.mapping, tr.doc)
            return set ?? DecorationSet.empty
          },
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})

// Call right after the editor took the new version; before = what it showed until then
export function showSyncEdits(editor: Editor, before: JSONContent) {
  if (!animationsOn() || editor.isDestroyed) return
  const rows = diffNotes(before, editor.getJSON())
  const changed = rows.filter((row) => row.op !== 'same').length
  if (changed === 0 || changed > MOST_LINES) return
  const { doc } = editor.state
  const { view } = editor
  const decorations = inClosedSections(
    view,
    rows.flatMap((row, i) =>
      row.op === 'same' ? [] : row.op === 'removed' ? goneLine(doc, row.line, rows.slice(0, i), rows.slice(i + 1)) : lineDecorations(doc, row),
    ),
  )
  if (decorations.length === 0) return
  view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(doc, decorations)).setMeta('addToHistory', false))
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, null).setMeta('addToHistory', false))
  }, SHOWN_MS)
}

// A change inside a closed section can't be seen: the section's title glows instead, once (the
// outermost closed one: the title on screen). Open or closed isn't in the note: read on screen.
function inClosedSections(view: EditorView, decorations: Decoration[]): Decoration[] {
  const { doc } = view.state
  const titles = new Map<number, Decoration>() // by section position
  const shown = decorations.filter((decoration) => {
    const $pos = doc.resolve(decoration.from)
    for (let depth = 1; depth <= $pos.depth; depth++) {
      if ($pos.node(depth).type.name !== 'details') continue
      const section = $pos.before(depth)
      if ((view.nodeDOM(section) as HTMLElement | null)?.classList.contains('is-open')) continue
      // Its title (first child): the text, or the whole title when it has none
      const title = $pos.node(depth).firstChild
      if (!titles.has(section) && title) {
        const from = section + 2
        titles.set(
          section,
          title.content.size
            ? Decoration.inline(from, from + title.content.size, { class: CLASS })
            : Decoration.node(section + 1, section + 1 + title.nodeSize, { class: CLASS }),
        )
      }
      return false
    }
    return true
  })
  return [...shown, ...titles.values()]
}

// Removed words: a red, struck-through copy where they were, for a moment (a widget: drawn by
// the editor, not part of the note, can't be selected or edited). A whole line: as its own line.
function ghost(pos: number, text: string, line: boolean) {
  return Decoration.widget(
    pos,
    () => {
      const el = document.createElement(line ? 'div' : 'span')
      el.className = line ? GONE_LINE : GONE
      el.textContent = text.trim() // its spaces: the gap around it (CSS), not red
      el.setAttribute('aria-hidden', 'true')
      el.contentEditable = 'false'
      return el
    },
    { side: -1, ignoreSelection: true },
  )
}

const textOf = (tokens: Token[]) => tokens.map((token) => token.text).join('')

// A removed line: shown where it was. Right after the line before it when that one is at the
// same level (a removed list item stays in its list), else before the next line still in the
// note (or at the end). Images, separator lines and table rows: nothing (no text to show).
function goneLine(doc: PmNode, line: Line, before: Row[], after: Row[]): Decoration[] {
  const text = textOf(line.tokens).trim()
  if (!text || line.kind === 'image' || line.kind === 'rule' || line.kind === 'row') return []
  const kept = (row: Row | undefined) => (row && row.op !== 'removed' ? (row.op === 'changed' ? row.after : row.line) : undefined)
  const node = (other: Line) => find(doc, other.kind === 'code' ? other.path.slice(0, -1) : other.path)
  const previous = kept(before.findLast((row) => row.op !== 'removed'))
  const prev = previous && previous.depth === line.depth ? node(previous) : null
  if (prev) return [ghost(prev.pos + prev.node.nodeSize, text, true)]
  const next = kept(after.find((row) => row.op !== 'removed'))
  const found = next && node(next)
  return [ghost(found ? found.pos : doc.content.size, text, true)]
}

function lineDecorations(doc: PmNode, row: Row): Decoration[] {
  const line = row.op === 'changed' ? row.after : (row as { line: Line }).line
  const code = line.kind === 'code'
  const found = find(doc, code ? line.path.slice(0, -1) : line.path)
  if (!found) return []
  const { node, pos } = found
  // Images, lines and table rows: the whole thing
  if (!node.isTextblock) return [Decoration.node(pos, pos + node.nodeSize, { class: CLASS })]

  // Where the line's text starts and ends (a code block's line: after the lines before it)
  let from = pos + 1
  let end = pos + 1 + node.content.size
  if (code) {
    const lines = node.textContent.split('\n')
    const index = line.path[line.path.length - 1]
    from += lines.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0)
    end = from + (lines[index]?.length ?? 0)
  }
  const whole = () => (end > from ? [Decoration.inline(from, end, { class: CLASS })] : [])
  if (row.op !== 'changed') return whole()

  // The added and re-formatted words. Two of them with only spaces between: one piece ("New
  // idea", not "New" and "idea"). Removed ones: a ghost where they were.
  const ranges: { from: number; to: number }[] = []
  const ghosts: Decoration[] = []
  let at = from
  for (const segment of row.segments) {
    if (segment.type === 'removed') {
      const text = textOf(segment.tokens)
      if (text.trim()) ghosts.push(ghost(Math.min(at, end), text, false))
      continue
    }
    const length = segment.tokens.reduce((sum, token) => sum + token.text.length, 0)
    const to = Math.min(at + length, end)
    if (segment.type !== 'same' && to > at) {
      const last = ranges[ranges.length - 1]
      if (last && doc.textBetween(last.to, at).trim() === '') last.to = to
      else ranges.push({ from: at, to })
    }
    at += length
  }
  // Only the kind of line changed (a ticked checkbox, a paragraph made a list item): all of it
  if (ranges.length === 0 && ghosts.length === 0) return whole()
  return [
    ...ghosts,
    ...ranges.flatMap((range) => {
      // Without the spaces at its ends ("really ", not its space)
      const text = doc.textBetween(range.from, range.to, '\n', '\n') // i18n-ok: a line break counts as one sign, like in the note
      const start = range.from + (text.length - text.trimStart().length)
      const stop = range.to - (text.length - text.trimEnd().length)
      return stop > start ? [Decoration.inline(start, stop, { class: CLASS })] : []
    }),
  ]
}

// The node at a path of child numbers, and its position
function find(doc: PmNode, path: number[]) {
  let node = doc
  let pos = -1 // the document itself has no position: its content starts at 0
  for (const index of path) {
    if (index >= node.childCount) return null
    let childPos = pos + 1
    for (let i = 0; i < index; i++) childPos += node.child(i).nodeSize
    node = node.child(index)
    pos = childPos
  }
  return path.length ? { node, pos } : null
}
