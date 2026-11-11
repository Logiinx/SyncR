// An open note that sync updated with an edit from the other device: the added and changed
// words get a green background for a moment (DECISIONS.md "Sync changes tinted green / red").
// The two versions are compared like note history does (noteDiff.ts); each changed line is
// found in the note by its path. A decoration, never saved in the note.

import { Extension, type Editor, type JSONContent } from '@tiptap/react'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { diffNotes, type Line, type Row } from './noteDiff'
import { animationsOn } from './animations'

const SHOWN_MS = 3000 // 0.2 s in, 2 s, 0.8 s out (index.css "sync-edit")
const MOST_LINES = 10 // more changed lines than this: nothing glows in the note
const CLASS = 'sync-edit' // i18n-ok

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
  const rows = diffNotes(before, editor.getJSON()).filter((row) => row.op === 'added' || row.op === 'changed')
  if (rows.length === 0 || rows.length > MOST_LINES) return
  const { doc } = editor.state
  const decorations = rows.flatMap((row) => lineDecorations(doc, row))
  if (decorations.length === 0) return
  const { view } = editor
  view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(doc, decorations)).setMeta('addToHistory', false))
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, null).setMeta('addToHistory', false))
  }, SHOWN_MS)
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

  // The added and re-formatted words (removed ones aren't in the note anymore). Two of them with
  // only spaces between: one piece ("New idea", not "New" and "idea").
  const ranges: { from: number; to: number }[] = []
  let at = from
  for (const segment of row.segments) {
    if (segment.type === 'removed') continue
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
  if (ranges.length === 0) return whole()
  return ranges.flatMap((range) => {
    // Without the spaces at its ends ("really ", not its space)
    const text = doc.textBetween(range.from, range.to, '\n', '\n') // i18n-ok: a line break counts as one sign, like in the note
    const start = range.from + (text.length - text.trimStart().length)
    const stop = range.to - (text.length - text.trimEnd().length)
    return stop > start ? [Decoration.inline(start, stop, { class: CLASS })] : []
  })
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
