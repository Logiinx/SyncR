import type { Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { canSplit } from '@tiptap/pm/transform'

// Line breaks (Shift+Enter, or pasted text that used <br>) look exactly like separate lines,
// since paragraphs have no spacing. But the lines stay one paragraph: triple-click, headings,
// lists and sections then act on all of them at once.

// The line breaks inside from–to that can become separate lines: only those in paragraphs
// (also inside list items, sections, tables). Headings and section titles keep theirs.
function lineBreaks(doc: Node, from: number, to: number): number[] {
  const positions: number[] = []
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === 'hardBreak' && parent?.type.name === 'paragraph' && pos >= from && pos < to) {
      positions.push(pos)
    }
  })
  return positions
}

export function selectionHasLineBreaks(editor: Editor) {
  const { from, to } = editor.state.selection
  return lineBreaks(editor.state.doc, from, to).length > 0
}

// "Separate lines" (selection menu): each line break in the selection ends its paragraph and
// starts a new one. Looks the same, but each line is then its own block. In a list item the
// new lines stay in the same item (no new bullet). One step, so Ctrl+Z undoes it.
export function splitLineBreaks(editor: Editor) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { from, to } = tr.selection
      const positions = lineBreaks(tr.doc, from, to)
      // The new paragraph doesn't take the block id: links keep pointing to the first line
      const after = [{ type: tr.doc.type.schema.nodes.paragraph, attrs: { blockId: null } }]
      // From the last to the first: each change only moves what comes after it
      for (const pos of positions.reverse()) {
        if (!canSplit(tr.doc, pos, 1, after)) continue
        tr.delete(pos, pos + 1).split(pos, 1, after)
      }
      return positions.length > 0
    })
    .run()
}
